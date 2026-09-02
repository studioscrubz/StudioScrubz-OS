-- Preserve immutable Add-On quantities and prices through Job and Invoice handoff.
begin;

alter table public.jobs add column pricing_snapshot jsonb;

create or replace view public.jobs_operational_safe
with (security_barrier=true, security_invoker=true) as
select job.id,job.job_number,job.proposal_id,job.service_occurrence_id,job.estimate_id,job.walkthrough_id,
  job.client_id,job.property_id,job.division,job.client_name,job.property_name,job.service_name,job.frequency,
  job.status,job.scheduled_date,job.start_time,job.estimated_duration,job.assigned_crew_id,
  job.assigned_crew_name,job.crew_lead_name,job.assigned_team,job.scope,job.checklist,
  job.access_instructions,job.internal_notes,job.completed_at,job.created_at,job.updated_at,job.archived_at,
  job.operational_started_at,job.operational_ended_at,
  case when jsonb_typeof(job.pricing_snapshot->'addons') = 'array' then (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', addon->>'id', 'label', addon->>'label', 'pricingType', addon->>'pricingType',
      'quantity', case when jsonb_typeof(addon->'quantity') = 'number' then (addon->>'quantity')::numeric else null end,
      'unitName', addon->>'unitName')), '[]'::jsonb)
    from jsonb_array_elements(job.pricing_snapshot->'addons') addon
  ) else null end as contracted_addons
from public.jobs job
where public.has_any_role(array['Master Admin','Administrator','Manager'])
   or public.is_assigned_to_crew(job.assigned_crew_id);
revoke all on public.jobs_operational_safe from public, anon, authenticated;
grant select on public.jobs_operational_safe to authenticated;

create or replace function public.is_valid_job_pricing_snapshot(p_snapshot jsonb, p_authoritative_total numeric)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_base numeric;
  v_total numeric;
  v_addon_total numeric := 0;
  v_addon jsonb;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_total numeric;
begin
  if jsonb_typeof(p_snapshot) is distinct from 'object'
    or p_snapshot->>'version' is distinct from '1'
    or jsonb_typeof(p_snapshot->'baseServiceAmount') is distinct from 'number'
    or jsonb_typeof(p_snapshot->'totalAmount') is distinct from 'number'
    or jsonb_typeof(p_snapshot->'addons') is distinct from 'array'
  then return false; end if;
  v_base := (p_snapshot->>'baseServiceAmount')::numeric;
  v_total := (p_snapshot->>'totalAmount')::numeric;
  if v_base = 'NaN'::numeric or v_total = 'NaN'::numeric
    or v_base < 0 or v_total < 0 or p_authoritative_total is null
  then return false; end if;
  for v_addon in select value from jsonb_array_elements(p_snapshot->'addons') loop
    if jsonb_typeof(v_addon) <> 'object'
      or nullif(btrim(v_addon->>'id'), '') is null
      or nullif(btrim(v_addon->>'label'), '') is null
      or v_addon->>'pricingType' not in ('Flat Price','Per Unit')
      or jsonb_typeof(v_addon->'quantity') is distinct from 'number'
      or jsonb_typeof(v_addon->'unitPrice') is distinct from 'number'
      or jsonb_typeof(v_addon->'lineTotal') is distinct from 'number'
    then return false; end if;
    v_quantity := (v_addon->>'quantity')::numeric;
    v_unit_price := (v_addon->>'unitPrice')::numeric;
    v_line_total := (v_addon->>'lineTotal')::numeric;
    if v_quantity = 'NaN'::numeric or v_unit_price = 'NaN'::numeric or v_line_total = 'NaN'::numeric
      or v_quantity < 1 or v_quantity <> trunc(v_quantity)
      or v_unit_price < 0 or v_line_total < 0
    then return false; end if;
    if v_addon->>'pricingType' = 'Per Unit' and (
      nullif(btrim(v_addon->>'unitName'), '') is null
      or round(v_quantity * v_unit_price, 2) <> round(v_line_total, 2)
    ) then return false; end if;
    if v_addon->>'pricingType' = 'Flat Price' and v_quantity <> 1 then return false; end if;
    v_addon_total := v_addon_total + v_line_total;
  end loop;
  return round(v_base + v_addon_total, 2) = round(v_total, 2)
    and round(v_total, 2) = round(p_authoritative_total, 2);
exception when others then
  return false;
end;
$$;

revoke all on function public.is_valid_job_pricing_snapshot(jsonb,numeric)
  from public, anon, authenticated;
