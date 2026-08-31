\set ON_ERROR_STOP on

begin;

create temporary table master_timer_results (
  test_name text primary key,
  passed boolean not null,
  detail text not null
);

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('fb600000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'manager@master-timer.invalid', now(), now()),
  ('fb600000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'tech@master-timer.invalid', now(), now());

insert into public.employees (
  id, employee_number, first_name, last_name, email, department,
  employment_status, employment_type, hourly_rate, overtime_rate
) values
  ('fb600000-0000-0000-0000-000000000011', 'EMP-TIMER-MGR', 'Timer', 'Manager', 'manager@master-timer.invalid', 'Management', 'Active', 'Full-Time', 20, 30),
  ('fb600000-0000-0000-0000-000000000012', 'EMP-TIMER-TECH', 'Timer', 'Tech', 'tech@master-timer.invalid', 'Scrub Technicians', 'Active', 'Part-Time', 25, 37.5);

insert into public.user_profiles (id, email, display_name, role, is_active, employee_id) values
  ('fb600000-0000-0000-0000-000000000001', 'manager@master-timer.invalid', 'Timer Manager', 'Manager', true, null),
  ('fb600000-0000-0000-0000-000000000002', 'tech@master-timer.invalid', 'Timer Tech', 'Scrub Technician', true, 'fb600000-0000-0000-0000-000000000012');

insert into public.crews (id, crew_name, status)
values ('fb600000-0000-0000-0000-000000000020', 'Master Timer Crew', 'Active');
insert into public.crew_members (crew_id, employee_id) values
  ('fb600000-0000-0000-0000-000000000020', 'fb600000-0000-0000-0000-000000000011'),
  ('fb600000-0000-0000-0000-000000000020', 'fb600000-0000-0000-0000-000000000012');
insert into public.jobs (
  id, job_number, division, status, assigned_crew_id, assigned_crew_name, assigned_team
) values (
  'fb600000-0000-0000-0000-000000000030', 'JOB-MASTER-TIMER', 'Residential',
  'Crew Assigned', 'fb600000-0000-0000-0000-000000000020', 'Master Timer Crew', '[]'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fb600000-0000-0000-0000-000000000001', true);
select public.start_operational_job('fb600000-0000-0000-0000-000000000030');

insert into master_timer_results
select 'start_is_master_only',
  status = 'In Progress'
    and operational_started_at is not null
    and not exists (
      select 1 from public.time_entries
      where job_id = 'fb600000-0000-0000-0000-000000000030'
    )
    and not exists (
      select 1 from public.employee_work_sessions
      where employee_id = 'fb600000-0000-0000-0000-000000000011'
    ),
  'Start sets the master timer without payroll or platform presence.'
from public.jobs where id = 'fb600000-0000-0000-0000-000000000030';

update public.user_profiles
set employee_id = 'fb600000-0000-0000-0000-000000000011'
where id = 'fb600000-0000-0000-0000-000000000001';

update public.jobs
set operational_started_at = now() - interval '4 hours 30 minutes',
  operational_ended_at = now() - interval '1 day'
where id = 'fb600000-0000-0000-0000-000000000030';

select public.start_or_clock_in_to_job('fb600000-0000-0000-0000-000000000030');
update public.time_entries
set clock_in = (select operational_started_at + interval '5 minutes'
    from public.jobs where id = 'fb600000-0000-0000-0000-000000000030'),
  work_date = ((select operational_started_at from public.jobs
    where id = 'fb600000-0000-0000-0000-000000000030') at time zone 'America/Los_Angeles')::date
where job_id = 'fb600000-0000-0000-0000-000000000030'
  and employee_id = 'fb600000-0000-0000-0000-000000000011';
select public.start_or_clock_in_to_job('fb600000-0000-0000-0000-000000000030');

insert into master_timer_results
select 'manager_join_is_individual_and_idempotent',
  (select operational_started_at from public.jobs
    where id = 'fb600000-0000-0000-0000-000000000030')
    = min(clock_in) - interval '5 minutes'
  and count(*) = 1
  and not exists (
    select 1 from public.employee_work_sessions
    where employee_id = 'fb600000-0000-0000-0000-000000000011'
  ),
  'Manager Join opens one payroll entry and does not change master time or presence.'
from public.time_entries
where job_id = 'fb600000-0000-0000-0000-000000000030'
  and employee_id = 'fb600000-0000-0000-0000-000000000011';

select set_config('request.jwt.claim.sub', 'fb600000-0000-0000-0000-000000000002', true);
select public.start_or_clock_in_to_job('fb600000-0000-0000-0000-000000000030');
update public.time_entries
set clock_in = (select operational_started_at + interval '20 minutes'
    from public.jobs where id = 'fb600000-0000-0000-0000-000000000030'),
  work_date = ((select operational_started_at from public.jobs
    where id = 'fb600000-0000-0000-0000-000000000030') at time zone 'America/Los_Angeles')::date
where job_id = 'fb600000-0000-0000-0000-000000000030'
  and employee_id = 'fb600000-0000-0000-0000-000000000012';

select set_config('request.jwt.claim.sub', 'fb600000-0000-0000-0000-000000000001', true);
select public.complete_in_progress_job('fb600000-0000-0000-0000-000000000030');

insert into master_timer_results
select 'end_uses_separate_shared_timestamp',
  (select abs(extract(epoch from (operational_ended_at - operational_started_at)) - 16200) < 2
    from public.jobs where id = 'fb600000-0000-0000-0000-000000000030')
  and count(*) = 2
  and count(distinct clock_out) = 1
  and (select operational_ended_at = completed_at from public.jobs
    where id = 'fb600000-0000-0000-0000-000000000030')
  and bool_and(clock_out = (select operational_ended_at from public.jobs
    where id = 'fb600000-0000-0000-0000-000000000030'))
  and abs(min(total_hours) - 4.1666666666666667) < 0.001
  and abs(max(total_hours) - 4.4166666666666667) < 0.001
  and not exists (
    select 1 from public.employee_work_sessions
    where employee_id in (
      'fb600000-0000-0000-0000-000000000011',
      'fb600000-0000-0000-0000-000000000012'
    )
  ),
  'End overwrites a stale Job end and shares one timestamp while master and employee durations remain separate.'
from public.time_entries
where job_id = 'fb600000-0000-0000-0000-000000000030';

do $$
begin
  if exists (select 1 from master_timer_results where not passed) then
    raise exception 'Master Job timer separation regression failure.';
  end if;
end
$$;

table master_timer_results;
rollback;
