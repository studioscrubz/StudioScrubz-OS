-- Separate platform presence from payable Job participation.
-- REVIEW ONLY: do not apply to production without manual review.
begin;

create table if not exists public.employee_work_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  status text not null default 'Open' check (status in ('Open','Completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_work_sessions_valid_end check (clock_out is null or clock_out >= clock_in)
);

create unique index if not exists one_open_work_session_per_employee
  on public.employee_work_sessions(employee_id)
  where status = 'Open' and clock_out is null;
create index if not exists employee_work_sessions_active_idx
  on public.employee_work_sessions(employee_id, clock_in)
  where status = 'Open' and clock_out is null;

alter table public.employee_work_sessions enable row level security;
revoke all on public.employee_work_sessions from public, anon, authenticated;

-- Convert any currently-open legacy general punch into presence without allowing
-- it to keep accruing payroll. The source record is retained as non-payable history.
insert into public.employee_work_sessions(employee_id, clock_in)
select entry.employee_id, entry.clock_in from public.time_entries entry
where entry.employee_id is not null and entry.job_id is null and entry.status = 'Open'
  and entry.clock_out is null and entry.archived_at is null
on conflict (employee_id) where status = 'Open' and clock_out is null do nothing;
update public.time_entries set clock_out = now(), status = 'Rejected', break_minutes = 0,
  total_hours = 0, regular_hours = 0, overtime_hours = 0,
  regular_pay = 0, overtime_pay = 0, gross_pay = 0,
  notes = concat_ws(E'\n', nullif(notes, ''), 'Converted from legacy platform Clock In; presence is non-payable.')
where job_id is null and status = 'Open' and clock_out is null and archived_at is null;

create or replace function public.ensure_employee_platform_active(p_employee_id uuid)
returns public.employee_work_sessions
language plpgsql security definer set search_path = '' as $$
declare v_session public.employee_work_sessions;
begin
  select * into v_session from public.employee_work_sessions
  where employee_id = p_employee_id and status = 'Open' and clock_out is null
  order by clock_in desc limit 1 for update;
  if found then return v_session; end if;
  insert into public.employee_work_sessions(employee_id)
  values (p_employee_id) returning * into v_session;
  return v_session;
exception when unique_violation then
  select * into strict v_session from public.employee_work_sessions
  where employee_id = p_employee_id and status = 'Open' and clock_out is null;
  return v_session;
end; $$;

create or replace function public.start_my_work()
returns public.employee_work_sessions
language plpgsql security definer set search_path = '' as $$
declare v_employee_id uuid;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  v_employee_id := public.current_employee_id();
  if v_employee_id is null then raise exception 'Your user profile must be linked to an active Employee.'; end if;
  return public.ensure_employee_platform_active(v_employee_id);
end; $$;

create or replace function public.stop_my_work()
returns public.employee_work_sessions
language plpgsql security definer set search_path = '' as $$
declare v_employee_id uuid; v_session public.employee_work_sessions; v_job_number text;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  v_employee_id := public.current_employee_id();
  if v_employee_id is null then raise exception 'Your user profile must be linked to an active Employee.'; end if;
  select job.job_number into v_job_number
  from public.time_entries entry join public.jobs job on job.id = entry.job_id
  where entry.employee_id = v_employee_id and entry.job_id is not null
    and entry.status = 'Open' and entry.clock_out is null and entry.archived_at is null
  limit 1;
  if found then raise exception 'End active Job % before Clock Out.', v_job_number; end if;
  select * into v_session from public.employee_work_sessions
  where employee_id = v_employee_id and status = 'Open' and clock_out is null
  order by clock_in desc limit 1 for update;
  if not found then raise exception 'You are already Offline.'; end if;
  update public.employee_work_sessions set clock_out = now(), status = 'Completed', updated_at = now()
  where id = v_session.id returning * into v_session;
  return v_session;
end; $$;

create or replace function public.get_my_work_session()
returns public.employee_work_sessions
language plpgsql stable security definer set search_path = '' as $$
declare v_employee_id uuid; v_session public.employee_work_sessions;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  v_employee_id := public.current_employee_id();
  if v_employee_id is null then return null; end if;
  select * into v_session from public.employee_work_sessions
  where employee_id = v_employee_id and status = 'Open' and clock_out is null
  order by clock_in desc limit 1;
  return v_session;
end; $$;

drop function if exists public.get_active_employee_work_sessions();
create function public.get_active_employee_work_sessions()
returns table(id uuid, employee_id uuid, clock_in timestamptz, status text, created_at timestamptz,
  updated_at timestamptz, employee_number text, employee_name text)
language sql stable security definer set search_path = '' as $$
  select session.id, session.employee_id, session.clock_in, session.status,
    session.created_at, session.updated_at, employee.employee_number,
    coalesce(employee.preferred_name, nullif(btrim(employee.first_name || ' ' || employee.last_name), ''), 'Employee')
  from public.employee_work_sessions session
  join public.employees employee on employee.id = session.employee_id
  where session.status = 'Open' and session.clock_out is null
    and (public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead'])
      or session.employee_id = public.current_employee_id())
  order by session.clock_in;
$$;

create or replace function public.open_job_payroll_entry(p_job_id uuid, p_employee_id uuid, p_crew_id uuid, p_started_at timestamptz)
returns public.time_entries
language plpgsql security definer set search_path = '' as $$
declare v_entry public.time_entries; v_employee public.employees; v_conflict text; v_number text;
begin
  select * into v_entry from public.time_entries
  where employee_id = p_employee_id and job_id = p_job_id and status = 'Open'
    and clock_out is null and archived_at is null for update;
  if found then return v_entry; end if;
  select job.job_number into v_conflict
  from public.time_entries entry join public.jobs job on job.id = entry.job_id
  where entry.employee_id = p_employee_id and entry.status = 'Open'
    and entry.clock_out is null and entry.archived_at is null and entry.job_id <> p_job_id
  limit 1;
  if found then raise exception 'You are already On Job for %. End that Job before joining another.', v_conflict; end if;
  select * into v_employee from public.employees where id = p_employee_id and archived_at is null;
  if not found then raise exception 'Active Employee not found.'; end if;
  v_number := 'TIME-' || to_char(p_started_at, 'YYYYMMDDHH24MISSMS') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  insert into public.time_entries(time_entry_number, employee_id, job_id, crew_id, work_date,
    clock_in, entry_type, notes, status, hourly_rate_snapshot, overtime_rate_snapshot)
  values (v_number, p_employee_id, p_job_id, p_crew_id, (p_started_at at time zone 'America/Los_Angeles')::date,
    p_started_at, 'Job', 'Job participation', 'Open', v_employee.hourly_rate,
    case when v_employee.overtime_rate > 0 then v_employee.overtime_rate else v_employee.hourly_rate * 1.5 end)
  returning * into v_entry;
  perform public.ensure_employee_platform_active(p_employee_id);
  return v_entry;
end; $$;

create or replace function public.close_job_payroll_entries(p_job_id uuid, p_ended_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_entry public.time_entries; v_hours numeric; v_regular numeric; v_overtime numeric;
  v_used_regular numeric; v_closed integer := 0;
begin
  for v_entry in select * from public.time_entries
    where job_id = p_job_id and status = 'Open' and clock_out is null and archived_at is null
    order by employee_id, work_date, clock_in, id for update
  loop
    v_hours := greatest(extract(epoch from (p_ended_at - v_entry.clock_in)) / 3600
      - greatest(v_entry.break_minutes, 0) / 60.0, 0);
    select coalesce(sum(entry.regular_hours), 0) into v_used_regular from public.time_entries entry
    where entry.employee_id = v_entry.employee_id and entry.work_date = v_entry.work_date
      and entry.id <> v_entry.id and entry.status in ('Completed','Approved') and entry.archived_at is null;
    v_regular := least(v_hours, greatest(8 - v_used_regular, 0));
    v_overtime := greatest(v_hours - v_regular, 0);
    update public.time_entries set clock_out = p_ended_at, status = 'Completed',
      total_hours = v_hours, regular_hours = v_regular, overtime_hours = v_overtime,
      regular_pay = v_regular * hourly_rate_snapshot,
      overtime_pay = v_overtime * overtime_rate_snapshot,
      gross_pay = v_regular * hourly_rate_snapshot + v_overtime * overtime_rate_snapshot
    where id = v_entry.id and status = 'Open' and clock_out is null;
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end; $$;

create or replace function public.start_operational_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_safe public.jobs_operational_safe; v_employee_id uuid; v_role text;
  v_existing public.time_entries; v_started_at timestamptz;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead']) then
    raise exception 'Job start permission denied.';
  end if;
  v_role := public.current_user_role();
  v_employee_id := public.current_employee_id();
  if v_employee_id is null then raise exception 'Your user profile must be linked to an active Employee to Start a Job.'; end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_role = 'Crew Lead' and (v_job.assigned_crew_id is null or not public.is_assigned_to_crew(v_job.assigned_crew_id)) then
    raise exception 'The Job is not assigned to your crew.';
  end if;
  if v_job.archived_at is not null or v_job.assigned_crew_id is null then raise exception 'The Job requires an assigned crew before it can be started.'; end if;
  if v_job.status = 'In Progress' then
    select * into v_existing from public.time_entries where employee_id = v_employee_id and job_id = v_job.id
      and status = 'Open' and clock_out is null and archived_at is null;
    if not found then raise exception 'This Job is already In Progress.'; end if;
  elsif v_job.status not in ('Scheduled','Crew Assigned') then
    raise exception 'Only a Scheduled or Crew Assigned Job can be started.';
  else
    v_started_at := now();
    perform public.open_job_payroll_entry(v_job.id, v_employee_id, v_job.assigned_crew_id, v_started_at);
    update public.jobs set status = 'In Progress', completed_at = null,
      operational_started_at = coalesce(operational_started_at, v_started_at), operational_ended_at = null
    where id = v_job.id;
  end if;
  select * into v_safe from public.jobs_operational_safe where id = v_job.id;
  if not found then raise exception 'Started Job is outside your permitted scope.'; end if;
  return v_safe;
end; $$;

create or replace function public.start_or_clock_in_to_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_employee_id uuid; v_entry public.time_entries; v_joined_at timestamptz;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then
    raise exception 'Job participation permission denied.';
  end if;
  v_employee_id := public.current_employee_id();
  if v_employee_id is null then raise exception 'Your user profile must be linked to an active Employee.'; end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.archived_at is not null or v_job.status is distinct from 'In Progress' then
    raise exception 'Join Job is available only after the Job has been started.';
  end if;
  if v_job.assigned_crew_id is null or not public.is_assigned_to_crew(v_job.assigned_crew_id) then
    raise exception 'The authenticated employee is not assigned to this Job.';
  end if;
  v_joined_at := now();
  v_entry := public.open_job_payroll_entry(v_job.id, v_employee_id, v_job.assigned_crew_id, v_joined_at);
  return jsonb_build_object('jobId', v_job.id, 'jobStatus', 'In Progress', 'clockedIn', true,
    'clockedInAt', v_entry.clock_in, 'timeEntryId', v_entry.id, 'jobStarted', false);
end; $$;

create or replace function public.complete_in_progress_job(p_job_id uuid)
returns public.jobs_operational_safe language plpgsql security definer set search_path = '' as $$
declare v_role text; v_job public.jobs; v_safe public.jobs_operational_safe; v_ended_at timestamptz;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  v_role := public.current_user_role();
  if v_role not in ('Master Admin','Administrator','Manager','Crew Lead') then raise exception 'Job completion permission denied.'; end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.status = 'Completed' then
    select * into v_safe from public.jobs_operational_safe where id = v_job.id; return v_safe;
  end if;
  if v_job.archived_at is not null or v_job.status is distinct from 'In Progress' then raise exception 'Only an In Progress Job can be completed.'; end if;
  if v_role = 'Crew Lead' and (v_job.assigned_crew_id is null or not public.is_assigned_to_crew(v_job.assigned_crew_id)) then
    raise exception 'The Job is not assigned to your crew.';
  end if;
  v_ended_at := now();
  perform public.close_job_payroll_entries(v_job.id, v_ended_at);
  update public.jobs set status = 'Completed', completed_at = v_ended_at,
    operational_ended_at = coalesce(operational_ended_at, v_ended_at) where id = v_job.id;
  select * into v_safe from public.jobs_operational_safe where id = v_job.id;
  return v_safe;
end; $$;

create or replace function public.cancel_operational_job(p_job_id uuid, p_note text default null)
returns public.jobs_operational_safe language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_safe public.jobs_operational_safe; v_ended_at timestamptz;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Job cancellation permission denied.';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.status = 'Cancelled' then select * into v_safe from public.jobs_operational_safe where id = v_job.id; return v_safe; end if;
  if v_job.status in ('Completed','Archived') or v_job.archived_at is not null then raise exception 'This Job cannot be cancelled.'; end if;
  if v_job.status = 'In Progress' then
    v_ended_at := now();
    perform public.close_job_payroll_entries(v_job.id, v_ended_at);
  end if;
  update public.jobs set status = 'Cancelled', internal_notes = coalesce(nullif(btrim(p_note), ''), internal_notes),
    completed_at = null, operational_ended_at = case when v_ended_at is null then operational_ended_at else coalesce(operational_ended_at, v_ended_at) end
  where id = v_job.id;
  select * into v_safe from public.jobs_operational_safe where id = v_job.id;
  return v_safe;
end; $$;

revoke all on function public.ensure_employee_platform_active(uuid) from public, anon, authenticated;
revoke all on function public.open_job_payroll_entry(uuid,uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.close_job_payroll_entries(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.start_my_work() from public, anon, authenticated;
revoke all on function public.stop_my_work() from public, anon, authenticated;
revoke all on function public.get_my_work_session() from public, anon, authenticated;
revoke all on function public.get_active_employee_work_sessions() from public, anon, authenticated;
revoke all on function public.start_operational_job(uuid) from public, anon, authenticated;
revoke all on function public.start_or_clock_in_to_job(uuid) from public, anon, authenticated;
revoke all on function public.complete_in_progress_job(uuid) from public, anon, authenticated;
revoke all on function public.cancel_operational_job(uuid,text) from public, anon, authenticated;
do $$ begin
  if to_regprocedure('public.finish_job_and_clock_out(uuid,integer)') is not null then
    execute 'revoke all on function public.finish_job_and_clock_out(uuid,integer) from public, anon, authenticated';
  end if;
end $$;
grant execute on function public.start_my_work() to authenticated;
grant execute on function public.stop_my_work() to authenticated;
grant execute on function public.get_my_work_session() to authenticated;
grant execute on function public.get_active_employee_work_sessions() to authenticated;
grant execute on function public.start_operational_job(uuid) to authenticated;
grant execute on function public.start_or_clock_in_to_job(uuid) to authenticated;
grant execute on function public.complete_in_progress_job(uuid) to authenticated;
grant execute on function public.cancel_operational_job(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
