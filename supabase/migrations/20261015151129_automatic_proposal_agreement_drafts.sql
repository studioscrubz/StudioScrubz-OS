-- Generate exactly one reviewable Draft Service Agreement whenever a valid
-- Proposal is accepted. Existing Agreements and historical Proposal records
-- are intentionally left untouched.
begin;

-- Scheduling is an administrative review concern. Drafts may be incomplete,
-- but no incomplete Agreement may leave Draft status.
alter table public.service_agreements alter column start_date drop not null;
alter table public.service_agreements
  add constraint service_agreements_start_date_required_after_draft
  check (status in ('Draft','Cancelled','Archived') or start_date is not null) not valid;

alter table public.service_agreements
  drop constraint if exists service_agreements_custom_schedule_check,
  add constraint service_agreements_custom_schedule_check check (
    status in ('Draft','Cancelled','Archived')
    or (frequency = 'Custom' and custom_interval_days is not null and custom_interval_days >= 1)
    or (frequency <> 'Custom' and custom_interval_days is null)
  ) not valid,
  drop constraint if exists service_agreements_twice_monthly_schedule_check,
  add constraint service_agreements_twice_monthly_schedule_check check (
    status in ('Draft','Cancelled','Archived')
    or (
      frequency = 'Twice Monthly'
      and day_of_month between 1 and 28
      and second_day_of_month between 1 and 28
      and day_of_month <> second_day_of_month
      and third_day_of_month is null
    )
    or (
      service_name = 'StudioScrubz Upkeep Plan'
      and frequency = 'Monthly'
      and day_of_month between 1 and 28
      and second_day_of_month between 1 and 28
      and third_day_of_month between 1 and 28
      and day_of_month <> second_day_of_month
      and day_of_month <> third_day_of_month
      and second_day_of_month <> third_day_of_month
    )
    or (frequency <> 'Twice Monthly' and service_name <> 'StudioScrubz Upkeep Plan'
      and second_day_of_month is null and third_day_of_month is null)
  ) not valid,
  drop constraint if exists service_agreements_upkeep_plan_schedule_check,
  add constraint service_agreements_upkeep_plan_schedule_check check (
    status in ('Draft','Cancelled','Archived')
    or (
      service_name = 'StudioScrubz Upkeep Plan'
      and division = 'Residential'
      and frequency = 'Monthly'
      and billing_type = 'Monthly'
      and day_of_month between 1 and 28
      and second_day_of_month between 1 and 28
      and third_day_of_month between 1 and 28
      and day_of_month <> second_day_of_month
      and day_of_month <> third_day_of_month
      and second_day_of_month <> third_day_of_month
    )
    or (service_name <> 'StudioScrubz Upkeep Plan' and third_day_of_month is null)
  ) not valid;

create or replace function private.require_reviewed_agreement_before_send()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.status = 'Draft' and new.status not in ('Draft','Cancelled','Archived') then
    if new.start_date is null then raise exception 'Confirm the Agreement start date before sending.'; end if;
    if new.billing_amount <= 0 then raise exception 'Confirm a positive Agreement billing amount before sending.'; end if;
    if new.frequency in ('Weekly','Biweekly','Every 4 Weeks','Multiple Days Per Week')
      and jsonb_array_length(new.days_of_week) = 0 then
      raise exception 'Confirm at least one service day before sending.';
    end if;
    if new.frequency = 'Monthly' and new.service_name <> 'StudioScrubz Upkeep Plan'
      and new.day_of_month is null then raise exception 'Confirm the monthly service day before sending.'; end if;
    if new.frequency = 'Twice Monthly' and (new.day_of_month is null or new.second_day_of_month is null) then
      raise exception 'Confirm both monthly service days before sending.';
    end if;
    if new.frequency = 'Custom' and new.custom_interval_days is null then
      raise exception 'Confirm the custom service interval before sending.';
    end if;
    if new.service_name = 'StudioScrubz Upkeep Plan' and (
      new.frequency <> 'Monthly' or new.billing_type <> 'Monthly'
      or new.day_of_month is null or new.second_day_of_month is null or new.third_day_of_month is null
    ) then raise exception 'Confirm all three Upkeep Plan visit days before sending.'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.require_reviewed_agreement_before_send() from public, anon, authenticated;
drop trigger if exists service_agreements_require_review_before_send on public.service_agreements;
create trigger service_agreements_require_review_before_send
before update of status on public.service_agreements
for each row execute function private.require_reviewed_agreement_before_send();

