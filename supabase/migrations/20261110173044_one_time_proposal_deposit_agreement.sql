alter table public.proposal_deposit_requirements
  add column sent_with_proposal boolean not null default false;

create or replace function public.prepare_proposal_delivery(p_proposal_id uuid,p_token text,p_token_expires_at timestamptz,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare row public.proposals; safe_snapshot jsonb; total numeric; required numeric;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then raise exception 'You do not have permission to send Proposals.' using errcode='42501'; end if;
  if p_token is null or length(p_token)<32 or p_token_expires_at<=now() then raise exception 'A valid secure Proposal token is required.'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' then raise exception 'A client-facing Proposal snapshot is required.'; end if;
  select * into row from public.proposals where id=p_proposal_id for update;
  if not found or row.archived_at is not null or row.status not in ('Approved','Sent','Viewed') or row.approval_status<>'Approved' or row.accepted or row.expiration_date<current_date then raise exception 'This Proposal is unavailable for delivery.'; end if;
  if (row.status in ('Sent','Viewed') and not row.is_current_revision) or (row.status='Approved' and (row.sent_at is not null or exists(select 1 from public.proposals newer where newer.revision_group_id=row.revision_group_id and newer.revision_number>row.revision_number and newer.archived_at is null))) then raise exception 'Only the current offer or newest approved revision can be delivered.'; end if;
  if row.revision_number>1 and exists(select 1 from public.proposals p where p.revision_group_id=row.revision_group_id and p.is_current_revision and p.status='Accepted') then raise exception 'The prior Proposal was accepted before this revision could be sent.'; end if;
  safe_snapshot := p_snapshot - array['deposit_percent','required_deposit_amount','remaining_balance','automatic_deposit_agreement'];
  if row.frequency = 'One-Time' then
    total := round((row.result->>'perVisitTotal')::numeric, 2);
    if total > 500 and total < 'Infinity'::numeric then
      if btrim(coalesce(row.customer_email, '')) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
        raise exception 'A valid customer email is required for the Service Agreement.';
      end if;
      if total is distinct from round((p_snapshot->>'per_visit_total')::numeric, 2) then
        raise exception 'The Proposal snapshot total does not match the approved price.';
      end if;
      required := round(total * 0.25, 2);
      safe_snapshot := safe_snapshot || jsonb_build_object('deposit_percent', 25,
        'required_deposit_amount', required, 'remaining_balance', total - required,
        'automatic_deposit_agreement', true);
    end if;
  end if;
  perform set_config('studioscrubz.controlled_delivery_snapshot','on',true);
  update public.proposals set client_access_token=p_token,client_access_token_expires_at=p_token_expires_at,client_delivery_snapshot=safe_snapshot where id=row.id;
  return jsonb_build_object('prepared',true,'snapshot',safe_snapshot);
end $$;
revoke all on function public.prepare_proposal_delivery(uuid,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_proposal_delivery(uuid,text,timestamptz,jsonb) to authenticated;

create or replace function private.ensure_qualifying_proposal_agreement(p_proposal_id uuid)
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
    or proposal_row.status not in ('Sent', 'Viewed', 'Accepted')
    or proposal_row.frequency <> 'One-Time'
    or not proposal_row.is_current_revision
    or proposal_row.archived_at is not null
    or (proposal_row.client_delivery_snapshot->>'automatic_deposit_agreement') is distinct from 'true'
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

  amount := (proposal_row.client_delivery_snapshot->>'per_visit_total')::numeric;
  scope_snapshot := case when jsonb_typeof(proposal_row.result->'scope') = 'array'
    then proposal_row.result->'scope' else '[]'::jsonb end;
  select * into settings_row from public.business_settings limit 1;

  pricing := jsonb_build_object(
    'source', 'Sent Proposal',
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
    'AGR-OT-' || replace(proposal_row.id::text, '-', ''),
    proposal_row.client_id, proposal_row.property_id, proposal_row.id, proposal_row.division,
    (proposal_row.result->>'serviceName') || ' Service Agreement',
    proposal_row.result->>'serviceName', 'One-Time', '[]'::jsonb, 1,
    null, null, null, null,
    coalesce(proposal_row.requested_date, current_date), null, false,
    'Per Visit', amount, pricing,
    concat_ws(E'\n', nullif(proposal_row.result#>>'{terms,paymentTerms}', ''),
      'A 25% deposit via Zelle is due before service begins. The deposit applies toward the service total.'),
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
    proposal_row.id, 'Service Agreement Created', proposal_row.status, proposal_row.status,
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

revoke all on function private.ensure_qualifying_proposal_agreement(uuid)
from public, anon, authenticated;

create function public.prepare_proposal_deposit_agreement_email(
  p_proposal_id uuid, p_recipient text, p_sender text, p_token text, p_expires_at timestamptz
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  proposal public.proposals;
  agreement public.service_agreements;
  settings public.business_settings;
  deposit public.proposal_deposit_requirements;
  total numeric;
  amount numeric;
  agreement_id uuid;
begin
  select * into proposal from public.proposals where id = p_proposal_id for update;
  if not found or proposal.archived_at is not null or not proposal.is_current_revision
    or proposal.status not in ('Sent', 'Viewed', 'Accepted')
    or proposal.approval_status <> 'Approved' or proposal.expiration_date < current_date then
    raise exception 'This Proposal is unavailable for Agreement delivery.';
  end if;
  if (proposal.client_delivery_snapshot->>'automatic_deposit_agreement') is distinct from 'true' then
    return null;
  end if;
  if lower(btrim(coalesce(proposal.customer_email, ''))) is distinct from p_recipient
    or p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_expires_at <= now() then
    raise exception 'A secure Agreement link and the Proposal customer email are required.';
  end if;

  total := round((proposal.client_delivery_snapshot->>'per_visit_total')::numeric, 2);
  if proposal.frequency <> 'One-Time' or total is null or total <= 500 or total >= 'Infinity'::numeric then
    raise exception 'This Proposal does not qualify for a deposit.';
  end if;
  amount := round(total * 0.25, 2);

  -- The private helper runs inside the service-only RPC and reuses the unique
  -- active Agreement for this Proposal.
  agreement_id := private.ensure_qualifying_proposal_agreement(proposal.id);
  select * into agreement from public.service_agreements where id = agreement_id for update;
  if not found then raise exception 'The Service Agreement could not be prepared.'; end if;
  if agreement.status not in ('Draft', 'Sent') then return null; end if;
  if agreement.billing_amount is distinct from total or agreement.frequency <> 'One-Time' then
    raise exception 'The existing Service Agreement does not match the approved Proposal.';
  end if;
  select * into deposit from public.proposal_deposit_requirements where proposal_id = proposal.id for update;
  if not found then
    select * into settings from public.business_settings limit 1;
    if settings.id is null then raise exception 'The StudioScrubz Zelle recipient is unavailable.'; end if;
    insert into public.proposal_deposit_requirements (
      proposal_id, agreement_id, client_id, property_id, currency, deposit_percent, accepted_total,
      required_amount, remaining_balance, payment_method, recipient_name, recipient_phone, rendered_memo, sent_with_proposal
    ) values (
      proposal.id, agreement.id, proposal.client_id, proposal.property_id, coalesce(nullif(settings.currency, ''), 'USD'),
      25, total, amount, total - amount, 'Zelle', settings.post_construction_payment_recipient_name,
      settings.post_construction_payment_recipient_phone,
      private.render_post_construction_deposit_memo(settings.post_construction_payment_memo_template,
        proposal.proposal_number, coalesce(proposal.client_name, 'Client')), true
    ) returning * into deposit;
    insert into public.proposal_deposit_events(requirement_id, event_type, metadata)
      values (deposit.id, 'Required', jsonb_build_object('required_amount', amount, 'sent_with_proposal', true));
  elsif deposit.agreement_id is distinct from agreement.id or deposit.required_amount is distinct from amount then
    raise exception 'The existing deposit does not match the approved Service Agreement.';
  elsif not deposit.sent_with_proposal then
    update public.proposal_deposit_requirements set sent_with_proposal = true where id = deposit.id;
  end if;
  if agreement.status = 'Draft' then
    update public.service_agreements set status = 'Sent', sent_at = now(), sent_to = p_recipient,
      sent_by = p_sender, client_access_token = p_token, client_access_token_expires_at = p_expires_at
      where id = agreement.id;
  elsif lower(btrim(coalesce(agreement.sent_to, ''))) <> p_recipient then
    raise exception 'The Service Agreement was already addressed to another recipient.';
  end if;
  return agreement.id;
end;
$$;

-- The service API is the only caller. The fixed search path and explicit
-- table references keep this narrowly scoped; private helpers stay private.
revoke all on function public.prepare_proposal_deposit_agreement_email(uuid,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.prepare_proposal_deposit_agreement_email(uuid,text,text,text,timestamptz)
  to service_role;

create or replace function private.require_post_construction_deposit_before_agreement_send()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  deposit public.proposal_deposit_requirements;
  proposal public.proposals;
begin
  if new.proposal_id is null or new.status is not distinct from old.status then return new; end if;
  select * into proposal from public.proposals where id = new.proposal_id;
  select * into deposit from public.proposal_deposit_requirements where agreement_id = new.id;

  if new.status = 'Sent' and proposal.frequency = 'One-Time'
    and lower(coalesce(proposal.result->>'serviceName', '')) = 'post-construction cleaning'
    and not coalesce(deposit.sent_with_proposal, false)
    and (deposit.id is not null or (proposal.result->>'perVisitTotal')::numeric > 500)
    and not exists (select 1 from public.payments where deposit_requirement_id = deposit.id
      and voided_at is null and amount = deposit.required_amount) then
    raise exception 'Deposit confirmation required before this legacy Agreement can be sent.';
  end if;

  if new.status in ('Accepted', 'Active') and coalesce(deposit.sent_with_proposal, false)
    and (not proposal.is_current_revision or proposal.archived_at is not null
      or proposal.status not in ('Sent', 'Viewed', 'Accepted')) then
    raise exception 'This Agreement is linked to a Proposal that is no longer available.';
  end if;

  if new.status = 'Active' and (deposit.id is not null
      or (proposal.client_delivery_snapshot->>'automatic_deposit_agreement') = 'true')
    and (proposal.status <> 'Accepted' or not exists (select 1 from public.payments
      where deposit_requirement_id = deposit.id and voided_at is null and amount = deposit.required_amount)) then
    raise exception 'Accept the Proposal and record its Zelle deposit before activating the Agreement.';
  end if;
  return new;
end;
$$;

drop trigger service_agreements_require_pc_deposit_before_send on public.service_agreements;
create trigger service_agreements_require_pc_deposit_before_send
  before update of status on public.service_agreements
  for each row execute function private.require_post_construction_deposit_before_agreement_send();

create or replace function private.require_post_construction_agreement_job_path()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.proposal_id is not null and new.service_occurrence_id is null
    and exists (
      select 1 from public.proposals p where p.id = new.proposal_id and p.frequency = 'One-Time'
      and (lower(coalesce(p.result->>'serviceName', '')) = 'post-construction cleaning'
        or (p.client_delivery_snapshot->>'automatic_deposit_agreement') = 'true')
    ) then
    raise exception 'This Job must be created from the Service Agreement schedule.';
  end if;
  return new;
end;
$$;

create or replace function private.ensure_post_construction_deposit_requirement(p_proposal_id uuid,p_agreement_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare proposal_row public.proposals; settings_row public.business_settings; requirement_id uuid;
  accepted_total numeric; deposit_percent numeric; required_amount numeric; currency_code text;
begin
  select * into proposal_row from public.proposals where id=p_proposal_id for update;
  if not found or proposal_row.status<>'Accepted' or proposal_row.accepted is distinct from true
    or proposal_row.frequency<>'One-Time'
    or lower(coalesce(proposal_row.client_delivery_snapshot->>'service_name',proposal_row.result->>'serviceName',''))<>'post-construction cleaning'
  then return null; end if;
  select id into requirement_id from public.proposal_deposit_requirements where proposal_id=proposal_row.id;
  if found then
    update public.proposal_deposit_requirements set agreement_id=coalesce(agreement_id,p_agreement_id),updated_at=now() where id=requirement_id;
    return requirement_id;
  end if;
  select * into settings_row from public.business_settings limit 1;
  if settings_row.id is null then raise exception 'Business Settings are required before accepting this Proposal.'; end if;
  if coalesce(proposal_row.client_delivery_snapshot->>'per_visit_total','') !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception 'The sent Proposal snapshot does not contain a valid final total.';
  end if;
  accepted_total := round((proposal_row.client_delivery_snapshot->>'per_visit_total')::numeric,2);
  if accepted_total <= 500 and proposal_row.client_delivery_snapshot->>'deposit_percent' is null then
    return null;
  end if;
  deposit_percent := coalesce(nullif(proposal_row.client_delivery_snapshot->>'deposit_percent','')::numeric,settings_row.post_construction_deposit_percent);
  required_amount := round(accepted_total*deposit_percent/100,2);
  currency_code := coalesce(nullif(settings_row.currency,''),'USD');
  insert into public.proposal_deposit_requirements(
    proposal_id,agreement_id,client_id,property_id,currency,deposit_percent,accepted_total,required_amount,remaining_balance,
    payment_method,recipient_name,recipient_phone,rendered_memo
  ) values (
    proposal_row.id,p_agreement_id,proposal_row.client_id,proposal_row.property_id,currency_code,deposit_percent,accepted_total,
    required_amount,round(accepted_total-required_amount,2),settings_row.post_construction_payment_method,
    btrim(settings_row.post_construction_payment_recipient_name),settings_row.post_construction_payment_recipient_phone,
    private.render_post_construction_deposit_memo(settings_row.post_construction_payment_memo_template,proposal_row.proposal_number,coalesce(proposal_row.client_name,'Client'))
  ) returning id into requirement_id;
  insert into public.proposal_deposit_events(requirement_id,event_type,metadata)
  values(requirement_id,'Required',jsonb_build_object('accepted_total',accepted_total,'deposit_percent',deposit_percent,'required_amount',required_amount,'instruction_version',1));
  return requirement_id;
exception when unique_violation then
  select id into requirement_id from public.proposal_deposit_requirements where proposal_id=p_proposal_id;
  return requirement_id;
end $$;
revoke all on function private.ensure_post_construction_deposit_requirement(uuid,uuid) from public,anon,authenticated;

create or replace function public.mark_service_agreement_sent_for_delivery(p_agreement_id uuid,p_sent_to text,p_sent_by text,p_token text,p_token_expires_at timestamptz)
returns public.service_agreements language plpgsql security definer set search_path = '' as $$
declare proposal_id uuid; proposal_row public.proposals; agreement_row public.service_agreements; requirement_row public.proposal_deposit_requirements;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then raise exception 'Agreement delivery permission denied.' using errcode='42501'; end if;
  if length(btrim(coalesce(p_sent_to,'')))<3 then raise exception 'A client delivery recipient is required.'; end if;
  if p_token is null or length(p_token)<32 or p_token_expires_at<=now() then raise exception 'A valid secure Agreement token is required.'; end if;
  select a.proposal_id into proposal_id from public.service_agreements a where a.id=p_agreement_id;
  if proposal_id is not null then select * into proposal_row from public.proposals where id=proposal_id for update; end if;
  select * into agreement_row from public.service_agreements where id=p_agreement_id for update;
  if not found or agreement_row.archived_at is not null or agreement_row.status not in ('Draft','Sent') then raise exception 'This Agreement is unavailable for delivery.'; end if;
  if agreement_row.status='Sent' then return agreement_row; end if;
  if proposal_id is not null and proposal_row.frequency='One-Time' and lower(coalesce(proposal_row.result->>'serviceName',''))='post-construction cleaning' then
    select * into requirement_row from public.proposal_deposit_requirements where proposal_id=proposal_id for update;
    if (found or (proposal_row.result->>'perVisitTotal')::numeric > 500)
      and (requirement_row.status is distinct from 'Received' and requirement_row.status is distinct from 'Applied To Invoice'
      or not exists(select 1 from public.payments p where p.deposit_requirement_id=requirement_row.id and p.voided_at is null and p.amount=requirement_row.required_amount))
    then raise exception 'Deposit confirmation required before this Agreement can be sent.'; end if;
  end if;
  update public.service_agreements set status='Sent',sent_at=now(),sent_to=btrim(p_sent_to),sent_by=nullif(btrim(coalesce(p_sent_by,'')),''),
    client_access_token=p_token,client_access_token_expires_at=p_token_expires_at where id=agreement_row.id returning * into agreement_row;
  return agreement_row;
end $$;

create function private.close_superseded_deposit_agreement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  agreement public.service_agreements;
  deposit public.proposal_deposit_requirements;
begin
  if not old.is_current_revision or new.is_current_revision then return new; end if;
  select * into agreement from public.service_agreements
    where proposal_id = old.id and archived_at is null and status not in ('Cancelled', 'Archived')
    for update;
  if not found then return new; end if;
  select * into deposit from public.proposal_deposit_requirements where agreement_id = agreement.id for update;
  if not coalesce(deposit.sent_with_proposal, false) then return new; end if;
  if agreement.status not in ('Draft', 'Sent') or deposit.status in ('Received', 'Applied To Invoice') then
    raise exception 'Resolve the signed Service Agreement or received deposit before replacing this Proposal.';
  end if;
  update public.service_agreements set status = 'Cancelled', client_access_token = null,
    client_access_token_expires_at = null where id = agreement.id;
  return new;
end;
$$;
revoke all on function private.close_superseded_deposit_agreement() from public, anon, authenticated;
create trigger close_superseded_deposit_agreement before update of is_current_revision on public.proposals
  for each row execute function private.close_superseded_deposit_agreement();

notify pgrst, 'reload schema';
