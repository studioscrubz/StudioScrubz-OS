begin;

drop index if exists public.one_active_agreement_per_proposal;

create unique index one_active_agreement_per_proposal
on public.service_agreements(proposal_id)
where proposal_id is not null
  and archived_at is null
  and status not in ('Cancelled', 'Archived');

-- A Post-Construction Job must come from an Agreement occurrence, never from
-- the legacy accepted one-time Proposal shortcut.
create or replace function private.require_post_construction_agreement_job_path()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.proposal_id is not null
    and new.service_occurrence_id is null
    and exists (
      select 1 from public.proposals proposal
      where proposal.id = new.proposal_id
        and proposal.frequency = 'One-Time'
        and lower(coalesce(proposal.result->>'serviceName', '')) = 'post-construction cleaning'
    )
  then
    raise exception 'Post-Construction Jobs must be created downstream of the Service Agreement workflow.';
  end if;
  return new;
end;
$$;
revoke all on function private.require_post_construction_agreement_job_path()
from public, anon, authenticated;
drop trigger if exists jobs_require_post_construction_agreement_path on public.jobs;
create trigger jobs_require_post_construction_agreement_path
before insert or update of proposal_id, service_occurrence_id on public.jobs
for each row execute function private.require_post_construction_agreement_job_path();

