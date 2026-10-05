begin;

alter function public.get_assigned_field_walkthroughs()
rename to get_assigned_field_walkthroughs_before_live_pricing_20261005;

revoke all on function public.get_assigned_field_walkthroughs_before_live_pricing_20261005()
from public, anon, authenticated;

create function public.get_assigned_field_walkthroughs()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with projected as (
    select item.value, item.ordinality
    from jsonb_array_elements(public.get_assigned_field_walkthroughs_before_live_pricing_20261005())
      with ordinality as item(value, ordinality)
  )
  select coalesce(jsonb_agg(
    jsonb_set(
      projected.value || jsonb_build_object('division', walkthrough.division),
      '{measurements}',
      coalesce(projected.value->'measurements', '{}'::jsonb) || jsonb_build_object(
        'catalogAddons', coalesce(walkthrough.measurements->'catalogAddons', '[]'::jsonb),
        'assessmentPricing', walkthrough.measurements->'assessmentPricing',
        'frequency', walkthrough.measurements->'frequency',
        'customIntervalDays', walkthrough.measurements->'customIntervalDays',
        'occupied', walkthrough.measurements->'occupied',
        'stations', walkthrough.measurements->'stations',
        'units', walkthrough.measurements->'units',
        'targetCompletionHours', walkthrough.measurements->'targetCompletionHours',
        'targetProjectDays', walkthrough.measurements->'targetProjectDays',
        'workdayHours', walkthrough.measurements->'workdayHours'
      ),
      true
    ) order by projected.ordinality
  ), '[]'::jsonb)
  from projected
  join public.walkthroughs walkthrough on walkthrough.id = (projected.value->>'id')::uuid;
$$;

revoke all on function public.get_assigned_field_walkthroughs()
from public, anon, authenticated;
grant execute on function public.get_assigned_field_walkthroughs() to authenticated;

alter function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
rename to submit_assigned_field_walkthrough_before_live_pricing_20261005;

revoke all on function public.submit_assigned_field_walkthrough_before_live_pricing_20261005(uuid, jsonb, boolean)
from public, anon, authenticated;

