-- Direct Job Custom Catalog Price
-- Forward-only correction.
--
-- Custom services with a positive configured base_price use that catalog
-- price as the authoritative base amount for direct Jobs.
--
-- Custom services without a usable positive base_price continue to require
-- a Master Admin price override.
--
-- Add-On pricing, pricing snapshots, authorization, and Master Admin
-- override behavior remain unchanged.
create or replace function public.create_direct_operational_job(
  p_client_id uuid,
  p_property_id uuid,
  p_service_id uuid,
  p_addon_ids uuid[] default '{}'::uuid[],
  p_scheduled_date date default null,
  p_start_time time default null,
  p_estimated_duration numeric default null,
  p_assigned_crew_id uuid default null,
  p_labor_hours numeric default 0,
  p_access_instructions text default null,
  p_internal_notes text default null,
  p_master_price_override numeric default null,
  p_addon_quantities jsonb default '[]'::jsonb
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_client public.clients;
  v_property public.properties;
  v_service public.services;
  v_crew public.crews;
  v_job public.jobs;
  v_quantity numeric;
  v_base numeric;
  v_addons numeric := 0;
  v_price numeric;
  v_effective_base numeric;
  v_addon public.service_addons;
  v_addon_snapshot jsonb := '[]'::jsonb;
  v_addon_quantity numeric;
  v_addon_unit_name text;
  v_addon_unit_price numeric;
  v_addon_line_total numeric;
  v_pricing_snapshot jsonb;
  v_scope jsonb;
  v_team jsonb := '[]'::jsonb;
  v_attempt integer;
  v_constraint_name text;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  v_role := public.current_user_role();
  if v_role not in ('Master Admin', 'Administrator', 'Manager') then
    raise exception 'Job creation permission denied.';
  end if;
  if p_master_price_override is not null and v_role <> 'Master Admin' then
    raise exception 'Only Master Admin can override a Direct Job price.';
  end if;
  if p_master_price_override is not null
    and (p_master_price_override = 'NaN'::numeric or p_master_price_override < 0)
  then
    raise exception 'Override Job Price must be greater than or equal to zero.';
  end if;
  if p_estimated_duration is not null
    and (p_estimated_duration = 'NaN'::numeric or p_estimated_duration < 0)
  then
    raise exception 'Estimated duration cannot be negative.';
  end if;
  if coalesce(p_labor_hours, 0) = 'NaN'::numeric or coalesce(p_labor_hours, 0) < 0 then
    raise exception 'Labor hours cannot be negative or invalid.';
  end if;
  if p_scheduled_date is null and p_start_time is not null then
    raise exception 'A start time requires a scheduled date.';
  end if;
  if jsonb_typeof(coalesce(p_addon_quantities, '[]'::jsonb)) <> 'array' then
    raise exception 'Add-On quantities must be a JSON array.';
  end if;

  select * into v_client from public.clients where id = p_client_id and archived_at is null;
  if not found then raise exception 'Active Client not found.'; end if;
  select * into v_property from public.properties
  where id = p_property_id and client_id = p_client_id and archived_at is null;
  if not found then raise exception 'The selected Property does not belong to the active Client.'; end if;
  select * into v_service from public.services
  where id = p_service_id and is_active and archived_at is null;
  if not found then raise exception 'Active Service not found.'; end if;
  if v_service.division is null
    or v_property.property_type is null
    or not (
      v_service.division = 'Both'
      or v_service.division = v_property.property_type
    )
  then
    raise exception 'The selected Service is not available for this Property division.';
  end if;
  if v_service.pricing_model is null
    or v_service.pricing_model not in (
      'Flat Rate', 'Size Tier', 'Per Square Foot', 'Per Bedroom',
      'Per Unit', 'Per Hour', 'Per Visit', 'Custom'
    )
  then
    raise exception 'The selected Service has an invalid pricing model.';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_addon_ids, '{}'::uuid[])) addon_id
    where not exists (
      select 1 from public.service_addon_links link
      join public.service_addons addon on addon.id = link.addon_id
      where link.service_id = v_service.id and link.addon_id = addon_id
      and addon.is_active and addon.archived_at is null
        and addon.division is not null
        and v_property.property_type is not null
        and (addon.division = 'Both' or addon.division = v_property.property_type)
    )
  ) then raise exception 'One or more selected Add-Ons are unavailable for this Service.'; end if;

  v_quantity := case when coalesce(v_property.square_feet, 0) > 0 then v_property.square_feet else 1 end;
  if v_service.pricing_model = 'Custom' then
    v_base := null;
  elsif v_service.pricing_model = 'Size Tier' then
    select tier.price into v_base from public.service_price_tiers tier
    where tier.service_id = v_service.id and tier.is_active
      and (tier.min_value is null or v_quantity >= tier.min_value)
      and (tier.max_value is null or v_quantity <= tier.max_value)
    order by tier.display_order, tier.min_value nulls first limit 1;
  elsif v_service.pricing_model in ('Flat Rate', 'Per Visit') then
    v_base := greatest(v_service.base_price, v_service.minimum_price);
  else
    v_base := greatest(v_service.base_price * v_quantity, v_service.minimum_price);
  end if;
  if (v_base is null or v_base = 'NaN'::numeric) and p_master_price_override is null then
    raise exception 'This Service uses custom pricing and requires a Master Admin Job price override.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_addon_quantities, '[]'::jsonb)) payload
    where jsonb_typeof(payload) <> 'object'
      or nullif(payload->>'addonId', '') is null
      or not ((payload->>'addonId')::uuid = any(coalesce(p_addon_ids, '{}'::uuid[])))
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_addon_quantities, '[]'::jsonb)) payload
    group by payload->>'addonId' having count(*) > 1
  ) then raise exception 'Add-On quantities must identify each selected Add-On at most once.'; end if;

  for v_addon in
    select addon.* from public.service_addons addon
    where addon.id = any(coalesce(p_addon_ids, '{}'::uuid[]))
    order by addon.display_order, addon.addon_name
  loop
    if coalesce(v_addon.pricing_config->>'pricing_type', 'Flat Price') = 'Per Unit' then
      select (payload->>'quantity')::numeric into v_addon_quantity
      from jsonb_array_elements(coalesce(p_addon_quantities, '[]'::jsonb)) payload
      where payload->>'addonId' = v_addon.id::text;
      if v_addon_quantity is null or v_addon_quantity = 'NaN'::numeric
        or v_addon_quantity < 1 or v_addon_quantity <> trunc(v_addon_quantity)
      then raise exception 'Enter a positive whole-number quantity for Add-On %.', v_addon.addon_name; end if;
      v_addon_unit_name := nullif(btrim(v_addon.pricing_config->>'unit_name'), '');
      v_addon_unit_price := (v_addon.pricing_config->>'unit_price')::numeric;
      if v_addon_unit_name is null or v_addon_unit_price is null
        or v_addon_unit_price = 'NaN'::numeric or v_addon_unit_price < 0
      then raise exception 'Per Unit Add-On % has invalid catalog pricing.', v_addon.addon_name; end if;
      v_addon_line_total := round(v_addon_quantity * v_addon_unit_price, 2);
      v_addon_snapshot := v_addon_snapshot || jsonb_build_array(jsonb_build_object(
        'id', v_addon.id, 'label', v_addon.addon_name, 'pricingType', 'Per Unit',
        'quantity', v_addon_quantity, 'unitName', v_addon_unit_name,
        'unitPrice', v_addon_unit_price, 'lineTotal', v_addon_line_total));
    else
      v_addon_quantity := 1;
      v_addon_unit_name := null;
      v_addon_line_total := round(case when v_addon.pricing_model = 'Custom'
        then case when coalesce(v_addon.pricing_config->>'supply_cost', '') ~ '^([0-9]+)(\.[0-9]+)?$'
          then (v_addon.pricing_config->>'supply_cost')::numeric else v_addon.price end
        else v_addon.price end, 2);
      v_addon_unit_price := v_addon_line_total;
      v_addon_snapshot := v_addon_snapshot || jsonb_build_array(jsonb_build_object(
        'id', v_addon.id, 'label', v_addon.addon_name, 'pricingType', 'Flat Price',
        'quantity', 1, 'unitName', null, 'unitPrice', v_addon_unit_price,
        'lineTotal', v_addon_line_total));
    end if;
    v_addons := v_addons + v_addon_line_total;
  end loop;

  v_price := round(coalesce(p_master_price_override, v_base + v_addons), 2);
  v_effective_base := round(v_price - v_addons, 2);
  if v_price = 'NaN'::numeric or v_price < 0 or v_effective_base < 0 then
    raise exception 'The authoritative Job price cannot be less than its selected Add-On total.';
  end if;
  v_pricing_snapshot := jsonb_build_object(
    'version', 1, 'baseServiceAmount', v_effective_base,
    'addons', v_addon_snapshot, 'totalAmount', v_price);
  if not public.is_valid_job_pricing_snapshot(v_pricing_snapshot, v_price) then
    raise exception 'The authoritative Job pricing snapshot is invalid.';
  end if;

  select coalesce(jsonb_agg(item order by ordinal), '[]'::jsonb) into v_scope
  from (
    select 0 as ordinal, jsonb_build_object('id', gen_random_uuid(), 'text', v_service.description) as item
    where nullif(btrim(coalesce(v_service.description, '')), '') is not null
    union all
    select row_number() over (order by addon.display_order, addon.addon_name)::integer,
      jsonb_build_object('id', gen_random_uuid(), 'text', 'Add-On: ' || addon.addon_name ||
        case when nullif(btrim(coalesce(addon.description, '')), '') is null then '' else ' - ' || addon.description end)
    from public.service_addons addon where addon.id = any(coalesce(p_addon_ids, '{}'::uuid[]))
  ) scope_rows;

  if p_assigned_crew_id is not null then
    select * into v_crew from public.crews
    where id = p_assigned_crew_id and status = 'Active' and archived_at is null;
    if not found then raise exception 'Active Crew not found.'; end if;
    select coalesce(jsonb_agg(coalesce(employee.preferred_name, nullif(trim(employee.first_name || ' ' || employee.last_name), '')) order by employee.last_name), '[]'::jsonb)
    into v_team from public.crew_members member join public.employees employee on employee.id = member.employee_id
    where member.crew_id = v_crew.id and employee.archived_at is null;
  end if;

  for v_attempt in 1..5 loop
    begin
      insert into public.jobs (
        job_number, proposal_id, service_occurrence_id, estimate_id, walkthrough_id,
        client_id, property_id, division, client_name, property_name, service_name,
        frequency, status, scheduled_date, start_time, estimated_duration,
        assigned_crew_id, assigned_crew_name, crew_lead_name, assigned_team,
        price, pricing_snapshot, deposit, balance, labor_hours, recommended_crew_size, scope,
        checklist, photos, access_instructions, internal_notes, completed_at
      ) values (
        'JOB-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'),
        null, null, null, null, v_client.id, v_property.id, v_property.property_type,
        coalesce(v_client.company_name, nullif(concat_ws(' ', v_client.first_name, v_client.last_name), ''), 'Client'),
        coalesce(v_property.property_name, v_property.address), v_service.service_name,
        'One-Time', case when p_scheduled_date is null then 'Ready to Schedule' when p_assigned_crew_id is null then 'Scheduled' else 'Crew Assigned' end,
        p_scheduled_date, case when p_scheduled_date is null then null else p_start_time end, p_estimated_duration,
        case when p_assigned_crew_id is null then null else v_crew.id end,
        case when p_assigned_crew_id is null then null else v_crew.crew_name end,
        case when p_assigned_crew_id is null then null else (
          select coalesce(employee.preferred_name, nullif(trim(employee.first_name || ' ' || employee.last_name), ''))
          from public.employees employee
          where employee.id = v_crew.crew_lead_id
        ) end,
        v_team, v_price, v_pricing_snapshot, 0, v_price, coalesce(p_labor_hours, 0), greatest(jsonb_array_length(v_team), 1),
        v_scope, '[]'::jsonb, '[]'::jsonb,
        coalesce(nullif(btrim(coalesce(p_access_instructions, '')), ''), v_property.access_instructions),
        nullif(btrim(coalesce(p_internal_notes, '')), ''), null
      ) returning * into v_job;
      return v_job;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name is distinct from 'jobs_job_number_key' then
        raise;
      end if;
    end;
  end loop;
  raise exception 'A unique Job number could not be generated.';
end;
$$;
