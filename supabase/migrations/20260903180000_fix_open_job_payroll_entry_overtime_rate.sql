-- Fixes a live Join Job failure: open_job_payroll_entry referenced
-- employees.overtime_rate, a column that no longer exists (employees only
-- has hourly_rate). Only the invalid overtime calculation is changed; every
-- other behavior of the function (signature, open-entry detection,
-- conflicting-job protection, employee validation, time entry number
-- generation, job/crew/work-date handling, status, notes, security-definer
-- behavior, and grants) is preserved unchanged.
-- Replaces the function body from
-- 20260831021400_separate_master_job_timer_from_employee_payroll.sql
-- without modifying that already-applied migration file.
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
    v_employee.hourly_rate * 1.5
  ) returning * into v_entry;

  return v_entry;
end;
$$;

revoke all on function public.open_job_payroll_entry(uuid,uuid,uuid,timestamptz)
  from public, anon, authenticated;

commit;
