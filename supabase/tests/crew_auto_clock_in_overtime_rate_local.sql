\set ON_ERROR_STOP on

begin;

create temporary table crew_overtime_results (
  test_name text primary key,
  passed boolean not null,
  detail text not null
);

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('ca110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'manager@crew-overtime.invalid', now(), now()),
  ('ca110000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'individual@crew-overtime.invalid', now(), now());

insert into public.employees (
  id, employee_number, first_name, last_name, email, department,
  employment_status, employment_type, hourly_rate, overtime_rate
) values
  ('ca110000-0000-0000-0000-000000000011', 'EMP-OT-CUSTOM', 'Custom', 'Rate', 'custom@crew-overtime.invalid', 'Scrub Technicians', 'Active', 'Full-Time', 20, 42),
  ('ca110000-0000-0000-0000-000000000012', 'EMP-OT-FALLBACK', 'Fallback', 'Rate', 'fallback@crew-overtime.invalid', 'Scrub Technicians', 'Active', 'Part-Time', 24, 0),
  ('ca110000-0000-0000-0000-000000000013', 'EMP-OT-FIRST', 'First', 'Atomic', 'first@crew-overtime.invalid', 'Scrub Technicians', 'Active', 'Part-Time', 21, 31.5),
  ('ca110000-0000-0000-0000-000000000014', 'EMP-OT-CONFLICT', 'Conflict', 'Atomic', 'conflict@crew-overtime.invalid', 'Scrub Technicians', 'Active', 'Part-Time', 22, 33),
  ('ca110000-0000-0000-0000-000000000015', 'EMP-OT-INDIVIDUAL', 'Individual', 'Tech', 'individual@crew-overtime.invalid', 'Scrub Technicians', 'Active', 'Part-Time', 30, 52);

insert into public.user_profiles (id, email, display_name, role, is_active, employee_id) values
  ('ca110000-0000-0000-0000-000000000001', 'manager@crew-overtime.invalid', 'Crew Overtime Manager', 'Manager', true, null),
  ('ca110000-0000-0000-0000-000000000002', 'individual@crew-overtime.invalid', 'Individual Tech', 'Scrub Technician', true, 'ca110000-0000-0000-0000-000000000015');

insert into public.crews (id, crew_name, crew_lead_id, status) values
  ('ca110000-0000-0000-0000-000000000020', 'Overtime Snapshot Crew', 'ca110000-0000-0000-0000-000000000011', 'Active'),
  ('ca110000-0000-0000-0000-000000000021', 'Atomic Conflict Crew', null, 'Active');

-- The lead is intentionally also a member; UNION in Start Job must deduplicate it.
insert into public.crew_members (crew_id, employee_id) values
  ('ca110000-0000-0000-0000-000000000020', 'ca110000-0000-0000-0000-000000000011'),
  ('ca110000-0000-0000-0000-000000000020', 'ca110000-0000-0000-0000-000000000012'),
  ('ca110000-0000-0000-0000-000000000021', 'ca110000-0000-0000-0000-000000000013'),
  ('ca110000-0000-0000-0000-000000000021', 'ca110000-0000-0000-0000-000000000014');

insert into public.jobs (
  id, job_number, division, status, assigned_crew_id, assigned_crew_name, assigned_team
) values
  ('ca110000-0000-0000-0000-000000000030', 'JOB-OT-CREW', 'Residential', 'Crew Assigned', 'ca110000-0000-0000-0000-000000000020', 'Overtime Snapshot Crew', '[]'),
  ('ca110000-0000-0000-0000-000000000031', 'JOB-OT-ATOMIC', 'Residential', 'Crew Assigned', 'ca110000-0000-0000-0000-000000000021', 'Atomic Conflict Crew', '[]'),
  ('ca110000-0000-0000-0000-000000000032', 'JOB-OT-CONFLICTING', 'Residential', 'In Progress', null, null, '[]'),
  ('ca110000-0000-0000-0000-000000000033', 'JOB-OT-INDIVIDUAL', 'Residential', 'Crew Assigned', null, null, '[]');

update public.jobs
set assigned_employee_id = 'ca110000-0000-0000-0000-000000000015',
  assigned_employee_name = 'Individual Tech'
where id = 'ca110000-0000-0000-0000-000000000033';

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'ca110000-0000-0000-0000-000000000001', true);

select public.start_operational_job('ca110000-0000-0000-0000-000000000030');

insert into crew_overtime_results
select 'crew_custom_and_fallback_rates',
  count(*) = 2
    and count(*) filter (where employee_id = 'ca110000-0000-0000-0000-000000000011' and hourly_rate_snapshot = 20 and overtime_rate_snapshot = 42) = 1
    and count(*) filter (where employee_id = 'ca110000-0000-0000-0000-000000000012' and hourly_rate_snapshot = 24 and overtime_rate_snapshot = 36) = 1,
  'Crew Start preserves a positive configured overtime rate and falls back to 1.5x hourly when configured overtime is zero.'
from public.time_entries
where job_id = 'ca110000-0000-0000-0000-000000000030';

insert into crew_overtime_results
select 'crew_start_shared_timestamp_and_deduplication',
  count(*) = 2
    and count(distinct clock_in) = 1
    and bool_and(clock_in = (select operational_started_at from public.jobs where id = 'ca110000-0000-0000-0000-000000000030')),
  'Crew members plus crew lead are deduplicated and share the Job transaction timestamp.'
from public.time_entries
where job_id = 'ca110000-0000-0000-0000-000000000030';

insert into public.time_entries (
  id, time_entry_number, employee_id, job_id, work_date, clock_in,
  entry_type, notes, status, hourly_rate_snapshot, overtime_rate_snapshot
) values (
  'ca110000-0000-0000-0000-000000000040', 'TIME-OT-CONFLICT',
  'ca110000-0000-0000-0000-000000000014', 'ca110000-0000-0000-0000-000000000032',
  current_date, now(), 'Job', 'Existing conflicting Job', 'Open', 22, 33
);

do $$
begin
  begin
    perform public.start_operational_job('ca110000-0000-0000-0000-000000000031');
    raise exception 'Expected the conflicting employee to abort Crew Start.';
  exception
    when others then
      if sqlerrm not like '%is already On Job for JOB-OT-CONFLICTING%' then
        raise;
      end if;
  end;
end;
$$;

insert into crew_overtime_results
select 'conflict_aborts_entire_crew_start',
  (select status = 'Crew Assigned' and operational_started_at is null
    from public.jobs where id = 'ca110000-0000-0000-0000-000000000031')
    and not exists (
      select 1 from public.time_entries
      where job_id = 'ca110000-0000-0000-0000-000000000031'
    ),
  'A conflicting employee leaves the Job unstarted and creates no partial Crew payroll entries.';

select public.start_operational_job('ca110000-0000-0000-0000-000000000033');

insert into crew_overtime_results
select 'individual_start_remains_payroll_free',
  status = 'In Progress'
    and operational_started_at is not null
    and not exists (
      select 1 from public.time_entries
      where job_id = 'ca110000-0000-0000-0000-000000000033'
    ),
  'Individual assignment Start changes only Job lifecycle; payroll still requires Join.'
from public.jobs
where id = 'ca110000-0000-0000-0000-000000000033';

select set_config('request.jwt.claim.sub', 'ca110000-0000-0000-0000-000000000002', true);
select public.start_or_clock_in_to_job('ca110000-0000-0000-0000-000000000033');
select public.start_or_clock_in_to_job('ca110000-0000-0000-0000-000000000033');

insert into crew_overtime_results
select 'individual_join_unchanged_and_idempotent',
  count(*) = 1
    and bool_and(employee_id = 'ca110000-0000-0000-0000-000000000015')
    and bool_and(hourly_rate_snapshot = 30)
    and bool_and(overtime_rate_snapshot = 52),
  'Individual Join remains the sole payroll-open step, remains idempotent, and uses the same rate snapshot helper.'
from public.time_entries
where job_id = 'ca110000-0000-0000-0000-000000000033';

do $$
begin
  if exists (select 1 from crew_overtime_results where not passed) then
    raise exception 'Crew auto-clock-in overtime-rate regression failure.';
  end if;
end;
$$;

table crew_overtime_results;
rollback;
