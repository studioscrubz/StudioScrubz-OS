-- Atomically start a crew-assigned Job and open payroll for its eligible crew.
-- Individual-assignment Start -> Join behavior remains application-controlled.
begin;

do $$
declare
  duplicate_employee_id uuid;
  duplicate_count bigint;
begin
  select entry.employee_id, count(*)
  into duplicate_employee_id, duplicate_count
  from public.time_entries entry
  where entry.employee_id is not null
    and entry.job_id is not null
    and entry.status = 'Open'
    and entry.clock_out is null
    and entry.archived_at is null
  group by entry.employee_id
  having count(*) > 1
  order by entry.employee_id
  limit 1;

  if found then
    raise exception
      'Cannot enforce one open Job time entry per employee: employee % has % open Job entries. Resolve legacy duplicates before applying this migration.',
      duplicate_employee_id, duplicate_count;
  end if;
end;
$$;

create unique index one_open_job_time_entry_per_employee
on public.time_entries(employee_id)
where employee_id is not null
  and job_id is not null
  and status = 'Open'
  and clock_out is null
  and archived_at is null;

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
  -- Serializes all controlled Job payroll opens for one employee. This closes
  -- the check-then-insert race for both automatic crew start and manual Join.
  perform pg_advisory_xact_lock(
    hashtextextended('job-payroll-employee:' || p_employee_id::text, 0)
  );

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
  order by entry.clock_in, entry.id
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
    v_employee.hourly_rate * 1.5
  ) returning * into v_entry;

  return v_entry;
end;
$$;

revoke all on function public.open_job_payroll_entry(uuid,uuid,uuid,timestamptz)
from public, anon, authenticated;

create or replace function public.start_operational_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
  safe public.jobs_operational_safe;
  started_at timestamptz;
  eligible_employee_ids uuid[] := '{}'::uuid[];
  eligible_employee_id uuid;
  conflict_employee_name text;
  conflict_job_number text;
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician'])
  then
    raise exception 'Job start permission denied.';
  end if;

  select * into j from public.jobs where id = p_job_id for update;
  if not found or not public.can_control_job_timer(j.assigned_employee_id,j.assigned_crew_id) then
    raise exception 'Job not found or access denied.';
  end if;
  if j.archived_at is not null or num_nonnulls(j.assigned_employee_id,j.assigned_crew_id) <> 1 then
    raise exception 'The Job requires an assigned worker before it can be started.';
  end if;

  -- A successful retry is intentionally a no-op. In particular, it does not
  -- rediscover members added to the Crew after the original start.
  if j.status = 'In Progress' then
    select * into safe from public.jobs_operational_safe where id = j.id;
    return safe;
  end if;
  if j.status not in ('Scheduled','Crew Assigned') then
    raise exception 'Only an Assigned Job can be started.';
  end if;

  started_at := transaction_timestamp();

  if j.assigned_crew_id is not null then
    select coalesce(array_agg(roster.employee_id order by roster.employee_id), '{}'::uuid[])
    into eligible_employee_ids
    from (
      select member.employee_id
      from public.crew_members member
      where member.crew_id = j.assigned_crew_id
      union
      select crew.crew_lead_id
      from public.crews crew
      where crew.id = j.assigned_crew_id
        and crew.crew_lead_id is not null
    ) roster
    join public.employees employee on employee.id = roster.employee_id
    where employee.department = 'Scrub Technicians'
      and employee.employment_status = 'Active'
      and employee.archived_at is null;

    -- Lock in UUID order so concurrent starts involving overlapping Crews do
    -- not race or acquire employee locks in inconsistent order.
    foreach eligible_employee_id in array eligible_employee_ids loop
      perform pg_advisory_xact_lock(
        hashtextextended('job-payroll-employee:' || eligible_employee_id::text, 0)
      );
    end loop;

    select
      coalesce(
        nullif(btrim(employee.preferred_name), ''),
        nullif(btrim(concat_ws(' ', employee.first_name, employee.last_name)), ''),
        employee.employee_number,
        employee.id::text
      ),
      conflict_job.job_number
    into conflict_employee_name, conflict_job_number
    from unnest(eligible_employee_ids) roster(employee_id)
    join public.employees employee on employee.id = roster.employee_id
    join public.time_entries entry on entry.employee_id = roster.employee_id
    join public.jobs conflict_job on conflict_job.id = entry.job_id
    where entry.job_id <> j.id
      and entry.status = 'Open'
      and entry.clock_out is null
      and entry.archived_at is null
    order by roster.employee_id, entry.clock_in, entry.id
    limit 1;

    if found then
      raise exception '% is already On Job for %. End that Job before starting this Job.',
        conflict_employee_name, conflict_job_number;
    end if;

    foreach eligible_employee_id in array eligible_employee_ids loop
      perform public.open_job_payroll_entry(
        j.id, eligible_employee_id, j.assigned_crew_id, started_at
      );
    end loop;
  end if;

  update public.jobs
  set status = 'In Progress',
    completed_at = null,
    operational_started_at = coalesce(operational_started_at, started_at),
    operational_ended_at = null
  where id = j.id;

  select * into safe from public.jobs_operational_safe where id = j.id;
  return safe;
end;
$$;

revoke all on function public.start_operational_job(uuid)
from public, anon, authenticated;
grant execute on function public.start_operational_job(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
