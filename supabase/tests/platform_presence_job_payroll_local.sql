\set ON_ERROR_STOP on
begin;

create temporary table feature_results(test_name text primary key, passed boolean not null, detail text not null);

insert into auth.users(id,aud,role,email,created_at,updated_at) values
('fa500000-0000-0000-0000-000000000001','authenticated','authenticated','manager@presence.invalid',now(),now()),
('fa500000-0000-0000-0000-000000000002','authenticated','authenticated','tech-b@presence.invalid',now(),now()),
('fa500000-0000-0000-0000-000000000003','authenticated','authenticated','tech-c@presence.invalid',now(),now());
insert into public.employees(id,employee_number,first_name,last_name,email,department,employment_status,employment_type,hourly_rate,overtime_rate) values
('fa500000-0000-0000-0000-000000000011','EMP-PRES-A','Presence','Manager','manager@presence.invalid','Management','Active','Full-Time',20,30),
('fa500000-0000-0000-0000-000000000012','EMP-PRES-B','Presence','Tech B','tech-b@presence.invalid','Scrub Technicians','Active','Part-Time',25,37.5),
('fa500000-0000-0000-0000-000000000013','EMP-PRES-C','Presence','Tech C','tech-c@presence.invalid','Scrub Technicians','Active','Part-Time',30,45);
insert into public.user_profiles(id,email,display_name,role,is_active,employee_id) values
('fa500000-0000-0000-0000-000000000001','manager@presence.invalid','Presence Manager','Manager',true,'fa500000-0000-0000-0000-000000000011'),
('fa500000-0000-0000-0000-000000000002','tech-b@presence.invalid','Presence Tech B','Scrub Technician',true,'fa500000-0000-0000-0000-000000000012'),
('fa500000-0000-0000-0000-000000000003','tech-c@presence.invalid','Presence Tech C','Scrub Technician',true,'fa500000-0000-0000-0000-000000000013');
insert into public.crews(id,crew_name,status) values ('fa500000-0000-0000-0000-000000000020','Presence Crew','Active');
insert into public.crew_members(crew_id,employee_id) values
('fa500000-0000-0000-0000-000000000020','fa500000-0000-0000-0000-000000000011'),
('fa500000-0000-0000-0000-000000000020','fa500000-0000-0000-0000-000000000012'),
('fa500000-0000-0000-0000-000000000020','fa500000-0000-0000-0000-000000000013');
insert into public.jobs(id,job_number,division,status,assigned_crew_id,assigned_crew_name,assigned_team) values
('fa500000-0000-0000-0000-000000000030','JOB-PRES-MAIN','Residential','Crew Assigned','fa500000-0000-0000-0000-000000000020','Presence Crew','[]'),
('fa500000-0000-0000-0000-000000000031','JOB-PRES-OTHER','Residential','In Progress','fa500000-0000-0000-0000-000000000020','Presence Crew','[]'),
('fa500000-0000-0000-0000-000000000032','JOB-PRES-CANCEL','Residential','In Progress','fa500000-0000-0000-0000-000000000020','Presence Crew','[]');

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','fa500000-0000-0000-0000-000000000001',true);
select public.start_my_work();
insert into feature_results select 'clock_in_presence_only',
  exists(select 1 from public.employee_work_sessions where employee_id='fa500000-0000-0000-0000-000000000011' and status='Open')
  and not exists(select 1 from public.time_entries where employee_id='fa500000-0000-0000-0000-000000000011'),
  'Clock In opens presence and no payroll entry.';
select public.stop_my_work();
insert into feature_results select 'clock_out_presence_only',
  not exists(select 1 from public.employee_work_sessions where employee_id='fa500000-0000-0000-0000-000000000011' and status='Open')
  and not exists(select 1 from public.time_entries where employee_id='fa500000-0000-0000-0000-000000000011'),
  'Clock Out closes presence and creates no payroll.';

select public.start_operational_job('fa500000-0000-0000-0000-000000000030');
select public.start_operational_job('fa500000-0000-0000-0000-000000000030');
insert into feature_results select 'start_atomic_idempotent',
  (select status='In Progress' from public.jobs where id='fa500000-0000-0000-0000-000000000030')
  and (select count(*)=1 from public.time_entries where job_id='fa500000-0000-0000-0000-000000000030' and employee_id='fa500000-0000-0000-0000-000000000011')
  and exists(select 1 from public.employee_work_sessions where employee_id='fa500000-0000-0000-0000-000000000011' and status='Open'),
  'Start begins Job, joins starter, snapshots payroll, activates presence, and retry is stable.';
do $$ begin
  begin perform public.stop_my_work(); raise exception 'Expected active Job Clock Out protection';
  exception when others then if sqlerrm not like 'End active Job % before Clock Out.%' then raise; end if; end;
