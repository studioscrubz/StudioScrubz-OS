-- Record work that happened outside StudioScrubz without invoking any live Job,
-- employee labor, presence, invoicing, payment, notification, or Calendar flow.
begin;

create or replace function public.create_completed_historical_job(
  p_client_id uuid,
  p_property_id uuid,
  p_service_id uuid,
  p_start_date date,
  p_start_time time without time zone,
  p_end_date date,
  p_end_time time without time zone,
  p_assigned_crew_id uuid default null,
  p_internal_notes text default null,
  p_price numeric default null
)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_property public.properties;
  v_service public.services;
  v_crew public.crews;
  v_job public.jobs;
  v_safe public.jobs_operational_safe;
  v_timezone text;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_quantity numeric;
  v_price numeric;
  v_scope jsonb := '[]'::jsonb;
  v_team jsonb := '[]'::jsonb;
  v_attempt integer;
  v_constraint_name text;
begin
  if auth.uid() is null then
    raise exception 'An active authenticated profile is required.';
  end if;
  if not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Historical Job creation permission denied.';
  end if;
  if p_start_date is null or p_start_time is null or p_end_date is null or p_end_time is null then
    raise exception 'Actual Job Start and Actual Job End are required.';
  end if;
  if p_price is not null and (p_price = 'NaN'::numeric or p_price < 0) then
    raise exception 'Job value must be greater than or equal to zero.';
  end if;

  select * into v_client from public.clients where id = p_client_id and archived_at is null;
  if not found then raise exception 'Active Client not found.'; end if;
  select * into v_property from public.properties
  where id = p_property_id and client_id = p_client_id and archived_at is null;
  if not found then raise exception 'The selected Property does not belong to the active Client.'; end if;
  select * into v_service from public.services
  where id = p_service_id and is_active and archived_at is null;
  if not found then raise exception 'Active Service not found.'; end if;
  if v_service.division is null or v_property.property_type is null
    or not (v_service.division = 'Both' or v_service.division = v_property.property_type)
  then raise exception 'The selected Service is not available for this Property division.'; end if;
  if v_service.pricing_model is null or v_service.pricing_model not in (
    'Flat Rate', 'Size Tier', 'Per Square Foot', 'Per Bedroom',
    'Per Unit', 'Per Hour', 'Per Visit', 'Custom'
  ) then raise exception 'The selected Service has an invalid pricing model.'; end if;

  if p_assigned_crew_id is not null then
    select * into v_crew from public.crews
    where id = p_assigned_crew_id and status = 'Active' and archived_at is null;
    if not found then raise exception 'Active Crew not found.'; end if;
    select coalesce(jsonb_agg(coalesce(employee.preferred_name,
      nullif(trim(employee.first_name || ' ' || employee.last_name), '')) order by employee.last_name), '[]'::jsonb)
    into v_team
    from public.crew_members member
    join public.employees employee on employee.id = member.employee_id
    where member.crew_id = v_crew.id and employee.archived_at is null;
  end if;

  select coalesce(nullif(btrim(settings.timezone), ''), 'UTC') into v_timezone
  from public.business_settings settings order by settings.id limit 1;
  v_timezone := coalesce(v_timezone, 'UTC');
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'The configured business timezone is invalid.';
  end if;
  v_started_at := (p_start_date + p_start_time) at time zone v_timezone;
  v_ended_at := (p_end_date + p_end_time) at time zone v_timezone;
  if v_ended_at < v_started_at then raise exception 'Actual Job End cannot be before Actual Job Start.'; end if;

  v_quantity := case when coalesce(v_property.square_feet, 0) > 0 then v_property.square_feet else 1 end;
  if p_price is not null then v_price := round(p_price, 2);
  elsif v_service.pricing_model = 'Size Tier' then
    select tier.price into v_price from public.service_price_tiers tier
    where tier.service_id = v_service.id and tier.is_active
      and (tier.min_value is null or v_quantity >= tier.min_value)
      and (tier.max_value is null or v_quantity <= tier.max_value)
    order by tier.display_order, tier.min_value nulls first limit 1;
  elsif v_service.pricing_model in ('Flat Rate', 'Per Visit') then
    v_price := greatest(v_service.base_price, v_service.minimum_price);
  elsif v_service.pricing_model <> 'Custom' then
    v_price := greatest(v_service.base_price * v_quantity, v_service.minimum_price);
  end if;
  if v_price is null or v_price = 'NaN'::numeric or v_price < 0 then
    raise exception 'Enter a Job value for this Service.';
  end if;
  if nullif(btrim(coalesce(v_service.description, '')), '') is not null then
    v_scope := jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'text', v_service.description));
  end if;

  for v_attempt in 1..5 loop
    begin
      insert into public.jobs (
        job_number, proposal_id, service_occurrence_id, estimate_id, walkthrough_id,
        client_id, property_id, division, client_name, property_name, service_name,
        frequency, status, scheduled_date, start_time, estimated_duration,
        assigned_crew_id, assigned_crew_name, crew_lead_name, assigned_team,
        price, deposit, balance, labor_hours, recommended_crew_size, scope,
        checklist, photos, access_instructions, internal_notes, completed_at,
        operational_started_at, operational_ended_at
      ) values (
        'JOB-' || to_char(p_start_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'),
        null, null, null, null, v_client.id, v_property.id, v_property.property_type,
        coalesce(v_client.company_name, nullif(concat_ws(' ', v_client.first_name, v_client.last_name), ''), 'Client'),
        coalesce(v_property.property_name, v_property.address), v_service.service_name,
        'One-Time', 'Completed', null, null, null,
        case when p_assigned_crew_id is null then null else v_crew.id end,
        case when p_assigned_crew_id is null then null else v_crew.crew_name end,
        case when p_assigned_crew_id is null then null else (
          select coalesce(employee.preferred_name, nullif(trim(employee.first_name || ' ' || employee.last_name), ''))
          from public.employees employee where employee.id = v_crew.crew_lead_id
        ) end,
        v_team, v_price, 0, v_price, 0, greatest(jsonb_array_length(v_team), 1), v_scope,
        '[]'::jsonb, '[]'::jsonb, v_property.access_instructions,
        nullif(btrim(coalesce(p_internal_notes, '')), ''), v_ended_at,
        v_started_at, v_ended_at
      ) returning * into v_job;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name is distinct from 'jobs_job_number_key' then raise; end if;
    end;
  end loop;
  if v_job.id is null then raise exception 'A unique Job number could not be generated.'; end if;

  select * into v_safe from public.jobs_operational_safe where id = v_job.id;
  if not found then raise exception 'Created Job is outside your permitted scope.'; end if;
  return v_safe;
end;
$$;

revoke all on function public.create_completed_historical_job(uuid,uuid,uuid,date,time without time zone,date,time without time zone,uuid,text,numeric)
  from public, anon, authenticated;
grant execute on function public.create_completed_historical_job(uuid,uuid,uuid,date,time without time zone,date,time without time zone,uuid,text,numeric)
  to authenticated;
notify pgrst, 'reload schema';
commit;
