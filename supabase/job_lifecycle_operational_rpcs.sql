-- StudioScrubz OS: secure Job lifecycle and per-user Job time clock RPCs.
-- REVIEW ONLY. Do not execute automatically.
--
-- Additive only: reuses public.jobs, public.time_entries, existing role helpers,
-- existing operational clock RPCs, and existing Agreement occurrence Job RPC.

begin;

create or replace function public.create_job_from_accepted_proposal(
  p_proposal_id uuid
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_proposal public.proposals;
  v_client public.clients;
  v_property public.properties;
  v_job public.jobs;
  v_price_text text;
  v_labor_text text;
  v_duration_text text;
  v_crew_size_text text;
  v_price numeric;
  v_labor numeric;
  v_duration numeric;
  v_crew_size integer;
  v_attempt integer;
  v_constraint_name text;
begin
  if auth.uid() is null then
    raise exception 'An active authenticated profile is required.';
  end if;
  v_role := public.current_user_role();
  if v_role not in ('Master Admin', 'Administrator', 'Manager') then
    raise exception 'Job creation permission denied.';
  end if;

  select * into v_proposal
  from public.proposals
  where id = p_proposal_id
  for update;
  if not found then raise exception 'Proposal not found.'; end if;
  if v_proposal.status is distinct from 'Accepted' or v_proposal.accepted is not true then
    raise exception 'Only an accepted Proposal can create a Job.';
  end if;
  if v_proposal.archived_at is not null then
    raise exception 'An archived Proposal cannot create a Job.';
  end if;
  if v_proposal.frequency is distinct from 'One-Time' then
    raise exception 'Recurring Proposals must create a Service Agreement.';
  end if;
  if v_proposal.division is null
    or v_proposal.division not in ('Residential', 'Commercial')
  then
    raise exception 'The accepted Proposal does not contain a valid division.';
  end if;

  select * into v_job
  from public.jobs
  where proposal_id = v_proposal.id
    and service_occurrence_id is null
  order by created_at
  limit 1;
  if found then return v_job; end if;

  select * into v_client from public.clients
  where id = v_proposal.client_id and archived_at is null;
  select * into v_property from public.properties
  where id = v_proposal.property_id
    and client_id = v_proposal.client_id
    and archived_at is null;
  if v_client.id is null or v_property.id is null then
    raise exception 'The Proposal requires active matching Client and Property relationships.';
  end if;

  v_price_text := v_proposal.result->>'perVisitTotal';
  v_labor_text := v_proposal.result->>'laborHours';
  v_duration_text := v_proposal.result->>'estimatedDuration';
  v_crew_size_text := v_proposal.result->>'crewRecommendation';
  if coalesce(v_price_text, '') !~ '^([0-9]+)(\.[0-9]+)?$'
    or length(v_price_text) > 18
  then
    raise exception 'The accepted Proposal does not contain a valid authoritative price.';
  end if;
  v_price := round(v_price_text::numeric, 2);
  v_labor := case when coalesce(v_labor_text, '') ~ '^([0-9]+)(\.[0-9]+)?$' and length(v_labor_text) <= 18 then v_labor_text::numeric else 0 end;
  v_duration := case when coalesce(v_duration_text, '') ~ '^([0-9]+)(\.[0-9]+)?$' and length(v_duration_text) <= 18 then v_duration_text::numeric else null end;
  v_crew_size := case when coalesce(v_crew_size_text, '') ~ '^[0-9]+$' and length(v_crew_size_text) <= 9 then greatest(v_crew_size_text::integer, 1) else 1 end;

  for v_attempt in 1..5 loop
    begin
      insert into public.jobs (
        job_number, proposal_id, service_occurrence_id, estimate_id, walkthrough_id,
        client_id, property_id, division, client_name, property_name, service_name,
        frequency, status, scheduled_date, start_time, estimated_duration,
        assigned_crew_id, assigned_crew_name, crew_lead_name, assigned_team,
        price, deposit, balance, labor_hours, recommended_crew_size, scope,
        checklist, photos, access_instructions, internal_notes, completed_at
      ) values (
        'JOB-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'),
        v_proposal.id, null, v_proposal.estimate_id, v_proposal.walkthrough_id,
        v_proposal.client_id, v_proposal.property_id, v_proposal.division,
        coalesce(v_proposal.client_name, v_client.company_name, nullif(concat_ws(' ', v_client.first_name, v_client.last_name), ''), 'Client'),
        coalesce(v_proposal.property_name, v_property.property_name, v_property.address),
        nullif(btrim(v_proposal.result->>'serviceName'), ''), v_proposal.frequency,
        'Ready to Schedule', null, null, v_duration,
        null, null, null, '[]'::jsonb,
        v_price, 0, v_price, v_labor, v_crew_size,
        case when jsonb_typeof(v_proposal.result->'scope') = 'array' then v_proposal.result->'scope' else '[]'::jsonb end,
        '[]'::jsonb, '[]'::jsonb,
        coalesce(nullif(btrim(v_proposal.result#>>'{terms,accessRequirements}'), ''), v_property.access_instructions),
        v_proposal.notes, null
      ) returning * into v_job;
      insert into public.proposal_history (
        proposal_id, event_type, previous_status, new_status, description, performed_by
      ) values (
        v_proposal.id, 'Job Created', 'Accepted', 'Accepted',
        'Job ' || v_job.job_number || ' created.',
        coalesce((select profile.display_name from public.user_profiles profile where profile.id = auth.uid()), v_role)
      );
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
  p_master_price_override numeric default null
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
  v_addons numeric;
  v_price numeric;
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

  select coalesce(sum(case when addon.pricing_model = 'Custom'
      then case when coalesce(addon.pricing_config->>'supply_cost', '') ~ '^([0-9]+)(\.[0-9]+)?$'
        then (addon.pricing_config->>'supply_cost')::numeric else addon.price end
      else addon.price end), 0)
  into v_addons
  from public.service_addons addon
  where addon.id = any(coalesce(p_addon_ids, '{}'::uuid[]));
  v_price := round(coalesce(p_master_price_override, v_base + v_addons), 2);
  if v_price = 'NaN'::numeric or v_price < 0 then
    raise exception 'The authoritative Job price is invalid.';
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
        price, deposit, balance, labor_hours, recommended_crew_size, scope,
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
        v_team, v_price, 0, v_price, coalesce(p_labor_hours, 0), greatest(jsonb_array_length(v_team), 1),
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

-- Agreement/occurrence creation remains authoritative in the existing
-- public.create_job_from_service_occurrence(uuid) RPC and is not duplicated.

create or replace function public.archive_operational_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_safe public.jobs_operational_safe;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Job archive permission denied.';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.archived_at is not null or v_job.status = 'Archived' then
    raise exception 'Job is already archived.';
  end if;
  if v_job.status is null
    or v_job.status not in ('Ready to Schedule','Scheduled','Crew Assigned','In Progress','Completed','Cancelled')
  then
    raise exception 'Job cannot be archived from its current status.';
  end if;
  if exists (select 1 from public.time_entries where job_id = v_job.id and status = 'Open' and clock_out is null and archived_at is null) then
    raise exception 'A Job with active time entries cannot be archived.';
  end if;
  update public.jobs set status = 'Archived', archived_at = now() where id = v_job.id;
  select * into v_safe from public.jobs_operational_safe where id = v_job.id;
  if not found then raise exception 'Archived Job is outside your permitted scope.'; end if;
  return v_safe;
end;
$$;

create or replace function public.get_archived_operational_jobs()
returns setof public.jobs_operational_safe
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator']) then
    raise exception 'Archived Job access denied.';
  end if;
  return query select job.* from public.jobs_operational_safe job
  where job.archived_at is not null and job.status = 'Archived'
  order by job.archived_at desc;
end;
$$;

create or replace function public.restore_archived_operational_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare v_job public.jobs; v_safe public.jobs_operational_safe;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator']) then
    raise exception 'Job restore permission denied.';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.archived_at is null or v_job.status is distinct from 'Archived' then raise exception 'Job is not archived.'; end if;
  update public.jobs set archived_at = null, status = 'Completed' where id = v_job.id;
  select * into v_safe from public.jobs_operational_safe where id = v_job.id;
  if not found then raise exception 'Restored Job is outside your permitted scope.'; end if;
  return v_safe;
end;
$$;

create or replace function public.start_operational_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_job public.jobs;
  v_safe public.jobs_operational_safe;
begin
  if auth.uid() is null then
    raise exception 'An active authenticated profile is required.';
  end if;
  v_role := public.current_user_role();
  if v_role is null
    or v_role not in ('Master Admin','Administrator','Manager')
  then
    raise exception 'Job start permission denied.';
  end if;
  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.archived_at is not null then
    raise exception 'An archived Job cannot be started.';
  end if;
  if v_job.status is null
    or v_job.status not in ('Scheduled','Crew Assigned')
  then
    raise exception 'Only a Scheduled or Crew Assigned Job can be started.';
  end if;
  if v_job.assigned_crew_id is null then
    raise exception 'The Job requires an assigned crew before it can be started.';
  end if;
  update public.jobs
  set status = 'In Progress', completed_at = null
  where id = v_job.id;
  select * into v_safe
  from public.jobs_operational_safe
  where id = v_job.id;
  if not found then
    raise exception 'Started Job is outside your permitted scope.';
  end if;
  return v_safe;
end;
$$;

create or replace function public.start_or_clock_in_to_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_employee_id uuid;
  v_entry public.time_entries_operational_safe;
  v_started boolean := false;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  if not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then
    raise exception 'Job clock-in permission denied.';
  end if;
  v_employee_id := public.current_employee_id();
  if v_employee_id is null then raise exception 'Your user profile must be linked to an active Employee.'; end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.archived_at is not null
    or v_job.status is null
    or v_job.status not in ('Scheduled','Crew Assigned','In Progress')
  then raise exception 'This Job cannot be started or clocked into.'; end if;
  if v_job.assigned_crew_id is null or not public.is_assigned_to_crew(v_job.assigned_crew_id) then
    raise exception 'The authenticated employee is not assigned to this Job.';
  end if;
  if exists (select 1 from public.time_entries where employee_id = v_employee_id and status = 'Open' and clock_out is null and archived_at is null) then
    raise exception 'Employee is already clocked in.';
  end if;
  v_entry := public.clock_in_operational(v_employee_id, v_job.id, v_job.assigned_crew_id, 'Job', now(), null);
  if v_job.status is distinct from 'In Progress' then
    update public.jobs set status = 'In Progress', completed_at = null where id = v_job.id;
    v_started := true;
  end if;
  return jsonb_build_object('jobId', v_job.id, 'jobStatus', 'In Progress', 'clockedIn', true,
    'clockedInAt', v_entry.clock_in, 'timeEntryId', v_entry.id, 'jobStarted', v_started);
end;
$$;

create or replace function public.finish_job_and_clock_out(
  p_job_id uuid,
  p_break_minutes integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_role text;
  v_employee_id uuid;
  v_open public.time_entries;
  v_closed public.time_entries_operational_safe;
  v_remaining integer;
  v_completed boolean;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  if not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then
    raise exception 'Job finish permission denied.';
  end if;
  v_role := public.current_user_role();
  if coalesce(p_break_minutes, 0) < 0 then raise exception 'Break minutes cannot be negative.'; end if;
  v_employee_id := public.current_employee_id();
  if v_employee_id is null then raise exception 'Your user profile must be linked to an active Employee.'; end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.archived_at is not null or v_job.status is distinct from 'In Progress' then
    raise exception 'Only an In Progress Job can be finished.';
  end if;
  select * into v_open from public.time_entries
  where employee_id = v_employee_id and job_id = v_job.id
    and status = 'Open' and clock_out is null and archived_at is null
  for update;
  if not found then raise exception 'No active time entry exists for this employee and Job.'; end if;

  v_closed := public.clock_out_operational(v_open.id, now(), coalesce(p_break_minutes, 0));
  select count(*) into v_remaining from public.time_entries
  where job_id = v_job.id and status = 'Open' and clock_out is null and archived_at is null;
  -- Scrub Technicians may end only their own punch. Job completion remains
  -- limited to the roles that already hold jobs.complete operational authority.
  v_completed := v_remaining = 0 and v_role in ('Master Admin','Administrator','Manager','Crew Lead');
  if v_completed then
    update public.jobs set status = 'Completed', completed_at = now() where id = v_job.id;
  end if;
  return jsonb_build_object('jobId', v_job.id,
    'jobStatus', case when v_completed then 'Completed' else 'In Progress' end,
    'clockedIn', false, 'clockedOutAt', v_closed.clock_out,
    'timeEntryId', v_closed.id, 'remainingActiveWorkers', v_remaining,
    'jobCompleted', v_completed,
    'completionPending', v_remaining = 0 and not v_completed);
end;
$$;

create or replace function public.complete_in_progress_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_job public.jobs;
  v_safe public.jobs_operational_safe;
begin
  if auth.uid() is null then
    raise exception 'An active authenticated profile is required.';
  end if;
  v_role := public.current_user_role();
  if v_role not in ('Master Admin','Administrator','Manager','Crew Lead') then
    raise exception 'Job completion permission denied.';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.archived_at is not null or v_job.status is distinct from 'In Progress' then
    raise exception 'Only an In Progress Job can be completed.';
  end if;
  if v_role = 'Crew Lead'
    and (v_job.assigned_crew_id is null or not public.is_assigned_to_crew(v_job.assigned_crew_id))
  then
    raise exception 'The Job is not assigned to your crew.';
  end if;
  if exists (
    select 1 from public.time_entries entry
    where entry.job_id = v_job.id
      and entry.status = 'Open'
      and entry.clock_out is null
      and entry.archived_at is null
  ) then
    raise exception 'The Job cannot be completed while workers are still clocked in.';
  end if;
  update public.jobs
  set status = 'Completed', completed_at = now()
  where id = v_job.id;
  select * into v_safe from public.jobs_operational_safe where id = v_job.id;
  if not found then raise exception 'Completed Job is outside your permitted scope.'; end if;
  return v_safe;
end;
$$;

revoke all on function public.create_job_from_accepted_proposal(uuid) from public, anon, authenticated;
revoke all on function public.create_direct_operational_job(uuid,uuid,uuid,uuid[],date,time,numeric,uuid,numeric,text,text,numeric) from public, anon, authenticated;
revoke all on function public.archive_operational_job(uuid) from public, anon, authenticated;
revoke all on function public.get_archived_operational_jobs() from public, anon, authenticated;
revoke all on function public.restore_archived_operational_job(uuid) from public, anon, authenticated;
revoke all on function public.start_operational_job(uuid) from public, anon, authenticated;
revoke all on function public.start_or_clock_in_to_job(uuid) from public, anon, authenticated;
revoke all on function public.finish_job_and_clock_out(uuid,integer) from public, anon, authenticated;
revoke all on function public.complete_in_progress_job(uuid) from public, anon, authenticated;

grant execute on function public.create_job_from_accepted_proposal(uuid) to authenticated;
grant execute on function public.create_direct_operational_job(uuid,uuid,uuid,uuid[],date,time,numeric,uuid,numeric,text,text,numeric) to authenticated;
grant execute on function public.archive_operational_job(uuid) to authenticated;
grant execute on function public.get_archived_operational_jobs() to authenticated;
grant execute on function public.restore_archived_operational_job(uuid) to authenticated;
grant execute on function public.start_operational_job(uuid) to authenticated;
grant execute on function public.start_or_clock_in_to_job(uuid) to authenticated;
grant execute on function public.finish_job_and_clock_out(uuid,integer) to authenticated;
grant execute on function public.complete_in_progress_job(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
