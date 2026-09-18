-- Regular Jobs may target one individual Tech, one Crew, or remain unassigned.
-- Existing Crew assignments remain authoritative and require no backfill.
begin;

alter table public.jobs
  add column assigned_employee_id uuid references public.employees(id) on delete set null,
  add column assigned_employee_name text;

alter table public.jobs
  add constraint jobs_one_worker_assignment
  check (num_nonnulls(assigned_employee_id, assigned_crew_id) <= 1) not valid;
alter table public.jobs validate constraint jobs_one_worker_assignment;

create index jobs_assigned_employee_active_idx
  on public.jobs(assigned_employee_id, scheduled_date, start_time)
  where assigned_employee_id is not null and archived_at is null;

-- Direct table writes are not an assignment API. Existing controlled privileged
-- functions retain owner access; authenticated clients use the RPCs below.
revoke insert, update, delete, truncate, references, trigger
on public.jobs
from public, anon, authenticated;

drop policy if exists "Master Admin insert"
on public.jobs;

drop policy if exists "Master Admin update"
on public.jobs;

create function public.get_eligible_job_tech_options()
returns table(employee_id uuid, display_name text, operational_role text)
language sql stable security definer set search_path = '' as $$
  select e.id,
    coalesce(nullif(btrim(e.preferred_name),''),nullif(btrim(e.first_name||' '||e.last_name),''),e.employee_number),
    up.role
  from public.employees e
  join public.user_profiles up on up.employee_id=e.id and up.is_active
  where auth.uid() is not null
    and public.has_any_role(array['Master Admin','Administrator','Manager'])
    and e.employment_status='Active' and e.archived_at is null
    and up.role in ('Scrub Technician','Crew Lead')
  order by 2, e.id
$$;
revoke all on function public.get_eligible_job_tech_options() from public, anon, authenticated;
grant execute on function public.get_eligible_job_tech_options() to authenticated;