end $$;
insert into feature_results values('clock_out_blocked_on_job',true,'Clock Out cannot abandon active Job payroll.');

select set_config('request.jwt.claim.sub','fa500000-0000-0000-0000-000000000002',true);
select public.start_or_clock_in_to_job('fa500000-0000-0000-0000-000000000030');
select public.start_or_clock_in_to_job('fa500000-0000-0000-0000-000000000030');
update public.time_entries set clock_in=clock_in+interval '5 minutes' where job_id='fa500000-0000-0000-0000-000000000030' and employee_id='fa500000-0000-0000-0000-000000000012';
insert into feature_results select 'join_idempotent_own_time',
  (select count(*)=1 from public.time_entries where job_id='fa500000-0000-0000-0000-000000000030' and employee_id='fa500000-0000-0000-0000-000000000012')
  and exists(select 1 from public.employee_work_sessions where employee_id='fa500000-0000-0000-0000-000000000012' and status='Open'),
  'Join starts one individual payroll entry and presence.';
do $$ begin
  begin perform public.start_or_clock_in_to_job('fa500000-0000-0000-0000-000000000031'); raise exception 'Expected multiple Job protection';
  exception when others then if sqlerrm not like 'You are already On Job%' then raise; end if; end;
end $$;
insert into feature_results values('multiple_job_blocked',true,'A technician cannot join two active Jobs.');

select set_config('request.jwt.claim.sub','fa500000-0000-0000-0000-000000000003',true);
select public.start_or_clock_in_to_job('fa500000-0000-0000-0000-000000000030');
update public.time_entries set clock_in=clock_in+interval '10 minutes' where job_id='fa500000-0000-0000-0000-000000000030' and employee_id='fa500000-0000-0000-0000-000000000013';
update public.employees set hourly_rate=99,overtime_rate=149 where id='fa500000-0000-0000-0000-000000000012';
select set_config('request.jwt.claim.sub','fa500000-0000-0000-0000-000000000001',true);
select public.complete_in_progress_job('fa500000-0000-0000-0000-000000000030');
create temporary table ended_snapshot as select id,clock_out,gross_pay from public.time_entries where job_id='fa500000-0000-0000-0000-000000000030';
select public.complete_in_progress_job('fa500000-0000-0000-0000-000000000030');
insert into feature_results select 'end_everyone_shared_time_retry',
  (select count(*)=3 and count(distinct clock_out)=1 and bool_and(status='Completed') from public.time_entries where job_id='fa500000-0000-0000-0000-000000000030')
  and not exists(select 1 from public.time_entries current join ended_snapshot prior using(id) where current.clock_out is distinct from prior.clock_out or current.gross_pay is distinct from prior.gross_pay)
  and (select count(*)=3 from public.employee_work_sessions where status='Open' and employee_id in ('fa500000-0000-0000-0000-000000000011','fa500000-0000-0000-0000-000000000012','fa500000-0000-0000-0000-000000000013')),
  'End closes all entries at one timestamp, leaves presence Active, and retry changes nothing.';
insert into feature_results select 'rate_snapshot_stable',
  (select hourly_rate_snapshot=25 from public.time_entries where job_id='fa500000-0000-0000-0000-000000000030' and employee_id='fa500000-0000-0000-0000-000000000012'),
  'Changing current employee rate does not change prior participation snapshot.';
insert into feature_results select 'different_join_times_retained',count(distinct clock_in)=3,
  'Each participant retains their own joined_at/clock_in.' from public.time_entries where job_id='fa500000-0000-0000-0000-000000000030';

select set_config('request.jwt.claim.sub','fa500000-0000-0000-0000-000000000003',true);
select public.start_or_clock_in_to_job('fa500000-0000-0000-0000-000000000032');
select set_config('request.jwt.claim.sub','fa500000-0000-0000-0000-000000000001',true);
select public.cancel_operational_job('fa500000-0000-0000-0000-000000000032','Synthetic cancellation');
insert into feature_results select 'cancellation_closes_payroll',
  not exists(select 1 from public.time_entries where job_id='fa500000-0000-0000-0000-000000000032' and status='Open')
  and exists(select 1 from public.employee_work_sessions where employee_id='fa500000-0000-0000-0000-000000000013' and status='Open')
  and (select status='Cancelled' from public.jobs where id='fa500000-0000-0000-0000-000000000032'),
  'Cancellation closes active payroll and leaves participants Active.';
insert into feature_results select 'calendar_trigger_compatible',
  exists(select 1 from pg_trigger where tgname='jobs_queue_google_calendar_sync' and tgenabled<>'D'),
  'Existing Job status Calendar queue trigger remains installed and enabled.';

do $$ begin if exists(select 1 from feature_results where not passed) then raise exception 'Presence/Job payroll regression failure'; end if; end $$;
table feature_results;
rollback;