-- Proposal acceptance is the sole public entry point. This helper is private,
-- has no client grants, and is idempotent under the existing partial unique
-- index on active service_agreements(proposal_id).
create or replace function private.ensure_post_construction_draft_agreement(p_proposal_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proposal_row public.proposals;
  settings_row public.business_settings;
  agreement_id uuid;
  pricing jsonb;
  scope_snapshot jsonb;
  amount numeric;
begin
  select * into proposal_row
  from public.proposals
  where id = p_proposal_id
  for update;

  if not found
    or proposal_row.status <> 'Accepted'
    or proposal_row.accepted is distinct from true
    or proposal_row.frequency <> 'One-Time'
    or lower(coalesce(proposal_row.result->>'serviceName', '')) <> 'post-construction cleaning'
  then
    return null;
  end if;

  select id into agreement_id
  from public.service_agreements
  where proposal_id = proposal_row.id
    and archived_at is null
    and status not in ('Cancelled', 'Archived')
  limit 1;
  if agreement_id is not null then return agreement_id; end if;

  amount := (proposal_row.result->>'perVisitTotal')::numeric;
  scope_snapshot := case when jsonb_typeof(proposal_row.result->'scope') = 'array'
    then proposal_row.result->'scope' else '[]'::jsonb end;
  select * into settings_row from public.business_settings limit 1;

  pricing := jsonb_build_object(
    'source', 'Accepted Proposal',
    'service_description', proposal_row.result->'serviceDescription',
    'standard_service_price', coalesce((proposal_row.result->>'baseEstimateAmount')::numeric, amount),
    'frequency', proposal_row.frequency,
    'recurring_pricing_rule_id', proposal_row.result->'recurringPricingRuleId',
    'recurring_pricing_rule_name', proposal_row.result->'recurringPricingRuleName',
    'frequency_discount_label', coalesce(proposal_row.result->>'recurringPricingRuleName', proposal_row.frequency || ' Service Discount'),
    'frequency_discount_percent', coalesce((proposal_row.result->>'frequencyDiscountPercent')::numeric, 0),
    'frequency_discount_amount', coalesce((proposal_row.result->>'frequencyDiscount')::numeric, 0),
    'price_after_frequency_discount', greatest(0, coalesce((proposal_row.result->>'baseEstimateAmount')::numeric, amount) - coalesce((proposal_row.result->>'frequencyDiscount')::numeric, 0)),
    'custom_discount_amount', coalesce((proposal_row.result->>'inheritedManualDiscount')::numeric, 0) + coalesce((proposal_row.result->>'manualDiscount')::numeric, 0),
    'taxes', coalesce((proposal_row.result->>'taxes')::numeric, 0),
    'final_per_visit_price', amount,
    'estimated_monthly_total', proposal_row.result->'monthlyTotal',
    'accepted_pricing_allocation', proposal_row.result->'acceptedPricingAllocation',
    'estimated_cleaning_days', proposal_row.result->'estimatedCleaningDays',
    'estimated_hours_per_day', proposal_row.result->'estimatedHoursPerDay',
    'requested_service_date', to_jsonb(proposal_row.requested_date),
    'accepted_proposal_result', proposal_row.result,
    'upkeep_plan', proposal_row.result->'upkeepPlan',
    'catalog_addons', case when jsonb_typeof(proposal_row.result->'adjustments') = 'array' then proposal_row.result->'adjustments' else '[]'::jsonb end,
    'captured_at', to_jsonb(proposal_row.accepted_at)
  );

  insert into public.service_agreements(
    agreement_number, client_id, property_id, proposal_id, division,
    agreement_name, service_name, frequency, days_of_week, interval_weeks,
    day_of_month, second_day_of_month, third_day_of_month, custom_interval_days,
    start_date, end_date, auto_renew, billing_type, billing_amount,
    pricing_snapshot, payment_terms, agreement_terms, cancellation_terms,
    scope, special_instructions, assigned_crew_id, default_start_time,
    estimated_duration, status, notes
  ) values (
    'AGR-PC-' || replace(proposal_row.id::text, '-', ''),
    proposal_row.client_id, proposal_row.property_id, proposal_row.id, proposal_row.division,
    (proposal_row.result->>'serviceName') || ' Service Agreement',
    proposal_row.result->>'serviceName', 'One-Time', '[]'::jsonb, 1,
    null, null, null, null,
    coalesce(proposal_row.requested_date, current_date), null, false,
    'Per Visit', amount, pricing,
    nullif(proposal_row.result#>>'{terms,paymentTerms}', ''),
    settings_row.default_service_agreement_terms,
    settings_row.default_cancellation_terms,
    scope_snapshot,
    nullif(proposal_row.result#>>'{terms,accessRequirements}', ''),
    null, null,
    case when coalesce(proposal_row.result->>'estimatedDuration', '') ~ '^([0-9]+)(\.[0-9]+)?$' then (proposal_row.result->>'estimatedDuration')::numeric else null end,
    'Draft', proposal_row.notes
  )
  returning id into agreement_id;

  insert into public.proposal_history(
    proposal_id, event_type, previous_status, new_status, description, metadata, performed_by
  ) values (
    proposal_row.id, 'Service Agreement Created', 'Accepted', 'Accepted',
    'Draft Service Agreement created automatically for staff review.',
    jsonb_build_object('agreement_id', agreement_id, 'status', 'Draft'), 'System'
  );

  return agreement_id;
exception
  when unique_violation then
    select id into agreement_id
    from public.service_agreements
    where proposal_id = p_proposal_id
      and archived_at is null
      and status not in ('Cancelled', 'Archived')
    limit 1;
    if agreement_id is null then raise; end if;
    return agreement_id;
end;
$$;

revoke all on function private.ensure_post_construction_draft_agreement(uuid)
from public, anon, authenticated;

create or replace function private.create_post_construction_agreement_after_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'Accepted'
    and new.accepted is true
    and (old.status is distinct from new.status or old.accepted is distinct from new.accepted)
  then
    perform private.ensure_post_construction_draft_agreement(new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.create_post_construction_agreement_after_acceptance()
from public, anon, authenticated;
drop trigger if exists proposals_create_post_construction_agreement on public.proposals;
create trigger proposals_create_post_construction_agreement
after update of status, accepted on public.proposals
for each row execute function private.create_post_construction_agreement_after_acceptance();

create or replace function public.create_post_construction_draft_agreement(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare agreement_id uuid;
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin','Administrator','Manager'])
  then
    raise exception 'Agreement creation permission denied.' using errcode = '42501';
  end if;
  agreement_id := private.ensure_post_construction_draft_agreement(p_proposal_id);
  if agreement_id is null then
    raise exception 'Only an accepted one-time Post-Construction Proposal can create this Draft Agreement.';
  end if;
  return agreement_id;
end;
$$;

revoke all on function public.create_post_construction_draft_agreement(uuid)
from public, anon, authenticated;
grant execute on function public.create_post_construction_draft_agreement(uuid)
to authenticated;

create or replace function public.delete_unsent_draft_service_agreement(p_agreement_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement_row public.service_agreements;
  actor_name text;
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin','Administrator','Manager'])
  then
    raise exception 'Only management may delete an unsent Draft Agreement.' using errcode = '42501';
  end if;

  select * into agreement_row
  from public.service_agreements
  where id = p_agreement_id
  for update;
  if not found then raise exception 'Service Agreement not found.'; end if;

  if agreement_row.status <> 'Draft'
    or agreement_row.archived_at is not null
    or agreement_row.sent_at is not null
    or agreement_row.sent_to is not null
    or agreement_row.sent_by is not null
    or agreement_row.accepted_at is not null
    or agreement_row.client_access_token is not null
    or agreement_row.client_access_token_expires_at is not null
    or agreement_row.client_signed_at is not null
    or agreement_row.client_signed_name is not null
    or agreement_row.client_signature is not null
    or agreement_row.client_signed_snapshot is not null
    or agreement_row.client_consent_text is not null
    or agreement_row.client_consent_at is not null
  then
    raise exception 'Only a pristine, never-sent Draft Agreement can be deleted.';
  end if;

  if exists(select 1 from public.service_occurrences where agreement_id = agreement_row.id)
    or exists(select 1 from public.invoices where service_agreement_id = agreement_row.id)
    or exists(select 1 from public.property_service_plans where agreement_id = agreement_row.id)
    or exists(select 1 from public.service_agreement_documents where agreement_id = agreement_row.id)
    or exists(select 1 from public.client_communications where agreement_id = agreement_row.id)
  then
    raise exception 'This Draft Agreement has downstream records and cannot be deleted.';
  end if;

  if exists(
    select 1 from public.jobs job
    join public.service_occurrences occurrence on occurrence.id = job.service_occurrence_id
    where occurrence.agreement_id = agreement_row.id
  ) or (
    agreement_row.proposal_id is not null
    and exists (
      select 1
      from public.jobs job
      where job.proposal_id = agreement_row.proposal_id
        and job.archived_at is null
    )
  ) or exists(
    select 1 from public.payments payment
    join public.invoices invoice on invoice.id = payment.invoice_id
    where invoice.service_agreement_id = agreement_row.id
  ) then
    raise exception 'This Draft Agreement has downstream financial or Job records and cannot be deleted.';
  end if;

  select coalesce(nullif(btrim(up.display_name), ''), up.role, 'Management')
  into actor_name
  from public.user_profiles up
  where up.id = auth.uid();

  if agreement_row.proposal_id is not null then
    insert into public.proposal_history(
      proposal_id, event_type, previous_status, new_status,
      description, metadata, performed_by
    ) values (
      agreement_row.proposal_id, 'Draft Service Agreement Deleted', 'Accepted', 'Accepted',
      'An unsent Draft Service Agreement was permanently deleted by staff.',
      jsonb_build_object(
        'agreement_id', agreement_row.id,
        'agreement_number', agreement_row.agreement_number
      ),
      coalesce(actor_name, 'Management')
    );
  end if;

  delete from public.service_agreements where id = agreement_row.id;
  return agreement_row.id;
end;
$$;

revoke all on function public.delete_unsent_draft_service_agreement(uuid)
from public, anon, authenticated;
grant execute on function public.delete_unsent_draft_service_agreement(uuid)
to authenticated;

create or replace function public.accept_proposal_by_token(
  p_token text,
  p_accepted_by_name text,
  p_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_accepted_by_name, ''));
  v_consent constant text := 'I have reviewed and accept this Proposal.';
  v_id uuid;
  v_previous_status text;
  v_accepted_at timestamptz := now();
  v_updated_count integer;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'This proposal link is invalid, expired, or no longer available.'; end if;
  if p_consent is distinct from true then raise exception 'Explicit consent is required to accept this Proposal.'; end if;
  if length(v_name) < 2 or length(v_name) > 150 then raise exception 'Enter a valid full name.'; end if;

  select p.id, p.status into v_id, v_previous_status
  from public.proposals p
  where p.client_access_token = p_token
    and p.archived_at is null
    and p.status in ('Sent', 'Viewed', 'Accepted')
    and p.approval_status = 'Approved'
    and p.expiration_date >= current_date
    and (p.client_access_token_expires_at is null or p.client_access_token_expires_at > now())
  limit 1 for update;

  if v_id is null then raise exception 'This Proposal cannot be accepted because it is invalid, expired, archived, or unavailable.'; end if;
  if v_previous_status = 'Accepted' then
    return public.get_proposal_by_token(p_token);
  end if;

  perform set_config('studioscrubz.controlled_proposal_acceptance', 'on', true);
  update public.proposals
  set status='Accepted', accepted=true, accepted_at=v_accepted_at,
      accepted_by_name=v_name, acceptance_method='Signed Proposal',
      client_acceptance_consent=v_consent, client_acceptance_consent_at=v_accepted_at
  where id=v_id and status in ('Sent','Viewed') and accepted=false;
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then raise exception 'This Proposal changed before acceptance could be completed. Refresh and try again.'; end if;

  insert into public.proposal_history(proposal_id,event_type,previous_status,new_status,description,metadata,performed_by)
  values(v_id,'Accepted',v_previous_status,'Accepted','Proposal accepted through the secure client review page.',jsonb_build_object('accepted_by_name',v_name,'accepted_at',v_accepted_at),'Client');

  perform private.ensure_post_construction_draft_agreement(v_id);
  return public.get_proposal_by_token(p_token);
end;
$$;

revoke all on function public.accept_proposal_by_token(text,text,boolean)
from public, anon, authenticated;
grant execute on function public.accept_proposal_by_token(text,text,boolean)
to anon, authenticated;

-- Anonymous proposal acceptance can invoke only the token-scoped RPC. It does
-- not gain table writes to agreements, jobs, messages, or delivery tokens.
revoke insert, update, delete on public.service_agreements from public, anon;
revoke delete on public.service_agreements from authenticated;

notify pgrst, 'reload schema';
commit;
