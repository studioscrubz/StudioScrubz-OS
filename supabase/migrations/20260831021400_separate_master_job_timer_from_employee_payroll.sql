-- Separate the authoritative Job timer from individual employee payroll time.
-- Start Job changes only the Job lifecycle. Join Job remains the sole path that
-- opens employee Job payroll, and neither action changes platform presence.
begin;

create or replace function public.open_job_payroll_entry(
  p_job_id uuid,
  p_employee_id uuid,
  p_crew_id uuid,
  p_started_at timestamptz
)
returns public.time_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.time_entries;
  v_employee public.employees;
  v_conflict text;
  v_number text;
begin
  select * into v_entry
  from public.time_entries
  where employee_id = p_employee_id
    and job_id = p_job_id
    and status = 'Open'
    and clock_out is null
    and archived_at is null
  for update;
  if found then return v_entry; end if;

  select job.job_number into v_conflict
  from public.time_entries entry
  join public.jobs job on job.id = entry.job_id
  where entry.employee_id = p_employee_id
    and entry.status = 'Open'
    and entry.clock_out is null
    and entry.archived_at is null
    and entry.job_id <> p_job_id
  limit 1;
  if found then
    raise exception 'You are already On Job for %. End that Job before joining another.', v_conflict;
  end if;

  select * into v_employee
  from public.employees
  where id = p_employee_id and archived_at is null;
  if not found then raise exception 'Active Employee not found.'; end if;

  v_number := 'TIME-' || to_char(p_started_at, 'YYYYMMDDHH24MISSMS') || '-'
    || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  insert into public.time_entries(
    time_entry_number, employee_id, job_id, crew_id, work_date,
    clock_in, entry_type, notes, status, hourly_rate_snapshot, overtime_rate_snapshot
  ) values (
    v_number, p_employee_id, p_job_id, p_crew_id,
    (p_started_at at time zone 'America/Los_Angeles')::date,
    p_started_at, 'Job', 'Job participation', 'Open', v_employee.hourly_rate,
    case when v_employee.overtime_rate > 0
      then v_employee.overtime_rate
      else v_employee.hourly_rate * 1.5
    end
  ) returning * into v_entry;

  return v_entry;
end;
$$;

create or replace function public.start_operational_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_safe public.jobs_operational_safe;
  v_role text;
  v_started_at timestamptz;
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead'])
  then
    raise exception 'Job start permission denied.';
  end if;

  v_role := public.current_user_role();
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;

  if v_role = 'Crew Lead'
    and (v_job.assigned_crew_id is null or not public.is_assigned_to_crew(v_job.assigned_crew_id))
  then
    raise exception 'The Job is not assigned to your crew.';
  end if;
  if v_job.archived_at is not null or v_job.assigned_crew_id is null then
    raise exception 'The Job requires an assigned crew before it can be started.';
  end if;

  if v_job.status = 'In Progress' then
    null;
  elsif v_job.status not in ('Scheduled','Crew Assigned') then
    raise exception 'Only a Scheduled or Crew Assigned Job can be started.';
  else
    v_started_at := now();
    update public.jobs
    set status = 'In Progress',
      completed_at = null,
      operational_started_at = coalesce(operational_started_at, v_started_at),
      operational_ended_at = null
    where id = v_job.id;
  end if;

  select * into v_safe from public.jobs_operational_safe where id = v_job.id;
  if not found then raise exception 'Started Job is outside your permitted scope.'; end if;
  return v_safe;
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
  v_ended_at timestamptz;
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
  if v_job.status = 'Completed' then
    select * into v_safe from public.jobs_operational_safe where id = v_job.id;
    return v_safe;
  end if;
  if v_job.archived_at is not null or v_job.status is distinct from 'In Progress' then
    raise exception 'Only an In Progress Job can be completed.';
  end if;
  if v_role = 'Crew Lead'
    and (v_job.assigned_crew_id is null or not public.is_assigned_to_crew(v_job.assigned_crew_id))
  then
    raise exception 'The Job is not assigned to your crew.';
  end if;

  v_ended_at := now();
  perform public.close_job_payroll_entries(v_job.id, v_ended_at);
  update public.jobs
  set status = 'Completed',
    completed_at = v_ended_at,
    operational_ended_at = v_ended_at
  where id = v_job.id;

  select * into v_safe from public.jobs_operational_safe where id = v_job.id;
  return v_safe;
end;
$$;

revoke all on function public.open_job_payroll_entry(uuid,uuid,uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.start_operational_job(uuid)
  from public, anon, authenticated;
revoke all on function public.complete_in_progress_job(uuid)
  from public, anon, authenticated;
grant execute on function public.start_operational_job(uuid) to authenticated;
grant execute on function public.complete_in_progress_job(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