create function public.is_eligible_job_tech(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_employee_id is not null and exists(
    select 1 from public.employees e join public.user_profiles up on up.employee_id=e.id
    where e.id=p_employee_id and e.employment_status='Active' and e.archived_at is null
      and up.is_active and up.role in ('Scrub Technician','Crew Lead'))
$$;
revoke all on function public.is_eligible_job_tech(uuid) from public, anon, authenticated;

create function public.can_access_job_assignment(p_employee_id uuid,p_crew_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    public.has_any_role(array['Master Admin','Administrator','Manager'])
    or (public.is_eligible_job_tech(public.current_employee_id()) and (
      p_employee_id=public.current_employee_id()
      or exists(select 1 from public.crews c where c.id=p_crew_id and c.status='Active' and c.archived_at is null
        and (c.crew_lead_id=public.current_employee_id() or exists(select 1 from public.crew_members cm where cm.crew_id=c.id and cm.employee_id=public.current_employee_id())))
    ))
$$;
revoke all on function public.can_access_job_assignment(uuid,uuid) from public, anon, authenticated;
grant execute on function public.can_access_job_assignment(uuid,uuid) to authenticated;

create function public.can_control_job_timer(p_employee_id uuid,p_crew_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    public.has_any_role(array['Master Admin','Administrator','Manager'])
    or (public.is_eligible_job_tech(public.current_employee_id()) and (
      p_employee_id=public.current_employee_id()
      or (public.has_role('Crew Lead') and exists(select 1 from public.crews c
        where c.id=p_crew_id and c.status='Active' and c.archived_at is null
          and c.crew_lead_id=public.current_employee_id()))
    ))
  )
$$;
revoke all on function public.can_control_job_timer(uuid,uuid) from public, anon, authenticated;
grant execute on function public.can_control_job_timer(uuid,uuid) to authenticated;

create function public.can_access_job(p_job_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.jobs j where j.id=p_job_id
      and public.can_access_job_assignment(j.assigned_employee_id,j.assigned_crew_id))
$$;
revoke all on function public.can_access_job(uuid) from public, anon, authenticated;
grant execute on function public.can_access_job(uuid) to authenticated;

create or replace function public.can_access_client_from_assigned_job(p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.jobs j
    where j.client_id=p_client_id and j.archived_at is null
      and public.can_access_job_assignment(j.assigned_employee_id,j.assigned_crew_id))
$$;
create or replace function public.can_access_property_from_assigned_job(p_property_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.jobs j
    where j.property_id=p_property_id and j.archived_at is null
      and public.can_access_job_assignment(j.assigned_employee_id,j.assigned_crew_id))
$$;

create or replace view public.jobs_operational_safe
with (security_barrier=true, security_invoker=true) as
select job.id,job.job_number,job.proposal_id,job.service_occurrence_id,job.estimate_id,job.walkthrough_id,
  job.client_id,job.property_id,job.division,job.client_name,job.property_name,job.service_name,job.frequency,
  job.status,job.scheduled_date,job.start_time,job.estimated_duration,job.assigned_crew_id,
  job.assigned_crew_name,job.crew_lead_name,job.assigned_team,job.scope,job.checklist,
  job.access_instructions,job.internal_notes,job.completed_at,job.created_at,job.updated_at,job.archived_at,
  job.operational_started_at,job.operational_ended_at,
  case when jsonb_typeof(job.pricing_snapshot->'addons')='array' then (
    select coalesce(jsonb_agg(jsonb_build_object('id',addon->>'id','label',addon->>'label',
      'pricingType',addon->>'pricingType','quantity',case when jsonb_typeof(addon->'quantity')='number' then (addon->>'quantity')::numeric end,
      'unitName',addon->>'unitName')),'[]'::jsonb)
    from jsonb_array_elements(job.pricing_snapshot->'addons') addon) end as contracted_addons,
  job.assigned_employee_id,job.assigned_employee_name
from public.jobs job
where public.can_access_job_assignment(job.assigned_employee_id,job.assigned_crew_id);
revoke all on public.jobs_operational_safe from public, anon, authenticated;
grant select on public.jobs_operational_safe to authenticated;

create function public.set_job_worker_assignment(
  p_job_id uuid,p_assignment_kind text,p_employee_id uuid default null,p_crew_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.jobs; e public.employees; c public.crews; team jsonb:='[]'::jsonb; next_status text;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Only management may assign Jobs.' using errcode='42501'; end if;
  if p_assignment_kind not in ('unassigned','individual','crew') then raise exception 'Invalid Job assignment target.'; end if;
  if (p_assignment_kind='individual' and (p_employee_id is null or p_crew_id is not null))
    or (p_assignment_kind='crew' and (p_crew_id is null or p_employee_id is not null))
    or (p_assignment_kind='unassigned' and (p_employee_id is not null or p_crew_id is not null)) then
    raise exception 'A Job must target one individual Tech, one Crew, or nobody.'; end if;
  select * into j from public.jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if j.archived_at is not null or j.status in ('In Progress','Completed','Cancelled','Archived') then
    raise exception 'Assignment cannot change after a Job is in progress or terminal.'; end if;
  if p_assignment_kind='individual' then
    select * into e from public.employees where id=p_employee_id and public.is_eligible_job_tech(id);
    if not found then raise exception 'Select an active Scrub Technician or Crew Lead with an active user profile.'; end if;
  elsif p_assignment_kind='crew' then
    select * into c from public.crews where id=p_crew_id and status='Active' and archived_at is null;
    if not found then raise exception 'Select an active Crew.'; end if;
    select coalesce(jsonb_agg(coalesce(nullif(btrim(m.preferred_name),''),btrim(m.first_name||' '||m.last_name)) order by m.last_name,m.first_name),'[]'::jsonb)
      into team from public.crew_members cm join public.employees m on m.id=cm.employee_id
      where cm.crew_id=c.id and m.employment_status='Active' and m.archived_at is null;
  end if;
  next_status:=case when j.scheduled_date is null then 'Ready to Schedule'
    when p_assignment_kind='unassigned' then 'Scheduled' else 'Crew Assigned' end;
  update public.jobs set
    assigned_employee_id=case when p_assignment_kind='individual' then e.id end,
    assigned_employee_name=case when p_assignment_kind='individual' then coalesce(nullif(btrim(e.preferred_name),''),btrim(e.first_name||' '||e.last_name)) end,
    assigned_crew_id=case when p_assignment_kind='crew' then c.id end,
    assigned_crew_name=case when p_assignment_kind='crew' then c.crew_name end,
    crew_lead_name=case when p_assignment_kind='crew' then (select coalesce(nullif(btrim(x.preferred_name),''),btrim(x.first_name||' '||x.last_name)) from public.employees x where x.id=c.crew_lead_id) end,
    assigned_team=case when p_assignment_kind='crew' then team else '[]'::jsonb end,
    status=next_status where id=j.id returning * into j;
  return to_jsonb(j);
end $$;
revoke all on function public.set_job_worker_assignment(uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.set_job_worker_assignment(uuid,text,uuid,uuid) to authenticated;

create function public.create_direct_operational_job_v2(
  p_client_id uuid,p_property_id uuid,p_service_id uuid,p_addon_ids uuid[] default '{}'::uuid[],
  p_scheduled_date date default null,p_start_time time default null,p_estimated_duration numeric default null,
  p_assignment_kind text default 'unassigned',p_assigned_employee_id uuid default null,p_assigned_crew_id uuid default null,
  p_labor_hours numeric default 0,p_access_instructions text default null,p_internal_notes text default null,
  p_master_price_override numeric default null,p_addon_quantities jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs; assigned jsonb;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Job creation permission denied.' using errcode='42501'; end if;
  j:=public.create_direct_operational_job(p_client_id,p_property_id,p_service_id,p_addon_ids,p_scheduled_date,p_start_time,
    p_estimated_duration,null,p_labor_hours,p_access_instructions,p_internal_notes,p_master_price_override,p_addon_quantities);
  assigned:=public.set_job_worker_assignment(j.id,p_assignment_kind,p_assigned_employee_id,p_assigned_crew_id);
  return assigned;
end $$;
revoke all on function public.create_direct_operational_job_v2(uuid,uuid,uuid,uuid[],date,time,numeric,text,uuid,uuid,numeric,text,text,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.create_direct_operational_job_v2(uuid,uuid,uuid,uuid[],date,time,numeric,text,uuid,uuid,numeric,text,text,numeric,jsonb) to authenticated;

-- Assignment-aware operational access and client contact projection.
create or replace function public.get_operational_job_ids(p_start date default null,p_end date default null)
returns setof uuid language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'Job access is denied.'; end if;
 return query select j.id from public.jobs j where j.archived_at is null
  and j.status in ('Ready to Schedule','Scheduled','Crew Assigned','In Progress','Completed','Cancelled')
  and public.can_access_job_assignment(j.assigned_employee_id,j.assigned_crew_id)
  and (p_start is null or j.scheduled_date>=p_start) and (p_end is null or j.scheduled_date<=p_end)
  and (j.status<>'Completed' or not public.is_job_financially_handed_off(j.id)) order by j.created_at desc;
end $$;

create or replace function public.get_operational_jobs(p_start date default null,p_end date default null)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'Job access is denied.'; end if;
 return query select to_jsonb(j)||jsonb_build_object('client_phone',c.phone,'client_first_name',c.first_name,'on_my_way_initiated_at',j.on_my_way_initiated_at)
  from public.jobs_operational_safe j left join public.clients c on c.id=j.client_id
    and public.has_any_role(array['Crew Lead','Scrub Technician'])
    and public.can_access_job_assignment(j.assigned_employee_id,j.assigned_crew_id)
  where j.id in(select public.get_operational_job_ids(p_start,p_end)) order by j.created_at desc;
end $$;

create or replace function public.start_operational_job(p_job_id uuid)
returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
declare j public.jobs; safe public.jobs_operational_safe; started timestamptz;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'Job start permission denied.'; end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or not public.can_control_job_timer(j.assigned_employee_id,j.assigned_crew_id) then raise exception 'Job not found or access denied.'; end if;
 if j.archived_at is not null or num_nonnulls(j.assigned_employee_id,j.assigned_crew_id)<>1 then raise exception 'The Job requires an assigned worker before it can be started.'; end if;
 if j.status='In Progress' then null; elsif j.status not in ('Scheduled','Crew Assigned') then raise exception 'Only an Assigned Job can be started.';
 else started:=now(); update public.jobs set status='In Progress',completed_at=null,operational_started_at=coalesce(operational_started_at,started),operational_ended_at=null where id=j.id; end if;
 select * into safe from public.jobs_operational_safe where id=j.id; return safe;
end $$;

create or replace function public.start_or_clock_in_to_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs; e uuid; entry public.time_entries; joined timestamptz;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'Job participation permission denied.'; end if;
 e:=public.current_employee_id(); if e is null then raise exception 'Your user profile must be linked to an active Employee.'; end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or not public.can_access_job_assignment(j.assigned_employee_id,j.assigned_crew_id) then raise exception 'The authenticated employee is not assigned to this Job.'; end if;
 if j.archived_at is not null or j.status<>'In Progress' then raise exception 'Join Job is available only after the Job has been started.'; end if;
 joined:=now(); entry:=public.open_job_payroll_entry(j.id,e,j.assigned_crew_id,joined);
 return jsonb_build_object('jobId',j.id,'jobStatus','In Progress','clockedIn',true,'clockedInAt',entry.clock_in,'timeEntryId',entry.id,'jobStarted',false);
end $$;

create or replace function public.complete_in_progress_job(p_job_id uuid)
returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
declare j public.jobs; safe public.jobs_operational_safe; ended timestamptz;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'Job completion permission denied.'; end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or not public.can_control_job_timer(j.assigned_employee_id,j.assigned_crew_id) then raise exception 'Job not found or access denied.'; end if;
 if j.status='Completed' then select * into safe from public.jobs_operational_safe where id=j.id; return safe; end if;
 if j.archived_at is not null or j.status<>'In Progress' then raise exception 'Only an In Progress Job can be completed.'; end if;
 ended:=now(); perform public.close_job_payroll_entries(j.id,ended);
 update public.jobs set status='Completed',completed_at=ended,operational_ended_at=ended where id=j.id;
 select * into safe from public.jobs_operational_safe where id=j.id; return safe;
end $$;

create or replace function public.initiate_job_on_my_way(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs; phone text; started timestamptz;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'On My Way access denied.'; end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or not public.can_access_job_assignment(j.assigned_employee_id,j.assigned_crew_id) then raise exception 'Job not found or access denied.'; end if;
 if j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') or j.scheduled_date is null or j.start_time is null then raise exception 'This Job is not eligible for On My Way.'; end if;
 select c.phone into phone from public.clients c where c.id=j.client_id;
 if phone is null or length(regexp_replace(phone,'[^0-9]','','g')) not between 7 and 15 then raise exception 'A valid client phone number is required.'; end if;
 if j.on_my_way_initiated_at is not null then return jsonb_build_object('initiated',false,'initiated_at',j.on_my_way_initiated_at); end if;
 update public.jobs set on_my_way_initiated_at=now() where id=j.id and on_my_way_initiated_at is null returning on_my_way_initiated_at into started;
 return jsonb_build_object('initiated',true,'initiated_at',started);
end $$;

-- GPS finish/cancel call this helper, so keep historical trip reads while
-- making their Job authorization individual-or-crew aware.
create or replace function public.can_read_job_gps(p_job_id uuid,p_employee_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (
    public.has_any_role(array['Master Admin','Administrator','Manager'])
    or (p_employee_id=public.current_employee_id() and exists(
      select 1 from public.jobs j where j.id=p_job_id
        and public.can_access_job_assignment(j.assigned_employee_id,j.assigned_crew_id)
    ))
  )
$$;
revoke all on function public.can_read_job_gps(uuid,uuid) from public,anon,authenticated;
grant execute on function public.can_read_job_gps(uuid,uuid) to authenticated;

-- The legacy operational updater delegates timer changes to the dedicated
-- lifecycle RPCs. Management retains non-lifecycle operational edits.
create or replace function public.update_operational_job(
  p_job_id uuid,p_scheduled_date date default null,p_start_time time default null,
  p_estimated_duration numeric default null,p_assigned_crew_id uuid default null,
  p_internal_notes text default null,p_status text default null
) returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
declare j public.jobs; safe public.jobs_operational_safe; crew public.crews; team jsonb;
begin
  if p_status in ('In Progress','Completed') then
    if p_scheduled_date is not null or p_start_time is not null or p_estimated_duration is not null
      or p_assigned_crew_id is not null or p_internal_notes is not null then
      raise exception 'Start or complete a Job separately from other operational edits.';
    end if;
    if p_status='In Progress' then return public.start_operational_job(p_job_id); end if;
    return public.complete_in_progress_job(p_job_id);
  end if;
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Job operation not permitted.' using errcode='42501';
  end if;
  select * into j from public.jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') then
    raise exception 'Terminal or archived Jobs cannot be operationally edited.';
  end if;
  if p_status is not null and p_status not in ('Ready to Schedule','Scheduled','Crew Assigned','Cancelled') then
    raise exception 'Invalid operational status.';
  end if;
  if p_assigned_crew_id is not null then
    if j.assigned_employee_id is not null then
      raise exception 'Use the Job assignment control to change an individual assignment.';
    end if;
    select * into crew from public.crews where id=p_assigned_crew_id and status='Active' and archived_at is null;
    if not found then raise exception 'Active crew not found.'; end if;
    select coalesce(jsonb_agg(coalesce(nullif(btrim(e.preferred_name),''),nullif(btrim(e.first_name||' '||e.last_name),'')) order by e.last_name,e.first_name),'[]'::jsonb)
      into team from public.crew_members cm join public.employees e on e.id=cm.employee_id
      where cm.crew_id=crew.id and e.employment_status='Active' and e.archived_at is null;
  end if;
  update public.jobs set scheduled_date=coalesce(p_scheduled_date,scheduled_date),start_time=coalesce(p_start_time,start_time),
    estimated_duration=coalesce(p_estimated_duration,estimated_duration),internal_notes=coalesce(p_internal_notes,internal_notes),
    status=coalesce(p_status,status),completed_at=case when p_status is not null then null else completed_at end,
    assigned_crew_id=coalesce(p_assigned_crew_id,assigned_crew_id),
    assigned_crew_name=case when p_assigned_crew_id is null then assigned_crew_name else crew.crew_name end,
    crew_lead_name=case when p_assigned_crew_id is null then crew_lead_name else (select coalesce(nullif(btrim(e.preferred_name),''),btrim(e.first_name||' '||e.last_name)) from public.employees e where e.id=crew.crew_lead_id) end,
    assigned_team=case when p_assigned_crew_id is null then assigned_team else team end
  where id=j.id;
  select * into safe from public.jobs_operational_safe where id=j.id; return safe;
end $$;

-- Job payroll rows are created only through Join Job. Non-Job clock entries
-- remain available through the general time-clock RPC.
create or replace function public.clock_in_operational(p_employee_id uuid,p_job_id uuid,p_crew_id uuid,p_entry_type text,p_clock_in timestamptz,p_notes text)
returns public.time_entries_operational_safe language plpgsql security definer set search_path='' as $$
declare r text; target uuid; result public.time_entries; safe public.time_entries_operational_safe; n text; effective_clock_in timestamptz;
begin
  r:=public.current_user_role();
  if p_job_id is not null or p_entry_type='Job' then raise exception 'Use Join Job to create Job payroll time.'; end if;
  target:=case when r in ('Scrub Technician','Sales') then public.current_employee_id() else p_employee_id end;
  if target is null then raise exception 'An employee link is required.'; end if;
  if r not in ('Master Admin','Administrator','Manager','Crew Lead','Scrub Technician','Sales') then raise exception 'Time Clock access denied.'; end if;
  if r='Crew Lead' and target<>public.current_employee_id() and not exists(select 1 from public.crew_members cm where cm.employee_id=target and public.is_assigned_to_crew(cm.crew_id)) then raise exception 'Employee is not in your crew.'; end if;
  if r in ('Scrub Technician','Sales') and target<>public.current_employee_id() then raise exception 'Employee identity mismatch.'; end if;
  if p_crew_id is not null and r in ('Crew Lead','Scrub Technician','Sales') and not public.is_assigned_to_crew(p_crew_id) then raise exception 'Crew is outside your permitted scope.'; end if;
  effective_clock_in:=case when r in ('Master Admin','Administrator') then p_clock_in else now() end;
  if effective_clock_in is null then raise exception 'Clock-in time is required.'; end if;
  if exists(select 1 from public.time_entries t where t.employee_id=target and t.status='Open' and t.clock_out is null and t.archived_at is null) then raise exception 'Employee is already clocked in.'; end if;
  n:='TIME-'||to_char(effective_clock_in,'YYYYMMDDHH24MISSMS')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
  insert into public.time_entries(time_entry_number,employee_id,job_id,crew_id,work_date,clock_in,entry_type,notes,status)
  values(n,target,null,p_crew_id,(effective_clock_in at time zone 'America/Los_Angeles')::date,effective_clock_in,p_entry_type,p_notes,'Open') returning * into result;
  select * into safe from public.time_entries_operational_safe where id=result.id;
  if not found then raise exception 'Created time entry is outside your permitted scope.'; end if;
  return safe;
end $$;

create or replace function public.start_job_gps_trip(p_job_id uuid,p_vehicle_id uuid,p_position jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller_id uuid:=auth.uid(); caller_role text:=public.current_user_role(); e uuid:=public.current_employee_id();
 management boolean:=public.has_any_role(array['Master Admin','Administrator','Manager']); t public.job_mileage_trips; notification jsonb;
begin
 if caller_id is null or caller_role not in ('Master Admin','Administrator','Manager','Crew Lead','Scrub Technician')
  or not public.can_access_job(p_job_id) then raise exception 'GPS mileage access denied.' using errcode='42501'; end if;
 perform 1 from auth.users where id=caller_id for update;
 select * into t from public.job_mileage_trips where user_id=caller_id and job_id=p_job_id and status<>'Cancelled' for update;
 if found then return jsonb_build_object('trip',to_jsonb(t),'initiated',false); end if;
 if exists(select 1 from public.job_mileage_trips where user_id=caller_id and status='Active') then
  raise exception 'Another GPS trip is active. Open that Job to arrive or cancel it first.'; end if;
 perform public.validate_job_gps_position(p_position);
 perform 1 from public.vehicles v where v.id=p_vehicle_id and v.status='Active' and v.archived_at is null
  and (management or v.assigned_employee_id=e or public.is_assigned_to_crew(v.assigned_crew_id)) for share;
 if not found then
  if management then raise exception 'Select an active vehicle.'; end if;
  raise exception 'Select an active vehicle assigned to you or your crew.';
 end if;
 notification:=public.initiate_job_on_my_way(p_job_id);
 insert into public.job_mileage_trips(job_id,user_id,employee_id,vehicle_id,start_latitude,start_longitude,start_accuracy)
 values(p_job_id,caller_id,e,p_vehicle_id,(p_position->>'latitude')::double precision,(p_position->>'longitude')::double precision,(p_position->>'accuracy')::double precision)
 returning * into t;
 return jsonb_build_object('trip',to_jsonb(t),'initiated',notification->'initiated');
end $$;
revoke all on function public.start_job_gps_trip(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.start_job_gps_trip(uuid,uuid,jsonb) to authenticated;

-- Calendar queue must react to either assignment arm.
drop trigger if exists jobs_queue_google_calendar_sync on public.jobs;
create trigger jobs_queue_google_calendar_sync
after insert or update of scheduled_date,start_time,estimated_duration,service_name,property_id,assigned_employee_id,assigned_crew_id,status
on public.jobs for each row execute function public.queue_job_calendar_sync();

revoke all on function public.get_operational_job_ids(date,date),public.get_operational_jobs(date,date),
 public.start_operational_job(uuid),public.start_or_clock_in_to_job(uuid),public.complete_in_progress_job(uuid),public.initiate_job_on_my_way(uuid),
 public.update_operational_job(uuid,date,time,numeric,uuid,text,text),public.clock_in_operational(uuid,uuid,uuid,text,timestamptz,text)
 from public,anon,authenticated;
grant execute on function public.get_operational_job_ids(date,date),public.get_operational_jobs(date,date),
 public.start_operational_job(uuid),public.start_or_clock_in_to_job(uuid),public.complete_in_progress_job(uuid),public.initiate_job_on_my_way(uuid),
 public.update_operational_job(uuid,date,time,numeric,uuid,text,text),public.clock_in_operational(uuid,uuid,uuid,text,timestamptz,text)
 to authenticated;

notify pgrst,'reload schema';
commit;
