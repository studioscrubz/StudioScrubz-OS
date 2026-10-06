-- Fixes the open_job_payroll_entry regression introduced by
-- 20261005003510_fix_crew_auto_clock_in_overtime_rate.sql.
--
-- public.employees does not contain overtime_rate.
-- Overtime snapshot is therefore derived from hourly_rate * 1.5,
-- matching the previously corrected payroll behavior.

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
  -- Serialize payroll opens for this employee so automatic crew start
  -- and manual Join cannot create competing open entries.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'job-payroll-employee:' || p_employee_id::text,
      0
    )
  );

  -- Idempotent for the same employee/job.
  select *
  into v_entry
  from public.time_entries
  where employee_id = p_employee_id
    and job_id = p_job_id
    and status = 'Open'
    and clock_out is null
    and archived_at is null
  for update;

  if found then
    return v_entry;
  end if;

  -- Do not allow an employee to be actively clocked into another Job.
  select job.job_number
  into v_conflict
  from public.time_entries entry
  join public.jobs job
    on job.id = entry.job_id
  where entry.employee_id = p_employee_id
    and entry.status = 'Open'
    and entry.clock_out is null
    and entry.archived_at is null
    and entry.job_id <> p_job_id
  order by entry.clock_in, entry.id
  limit 1;

  if found then
    raise exception
      'You are already On Job for %. End that Job before joining another.',
      v_conflict;
  end if;

  select *
  into v_employee
  from public.employees
  where id = p_employee_id
    and archived_at is null;

  if not found then
    raise exception 'Active Employee not found.';
  end if;

  v_number :=
    'TIME-' ||
    to_char(p_started_at, 'YYYYMMDDHH24MISSMS') ||
    '-' ||
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.time_entries(
    time_entry_number,
    employee_id,
    job_id,
    crew_id,
    work_date,
    clock_in,
    entry_type,
    notes,
    status,
    hourly_rate_snapshot,
    overtime_rate_snapshot
  )
  values (
    v_number,
    p_employee_id,
    p_job_id,
    p_crew_id,
    (p_started_at at time zone 'America/Los_Angeles')::date,
    p_started_at,
    'Job',
    'Job participation',
    'Open',
    v_employee.hourly_rate,
    v_employee.hourly_rate * 1.5
  )
  returning *
  into v_entry;

  return v_entry;
end;
$$;

revoke all
on function public.open_job_payroll_entry(uuid,uuid,uuid,timestamptz)
from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;