create or replace function private.ensure_proposal_draft_agreement(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  proposal_row public.proposals;
  settings_row public.business_settings;
  agreement_id uuid;
  pricing jsonb;
  scope_snapshot jsonb;
  amount numeric;
  service_name text;
  is_upkeep boolean;
  review_fields jsonb := '[]'::jsonb;
  special_instructions text;
begin
  select * into proposal_row from public.proposals where id = p_proposal_id for update;
  if not found or proposal_row.archived_at is not null
    or proposal_row.status <> 'Accepted' or proposal_row.accepted is distinct from true
    or proposal_row.accepted_at is null or proposal_row.is_current_revision is distinct from true
    or proposal_row.superseded_at is not null then return null; end if;

  select id into agreement_id from public.service_agreements
  where proposal_id = proposal_row.id and archived_at is null
    and status not in ('Cancelled','Archived') limit 1;
  if agreement_id is not null then return agreement_id; end if;
  if exists(select 1 from public.service_agreements where proposal_id = proposal_row.id) then
    raise exception 'This accepted Proposal has only cancelled or archived Agreements. Explicit administrative recovery is required.';
  end if;

  if jsonb_typeof(proposal_row.result) <> 'object' then
    raise exception 'The accepted Proposal pricing snapshot is unavailable.';
  end if;
  service_name := nullif(btrim(proposal_row.result->>'serviceName'), '');
  if service_name is null or coalesce(proposal_row.result->>'perVisitTotal','') !~ '^[0-9]+([.][0-9]+)?$' then
    raise exception 'The accepted Proposal service or price is invalid.';
  end if;
  is_upkeep := service_name = 'StudioScrubz Upkeep Plan';
  if is_upkeep then
    if proposal_row.division <> 'Residential'
      or jsonb_typeof(proposal_row.result->'upkeepPlan') <> 'object'
      or coalesce(proposal_row.result#>>'{upkeepPlan,monthlyPackage}','') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce((proposal_row.result#>>'{upkeepPlan,visitsIncluded}')::integer, 0) <> 3 then
      raise exception 'The accepted Upkeep Plan package snapshot is invalid.';
    end if;
    amount := round((proposal_row.result#>>'{upkeepPlan,monthlyPackage}')::numeric, 2);
  else
    amount := round((proposal_row.result->>'perVisitTotal')::numeric, 2);
  end if;
  if amount <= 0 then raise exception 'The accepted Proposal price must be greater than zero.'; end if;

  scope_snapshot := case when jsonb_typeof(proposal_row.result->'scope') = 'array'
    then proposal_row.result->'scope' else '[]'::jsonb end;
  if proposal_row.client_id is null then review_fields := review_fields || '"client"'::jsonb; end if;
  if proposal_row.property_id is null then review_fields := review_fields || '"property"'::jsonb; end if;
  if proposal_row.requested_date is null then review_fields := review_fields || '"start_date"'::jsonb; end if;
  if proposal_row.frequency in ('Weekly','Biweekly','Every 4 Weeks','Multiple Days Per Week') then
    review_fields := review_fields || '"days_of_week"'::jsonb;
  elsif proposal_row.frequency in ('Monthly','Twice Monthly') or is_upkeep then
    review_fields := review_fields || '"monthly_visit_days"'::jsonb;
  elsif proposal_row.frequency = 'Custom' and nullif(proposal_row.result->>'customIntervalDays','') is null then
    review_fields := review_fields || '"custom_interval_days"'::jsonb;
  end if;
  review_fields := review_fields || '"default_start_time"'::jsonb;
  if proposal_row.division = 'Commercial' then review_fields := review_fields || '"assigned_crew"'::jsonb; end if;

  select * into settings_row from public.business_settings limit 1;
  special_instructions := nullif(concat_ws(E'\n\n',
    nullif(proposal_row.result#>>'{terms,accessRequirements}', ''),
    nullif(proposal_row.result#>>'{terms,specialConditions}', '')
  ), '');
  pricing := jsonb_build_object(
    'source','Accepted Proposal',
    'service_description',proposal_row.result->'serviceDescription',
    'standard_service_price',coalesce((proposal_row.result->>'baseEstimateAmount')::numeric,amount),
    'frequency',case when is_upkeep then 'Monthly' else proposal_row.frequency end,
    'recurring_pricing_rule_id',proposal_row.result->'recurringPricingRuleId',
    'recurring_pricing_rule_name',proposal_row.result->'recurringPricingRuleName',
    'frequency_discount_label',coalesce(proposal_row.result->>'recurringPricingRuleName',proposal_row.frequency || ' Service Discount'),
    'frequency_discount_percent',coalesce((proposal_row.result->>'frequencyDiscountPercent')::numeric,0),
    'frequency_discount_amount',coalesce((proposal_row.result->>'frequencyDiscount')::numeric,0),
    'price_after_frequency_discount',greatest(0,coalesce((proposal_row.result->>'baseEstimateAmount')::numeric,amount)-coalesce((proposal_row.result->>'frequencyDiscount')::numeric,0)),
    'custom_discount_amount',coalesce((proposal_row.result->>'inheritedManualDiscount')::numeric,0)+coalesce((proposal_row.result->>'manualDiscount')::numeric,0),
    'taxes',coalesce((proposal_row.result->>'taxes')::numeric,0),
    'final_per_visit_price',(proposal_row.result->>'perVisitTotal')::numeric,
    'estimated_monthly_total',proposal_row.result->'monthlyTotal',
    'accepted_pricing_allocation',proposal_row.result->'acceptedPricingAllocation',
    'estimated_cleaning_days',proposal_row.result->'estimatedCleaningDays',
    'estimated_hours_per_day',proposal_row.result->'estimatedHoursPerDay',
    'requested_service_date',to_jsonb(proposal_row.requested_date),
    'accepted_proposal_result',proposal_row.result,
    'accepted_delivery_snapshot',proposal_row.client_delivery_snapshot,
    'accepted_revision_number',proposal_row.revision_number,
    'upkeep_plan',case when is_upkeep then proposal_row.result->'upkeepPlan' else 'null'::jsonb end,
    'catalog_addons',case when jsonb_typeof(proposal_row.result->'adjustments')='array' then proposal_row.result->'adjustments' else '[]'::jsonb end,
    'admin_review_required_fields',review_fields,
    'captured_at',to_jsonb(proposal_row.accepted_at)
  );

  insert into public.service_agreements(
    agreement_number,client_id,property_id,proposal_id,division,agreement_name,service_name,
    frequency,days_of_week,interval_weeks,day_of_month,second_day_of_month,third_day_of_month,
    custom_interval_days,start_date,end_date,auto_renew,billing_type,billing_amount,pricing_snapshot,
    payment_terms,agreement_terms,cancellation_terms,scope,special_instructions,assigned_crew_id,
    default_start_time,estimated_duration,status,notes
  ) values (
    'AGR-PA-' || replace(proposal_row.id::text,'-',''),proposal_row.client_id,proposal_row.property_id,
    proposal_row.id,proposal_row.division,service_name || ' Service Agreement',service_name,
    case when is_upkeep then 'Monthly' else proposal_row.frequency end,'[]'::jsonb,1,null,null,null,
    case when proposal_row.frequency='Custom' and coalesce(proposal_row.result->>'customIntervalDays','') ~ '^[0-9]+$'
      then (proposal_row.result->>'customIntervalDays')::integer else null end,
    proposal_row.requested_date,null,false,case when is_upkeep then 'Monthly' else 'Per Visit' end,
    amount,pricing,nullif(proposal_row.result#>>'{terms,paymentTerms}',''),
    settings_row.default_service_agreement_terms,
    coalesce(nullif(proposal_row.result#>>'{terms,cancellationPolicy}',''),settings_row.default_cancellation_terms),
    scope_snapshot,special_instructions,null,null,
    case when coalesce(proposal_row.result->>'estimatedDuration','') ~ '^[0-9]+([.][0-9]+)?$'
      then (proposal_row.result->>'estimatedDuration')::numeric else null end,
    'Draft',proposal_row.notes
  ) returning id into agreement_id;

  insert into public.proposal_history(proposal_id,event_type,previous_status,new_status,description,metadata,performed_by)
  values(proposal_row.id,'Service Agreement Created','Accepted','Accepted',
    'Draft Service Agreement created automatically for staff review.',
    jsonb_build_object('agreement_id',agreement_id,'status','Draft','proposal_revision_number',proposal_row.revision_number,
      'admin_review_required_fields',review_fields),'System');
  return agreement_id;
exception when unique_violation then
  select id into agreement_id from public.service_agreements
  where proposal_id=p_proposal_id and archived_at is null and status not in ('Cancelled','Archived') limit 1;
  if agreement_id is null then raise; end if;
  return agreement_id;
end;
$$;
revoke all on function private.ensure_proposal_draft_agreement(uuid) from public, anon, authenticated;

-- Compatibility wrapper retained for existing post-construction callers.
create or replace function private.ensure_post_construction_draft_agreement(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.proposals where id=p_proposal_id and frequency='One-Time'
    and lower(coalesce(result->>'serviceName',''))='post-construction cleaning') then return null; end if;
  return private.ensure_proposal_draft_agreement(p_proposal_id);
end;
$$;
revoke all on function private.ensure_post_construction_draft_agreement(uuid) from public, anon, authenticated;

-- All accepted proposals receive an Agreement; only Post-Construction keeps
-- the additional deposit requirement.
create or replace function private.ensure_post_construction_acceptance_handoff(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare agreement_id uuid; requirement_id uuid;
begin
  agreement_id := private.ensure_proposal_draft_agreement(p_proposal_id);
  if agreement_id is null then return null; end if;
  if exists(select 1 from public.proposals where id=p_proposal_id and frequency='One-Time'
    and lower(coalesce(result->>'serviceName',''))='post-construction cleaning') then
    requirement_id := private.ensure_post_construction_deposit_requirement(p_proposal_id,agreement_id);
  end if;
  return jsonb_build_object('agreement_id',agreement_id,'deposit_requirement_id',requirement_id);
end;
$$;
revoke all on function private.ensure_post_construction_acceptance_handoff(uuid) from public, anon, authenticated;

create or replace function private.create_post_construction_agreement_after_acceptance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='Accepted' and new.accepted is true
    and (old.status is distinct from new.status or old.accepted is distinct from new.accepted) then
    perform private.ensure_post_construction_acceptance_handoff(new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.create_post_construction_agreement_after_acceptance() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