create function public.submit_assigned_field_walkthrough(
  p_id uuid,
  p_measurements jsonb,
  p_complete boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  walkthrough public.walkthroughs;
  addon jsonb;
  evidence jsonb;
  suggestion jsonb;
  addon_row public.service_addons;
  canonical_addons jsonb := '[]'::jsonb;
  pricing jsonb := p_measurements->'assessmentPricing';
  legacy_measurements jsonb;
  seen_addons uuid[] := array[]::uuid[];
  seen_suggestions uuid[] := array[]::uuid[];
begin
  if not public.can_perform_scheduled_walkthrough(p_id) then
    raise exception 'Scheduled assignment no longer available' using errcode = '42501';
  end if;
  if p_measurements is null or jsonb_typeof(p_measurements) <> 'object' then
    raise exception 'Measurements must be an object';
  end if;

  select * into walkthrough from public.walkthroughs where id = p_id for update;

  if p_measurements ? 'catalogAddons' then
    if jsonb_typeof(p_measurements->'catalogAddons') <> 'array'
      or jsonb_array_length(p_measurements->'catalogAddons') > 50 then
      raise exception 'Invalid catalog add-ons';
    end if;
    for addon in select value from jsonb_array_elements(p_measurements->'catalogAddons') loop
      if jsonb_typeof(addon) <> 'object'
        or exists (select 1 from jsonb_object_keys(addon) key where key not in ('id','catalogAddonId','name','quantity'))
        or nullif(addon->>'catalogAddonId', '') is null then
        raise exception 'Invalid catalog add-on selection';
      end if;
      select * into addon_row from public.service_addons candidate
      where candidate.id = (addon->>'catalogAddonId')::uuid
        and candidate.is_active and candidate.archived_at is null;
      if not found or addon_row.id = any(seen_addons) then raise exception 'Invalid or duplicate catalog add-on'; end if;
      if not exists (
        select 1 from public.service_addon_links link
        join public.services service on service.id = link.service_id
        where link.addon_id = addon_row.id and service.is_active and service.archived_at is null
          and service.service_name = walkthrough.measurements->>'serviceType'
          and service.division in (walkthrough.division, 'Both')
      ) then raise exception 'Catalog add-on is not available for this service'; end if;
      if coalesce(addon_row.pricing_config->>'pricing_type', 'Flat Price') = 'Per Unit' then
        if jsonb_typeof(addon->'quantity') <> 'number'
          or (addon->>'quantity')::numeric < 1
          or trunc((addon->>'quantity')::numeric) <> (addon->>'quantity')::numeric then
          raise exception 'Per-unit add-on quantity must be a positive whole number';
        end if;
      elsif addon ? 'quantity' and (jsonb_typeof(addon->'quantity') <> 'number' or (addon->>'quantity')::numeric <> 1) then
        raise exception 'Flat-price add-on quantity must be one';
      end if;
      seen_addons := array_append(seen_addons, addon_row.id);
      canonical_addons := canonical_addons || jsonb_build_array(jsonb_build_object(
        'id', addon_row.id, 'catalogAddonId', addon_row.id, 'name', addon_row.addon_name,
        'description', addon_row.description, 'price', addon_row.price, 'pricingModel', addon_row.pricing_model,
        'unitLabel', addon_row.unit_label,
        'pricingType', case when addon_row.pricing_config->>'pricing_type' = 'Per Unit' then 'Per Unit' else 'Flat Price' end,
        'quantity', case when addon_row.pricing_config->>'pricing_type' = 'Per Unit' then (addon->>'quantity')::integer else 1 end
      ));
    end loop;
  end if;

  if pricing is not null then
    if jsonb_typeof(pricing) <> 'object'
      or exists (select 1 from jsonb_object_keys(pricing) key where key not in ('version','recommendedCondition','conditionEvidence','laborPlan','laborEvidence','suggestedAddons','explanation'))
      or pricing->>'version' <> '1'
      or coalesce(pricing->>'recommendedCondition','') not in ('','Light','Average','Heavy','Extreme')
      or jsonb_typeof(coalesce(pricing->'conditionEvidence','[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(pricing->'laborPlan','{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(pricing->'laborEvidence','[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(pricing->'suggestedAddons','[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(pricing->'explanation','[]'::jsonb)) <> 'array'
      or pricing::text ~* '(price|amount|wage|payroll|margin|percent|discount|cost)' then
      raise exception 'Invalid assessment pricing interpretation';
    end if;
    if jsonb_array_length(coalesce(pricing->'conditionEvidence','[]'::jsonb)) > 100
      or jsonb_array_length(coalesce(pricing->'laborEvidence','[]'::jsonb)) > 20
      or jsonb_array_length(coalesce(pricing->'suggestedAddons','[]'::jsonb)) > 50
      or jsonb_array_length(coalesce(pricing->'explanation','[]'::jsonb)) > 20 then
      raise exception 'Assessment pricing interpretation is too large';
    end if;
    for evidence in select value from jsonb_array_elements(coalesce(pricing->'conditionEvidence','[]'::jsonb)) loop
      if jsonb_typeof(evidence) <> 'object'
        or exists (select 1 from jsonb_object_keys(evidence) key where key not in ('key','value','scope'))
        or coalesce(evidence->>'scope','') not in ('overall','local')
        or length(coalesce(evidence->>'key','')) not between 1 and 100
        or length(coalesce(evidence->>'value','')) not between 1 and 200 then
        raise exception 'Invalid condition evidence';
      end if;
    end loop;
    if exists (
      select 1 from jsonb_array_elements(coalesce(pricing->'laborEvidence','[]'::jsonb)) item
      where jsonb_typeof(item) <> 'string' or length(item #>> '{}') > 500
    ) or exists (
      select 1 from jsonb_array_elements(coalesce(pricing->'explanation','[]'::jsonb)) item
      where jsonb_typeof(item) <> 'string' or length(item #>> '{}') > 500
    ) then raise exception 'Invalid assessment explanation'; end if;
    if exists (select 1 from jsonb_object_keys(coalesce(pricing->'laborPlan','{}'::jsonb)) key
      where key not in ('durationLabel','minimumHours','maximumHours','minimumCrew','crewOpenEnded','level'))
      or coalesce(pricing->'laborPlan'->>'minimumHours','') !~ '^$|^[0-9]+(\.[0-9]+)?$'
      or coalesce(pricing->'laborPlan'->>'maximumHours','') !~ '^$|^[0-9]+(\.[0-9]+)?$'
      or coalesce(pricing->'laborPlan'->>'minimumCrew','') !~ '^$|^[1-9][0-9]*$'
      or coalesce(pricing->'laborPlan'->>'crewOpenEnded','') not in ('','true','false') then
      raise exception 'Invalid labor plan';
    end if;
    for suggestion in select value from jsonb_array_elements(coalesce(pricing->'suggestedAddons','[]'::jsonb)) loop
      if jsonb_typeof(suggestion) <> 'object'
        or exists (select 1 from jsonb_object_keys(suggestion) key where key not in ('catalogAddonId','name','disposition'))
        or coalesce(suggestion->>'disposition','') not in ('Pending','Included','Not Included')
        or coalesce(suggestion->>'catalogAddonId','') !~ '^[0-9a-fA-F-]{36}$' then
        raise exception 'Invalid add-on suggestion';
      end if;
      select * into addon_row from public.service_addons candidate
      where candidate.id = (suggestion->>'catalogAddonId')::uuid
        and candidate.is_active and candidate.archived_at is null;
      if not found or addon_row.id = any(seen_suggestions)
        or suggestion->>'name' is distinct from addon_row.addon_name
        or not exists (
          select 1 from public.service_addon_links link
          join public.services service on service.id = link.service_id
          where link.addon_id = addon_row.id and service.is_active and service.archived_at is null
            and service.service_name = walkthrough.measurements->>'serviceType'
            and service.division in (walkthrough.division, 'Both')
        ) then raise exception 'Invalid or unavailable add-on suggestion'; end if;
      seen_suggestions := array_append(seen_suggestions, addon_row.id);
    end loop;
  end if;

  legacy_measurements := p_measurements
    - 'catalogAddons' - 'assessmentPricing' - 'frequency' - 'customIntervalDays' - 'occupied'
    - 'stations' - 'units' - 'targetCompletionHours' - 'workerHourlyPay'
    - 'targetProfitMarginPercent' - 'targetProjectDays' - 'workdayHours';

  perform public.submit_assigned_field_walkthrough_before_live_pricing_20261005(p_id, legacy_measurements, p_complete);

  update public.walkthroughs set measurements = measurements
    || case when p_measurements ? 'catalogAddons' then jsonb_build_object('catalogAddons', canonical_addons) else '{}'::jsonb end
    || case when pricing is not null then jsonb_build_object('assessmentPricing', pricing) else '{}'::jsonb end
  where id = p_id;
end;
$$;

revoke all on function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
from public, anon, authenticated;
grant execute on function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean) to authenticated;

create function public.return_walkthrough_pricing_to_assessment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  walkthrough public.walkthroughs;
begin
  if (select auth.uid()) is null or not public.has_walkthrough_execution_role()
    or public.current_employee_id() is null then
    raise exception 'Field access denied' using errcode = '42501';
  end if;
  select * into walkthrough from public.walkthroughs where id = p_id for update;
  if not found or walkthrough.status <> 'Completed' or walkthrough.archived_at is not null
    or walkthrough.assigned_employee_id is distinct from public.current_employee_id()
    or walkthrough.walkthrough_date is null or walkthrough.walkthrough_time is null then
    raise exception 'Completed assignment is not available' using errcode = '42501';
  end if;
  if exists (select 1 from public.proposals proposal where proposal.walkthrough_id = p_id and proposal.archived_at is null) then
    raise exception 'An active Proposal already exists' using errcode = '23505';
  end if;
  update public.walkthroughs
  set status = 'Scheduled', sales_stage = 'Assessment In Progress'
  where id = p_id;
end;
$$;

revoke all on function public.return_walkthrough_pricing_to_assessment(uuid)
from public, anon, authenticated;
grant execute on function public.return_walkthrough_pricing_to_assessment(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