create or replace function public.create_job_from_service_occurrence(p_occurrence_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  occurrence_row public.service_occurrences;
  agreement_row public.service_agreements;
  client_row public.clients;
  property_row public.properties;
  crew_row public.crews;
  proposal_row public.proposals;
  job_row public.jobs;
  team jsonb := '[]'::jsonb;
  job_amount numeric;
  job_pricing_snapshot jsonb;
  job_date date;
  attempt integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_profiles where id = auth.uid() and is_active
  ) then raise exception 'An active authenticated profile is required.'; end if;
  caller_role := public.current_user_role();
  if caller_role not in ('Master Admin','Administrator','Manager') then
    raise exception 'Job creation permission is required.';
  end if;

  select * into occurrence_row from public.service_occurrences
  where id = p_occurrence_id for update;
  if not found then raise exception 'Service occurrence not found.'; end if;

  select * into agreement_row from public.service_agreements
  where id = occurrence_row.agreement_id for update;
  if not found or agreement_row.status <> 'Active' or agreement_row.archived_at is not null then
    raise exception 'Jobs can only be created for an Active Service Agreement.';
  end if;

  if occurrence_row.job_id is not null then
    select * into job_row from public.jobs where id = occurrence_row.job_id and archived_at is null;
    if found then return job_row; end if;
  end if;
  select * into job_row from public.jobs
  where service_occurrence_id = occurrence_row.id and archived_at is null limit 1;
  if found then
    update public.service_occurrences set job_id = job_row.id, status = 'Job Created'
    where id = occurrence_row.id;
    return job_row;
  end if;
  if occurrence_row.status <> 'Scheduled' then
    raise exception 'Only a Scheduled occurrence can create a Job.';
  end if;
  if occurrence_row.scheduled_date < agreement_row.start_date
    or (agreement_row.end_date is not null and not agreement_row.auto_renew and occurrence_row.scheduled_date > agreement_row.end_date) then
    raise exception 'Service occurrence falls outside the active Agreement term.';
  end if;

  select * into client_row from public.clients where id = agreement_row.client_id and archived_at is null;
  select * into property_row from public.properties where id = agreement_row.property_id and archived_at is null;
  if client_row.id is null or property_row.id is null then
    raise exception 'The Agreement requires active Client and Property relationships.';
  end if;
  if agreement_row.proposal_id is not null then
    select * into proposal_row from public.proposals where id = agreement_row.proposal_id;
  end if;
  if occurrence_row.assigned_crew_id is not null then
    select * into crew_row from public.crews
    where id = occurrence_row.assigned_crew_id
      and status = 'Active'
      and archived_at is null;
    if not found then
      raise exception 'The occurrence assigned crew is no longer active. Update the occurrence crew before creating the Job.';
    end if;
    select coalesce(jsonb_agg(coalesce(e.preferred_name, nullif(trim(e.first_name || ' ' || e.last_name), '')) order by e.last_name), '[]'::jsonb)
    into team from public.crew_members cm join public.employees e on e.id = cm.employee_id
    where cm.crew_id = crew_row.id;
  end if;
  job_amount := case when agreement_row.billing_type = 'Per Visit' then agreement_row.billing_amount else 0 end;
  job_pricing_snapshot := case when agreement_row.billing_type = 'Per Visit'
    then agreement_row.pricing_snapshot->'accepted_pricing_allocation' else null end;
  if job_pricing_snapshot is not null then
    if not public.is_valid_job_pricing_snapshot(job_pricing_snapshot, agreement_row.billing_amount) then
      raise exception 'The Agreement accepted pricing allocation is invalid or does not match its Per Visit billing amount.';
    end if;
    job_amount := round((job_pricing_snapshot->>'totalAmount')::numeric, 2);
  end if;
  job_date := (now() at time zone coalesce((select timezone from public.business_settings limit 1), 'UTC'))::date;

  for attempt in 1..5 loop
    begin
      insert into public.jobs (
        job_number, proposal_id, estimate_id, walkthrough_id, service_occurrence_id,
        client_id, property_id, division, client_name, property_name, service_name,
        frequency, status, scheduled_date, start_time, estimated_duration,
        assigned_crew_id, assigned_crew_name, crew_lead_name, assigned_team,
        price, pricing_snapshot, deposit, balance, labor_hours, recommended_crew_size, scope,
        checklist, photos, access_instructions, internal_notes, completed_at
      ) values (
        'JOB-' || to_char(job_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'),
        agreement_row.proposal_id, proposal_row.estimate_id, proposal_row.walkthrough_id, occurrence_row.id,
        agreement_row.client_id, agreement_row.property_id, agreement_row.division,
        coalesce(client_row.company_name, nullif(concat_ws(' ', client_row.first_name, client_row.last_name), ''), 'Client'),
        coalesce(property_row.property_name, property_row.address), agreement_row.service_name,
        agreement_row.frequency, case when occurrence_row.assigned_crew_id is null then 'Scheduled' else 'Crew Assigned' end,
        occurrence_row.scheduled_date, occurrence_row.scheduled_start_time, agreement_row.estimated_duration,
        occurrence_row.assigned_crew_id, crew_row.crew_name,
        (select coalesce(e.preferred_name, nullif(trim(e.first_name || ' ' || e.last_name), '')) from public.employees e where e.id = crew_row.crew_lead_id),
        team, job_amount, job_pricing_snapshot, 0, job_amount, 0, greatest(jsonb_array_length(team), 1), agreement_row.scope,
        '[]'::jsonb, '[]'::jsonb, agreement_row.special_instructions, agreement_row.notes, null
      ) returning * into job_row;

      update public.service_occurrences set job_id = job_row.id, status = 'Job Created'
      where id = occurrence_row.id;
      return job_row;
    exception when unique_violation then
      select * into job_row from public.jobs
      where service_occurrence_id = occurrence_row.id and archived_at is null limit 1;
      if found then
        update public.service_occurrences set job_id = job_row.id, status = 'Job Created'
        where id = occurrence_row.id;
        return job_row;
      end if;
    end;
  end loop;
  raise exception 'A unique Job number could not be generated.';
end;
$$;

drop function public.create_direct_operational_job(uuid,uuid,uuid,uuid[],date,time,numeric,uuid,numeric,text,text,numeric);

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

create or replace function public.create_completed_job_invoice(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  job_row public.jobs;
  client_row public.clients;
  proposal_row public.proposals;
  settings_row public.business_settings;
  amount numeric;
  issue_date date := current_date;
  invoice_id uuid;
  invoice_number text;
  line_item_id uuid;
  line_items jsonb;
  snapshot_addon jsonb;
  attempt integer;
  violated_constraint_name text;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  caller_role := public.current_user_role();
  if caller_role is null
    or caller_role not in ('Master Admin','Administrator','Manager','Crew Lead')
  then
    raise exception 'Job completion invoicing is not permitted.';
  end if;

  select * into job_row
  from public.jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'Job not found.'; end if;
  if job_row.archived_at is not null or job_row.status = 'Archived' then
    raise exception 'Archived Jobs cannot be invoiced.';
  end if;
  if caller_role = 'Crew Lead'
    and (job_row.assigned_crew_id is null or not public.is_assigned_to_crew(job_row.assigned_crew_id))
  then
    raise exception 'Job is not assigned to your crew.';
  end if;
  if job_row.status is distinct from 'Completed' then
    raise exception 'Only completed Jobs can be invoiced.';
  end if;

  select invoice.id, invoice.invoice_number
  into invoice_id, invoice_number
  from public.invoices invoice
  where invoice.job_id = job_row.id
    and invoice.archived_at is null
    and invoice.status <> 'Cancelled'
  order by invoice.created_at
  limit 1;
  if found then
    return jsonb_build_object(
      'invoice_id', invoice_id,
      'invoice_number', invoice_number,
      'created', false,
      'skipped', false,
      'financially_resolved', true
    );
  end if;

  if public.is_job_financially_handed_off(job_row.id) then
    select invoice.id, invoice.invoice_number
    into invoice_id, invoice_number
    from public.invoices invoice
    where invoice.job_id = job_row.id
      and (
        (
          coalesce(invoice.amount_paid, 0) > 0
          and coalesce(invoice.balance_due, invoice.total) <= 0
          and coalesce(invoice.amount_paid, 0) >= coalesce(invoice.total, 0)
        )
        or (
          coalesce(invoice.total, 0) > 0
          and coalesce((
            select sum(payment.amount)
            from public.payments payment
            where payment.invoice_id = invoice.id
          ), 0) >= invoice.total
        )
      )
    order by invoice.created_at desc
    limit 1;
    return jsonb_build_object(
      'invoice_id', invoice_id,
      'invoice_number', invoice_number,
      'created', false,
      'skipped', true,
      'financially_resolved', true
    );
  end if;

  if job_row.service_occurrence_id is not null and exists (
    select 1
    from public.service_occurrences occurrence
    join public.service_agreements agreement on agreement.id = occurrence.agreement_id
    where occurrence.id = job_row.service_occurrence_id
      and agreement.billing_type in ('Weekly','Biweekly','Monthly','Flat Contract')
  ) then
    return jsonb_build_object(
      'invoice_id', null,
      'invoice_number', null,
      'created', false,
      'skipped', true,
      'financially_resolved', false
    );
  end if;

  select * into client_row from public.clients where id = job_row.client_id;
  select * into proposal_row from public.proposals where id = job_row.proposal_id;
  select * into settings_row from public.business_settings limit 1;
  if job_row.price is null
    or job_row.price = 'NaN'::numeric
    or job_row.price < 0
  then
    raise exception 'The completed Job does not contain a valid authoritative price.';
  end if;
  -- Zero-dollar Jobs are supported by the existing jobs/invoices schemas.
  amount := job_row.price;
  if job_row.pricing_snapshot is null then
    line_items := jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(),
      'description', coalesce(nullif(job_row.service_name, ''), 'StudioScrubz service'),
      'quantity', 1, 'rate', amount, 'amount', amount));
  else
    if not public.is_valid_job_pricing_snapshot(job_row.pricing_snapshot, amount) then
      raise exception 'The completed Job pricing snapshot is invalid or does not reconcile to the authoritative Job price.';
    end if;
    line_items := jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(),
      'description', coalesce(nullif(job_row.service_name, ''), 'StudioScrubz service'),
      'quantity', 1,
      'rate', round((job_row.pricing_snapshot->>'baseServiceAmount')::numeric, 2),
      'amount', round((job_row.pricing_snapshot->>'baseServiceAmount')::numeric, 2)));
    for snapshot_addon in select value from jsonb_array_elements(job_row.pricing_snapshot->'addons') loop
      line_items := line_items || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(),
        'description', 'Add-On: ' || snapshot_addon->>'label' ||
          case when snapshot_addon->>'pricingType' = 'Per Unit'
            then ' (' || snapshot_addon->>'unitName' || ')' else '' end,
        'quantity', case when snapshot_addon->>'pricingType' = 'Per Unit'
          then (snapshot_addon->>'quantity')::numeric else 1 end,
        'rate', case when snapshot_addon->>'pricingType' = 'Per Unit'
          then (snapshot_addon->>'unitPrice')::numeric else (snapshot_addon->>'lineTotal')::numeric end,
        'amount', (snapshot_addon->>'lineTotal')::numeric));
    end loop;
  end if;

  for attempt in 1..5 loop
    invoice_number := 'INV-' || to_char(issue_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0');
    line_item_id := gen_random_uuid();
    begin
      insert into public.invoices (
        invoice_number, job_id, service_agreement_id, contract_billing_type,
        billing_period_start, proposal_id, client_id, property_id, client_name,
        property_name, customer_phone, customer_email, service_name, status,
        issue_date, due_date, line_items, subtotal, discount, tax, total,
        amount_paid, balance_due, notes, terms
      ) values (
        invoice_number, job_row.id, null, null, null, job_row.proposal_id,
        job_row.client_id, job_row.property_id, job_row.client_name,
        job_row.property_name,
        coalesce(nullif(btrim(client_row.phone), ''), nullif(btrim(proposal_row.customer_phone), '')),
        coalesce(nullif(btrim(client_row.email), ''), nullif(btrim(proposal_row.customer_email), '')),
        job_row.service_name, 'Open', issue_date,
        issue_date + coalesce(settings_row.default_invoice_due_days, 15),
        line_items,

        amount, 0, 0, amount, 0, amount, job_row.internal_notes,
        coalesce(settings_row.default_invoice_terms, settings_row.default_payment_terms)
      ) returning id into invoice_id;
      return jsonb_build_object(
        'invoice_id', invoice_id,
        'invoice_number', invoice_number,
        'created', true,
        'skipped', false,
        'financially_resolved', true
      );
    exception when unique_violation then
      get stacked diagnostics violated_constraint_name = constraint_name;
      if violated_constraint_name = 'invoices_one_active_per_job_idx' then
        select invoice.id, invoice.invoice_number
        into invoice_id, invoice_number
        from public.invoices invoice
        where invoice.job_id = job_row.id
          and invoice.archived_at is null
          and invoice.status <> 'Cancelled'
        order by invoice.created_at
        limit 1;
        if found then
          return jsonb_build_object(
            'invoice_id', invoice_id,
            'invoice_number', invoice_number,
            'created', false,
            'skipped', false,
            'financially_resolved', true
          );
        end if;
        raise;
      elsif violated_constraint_name is distinct from 'invoices_invoice_number_key' then
        raise;
      end if;
    end;
  end loop;
  raise exception 'A unique Invoice number could not be generated.';
end;
$$;

revoke all on function public.create_job_from_service_occurrence(uuid) from public, anon, authenticated;
grant execute on function public.create_job_from_service_occurrence(uuid) to authenticated;
revoke all on function public.create_direct_operational_job(uuid,uuid,uuid,uuid[],date,time,numeric,uuid,numeric,text,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.create_direct_operational_job(uuid,uuid,uuid,uuid[],date,time,numeric,uuid,numeric,text,text,numeric,jsonb) to authenticated;
revoke all on function public.create_completed_job_invoice(uuid) from public, anon, authenticated;
grant execute on function public.create_completed_job_invoice(uuid) to postgres, service_role, authenticated;
notify pgrst, 'reload schema';
commit;
