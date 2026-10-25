\set ON_ERROR_STOP on

begin;

insert into public.employees(id,first_name,last_name) values
 ('10000000-0000-0000-0000-000000000001','Employee','One'),
 ('10000000-0000-0000-0000-000000000002','Manager','Two'),
 ('10000000-0000-0000-0000-000000000003','Employee','Three'),
 ('10000000-0000-0000-0000-000000000004','Crew','Lead');
insert into public.user_profiles(id,role,is_active,employee_id) values
 ('20000000-0000-0000-0000-000000000001','Scrub Technician',true,'10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','Manager',true,'10000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000003','Scrub Technician',true,'10000000-0000-0000-0000-000000000003'),
 ('20000000-0000-0000-0000-000000000004','Crew Lead',true,'10000000-0000-0000-0000-000000000004');
insert into public.crews(id,crew_name,crew_lead_id) values
 ('30000000-0000-0000-0000-000000000001','Test Crew','10000000-0000-0000-0000-000000000004');
insert into public.crew_members(crew_id,employee_id) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003');
insert into public.jobs(id,job_number,status) values
 ('40000000-0000-0000-0000-000000000001','JOB-INDIVIDUAL','Ready to Schedule'),
 ('40000000-0000-0000-0000-000000000002','JOB-PARTIAL','Ready to Schedule'),
 ('40000000-0000-0000-0000-000000000003','JOB-CREW','Ready to Schedule');
insert into public.job_equipment_responsibility_tasks(job_id,state) values ('40000000-0000-0000-0000-000000000001','Pending Assignment');
insert into public.time_entries(job_id,employee_id,status) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Open');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.submit_employee_time_off_request(current_date+10,current_date+10,true,null,null,'Vacation','Fixture request');

do $$ declare rejected boolean:=false; begin
  begin perform public.submit_employee_time_off_request(current_date-1,current_date-1,true,null,null,'Vacation',null);
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Past request was accepted.'; end if;
end $$;

do $$ begin
  if (select count(*) from public.employee_time_off_requests)<>1 then raise exception 'Employee does not see its request.'; end if;
end $$;

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
do $$ begin
  if (select count(*) from public.employee_time_off_requests)<>0 then raise exception 'RLS exposed another employee request.'; end if;
end $$;

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.review_employee_time_off_request((select id from public.employee_time_off_requests limit 1),'Approved','Coverage confirmed');

select public.submit_employee_time_off_request(current_date+30,current_date+30,true,null,null,'Personal','Manager request');
do $$ declare rejected boolean:=false; begin
  begin perform public.review_employee_time_off_request((select id from public.employee_time_off_requests where submitted_by=(select auth.uid()) limit 1),'Approved','Self approval');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Manager self-approval was accepted.'; end if;
end $$;

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select public.submit_employee_time_off_request(current_date+20,current_date+20,false,'13:00','15:00','Personal','Partial day');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.review_employee_time_off_request((select id from public.employee_time_off_requests where employee_id='10000000-0000-0000-0000-000000000003'),'Approved','Approved partial day');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.submit_employee_time_off_request(current_date+40,current_date+40,true,null,null,'Other','Cancellation test');
select public.cancel_employee_time_off_request((select id from public.employee_time_off_requests where employee_id='10000000-0000-0000-0000-000000000001' and start_date=current_date+40),'No longer needed');

do $$ declare rejected boolean:=false; event_id uuid; begin
  select id into event_id from public.employee_time_off_events limit 1;
  begin update public.employee_time_off_events set notes='tampered' where id=event_id;
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Audit history was mutable.'; end if;
end $$;

reset role;
do $$ begin
  if exists(select 1 from public.employee_time_off_notifications group by request_id,recipient_user_id,event_type,request_revision having count(*)>1) then
    raise exception 'Duplicate notification rows exist.';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);

do $$ declare rejected boolean:=false; begin
  begin perform public.schedule_job_with_time_off_protection(
    '40000000-0000-0000-0000-000000000001',current_date+10,'09:00',2,'individual','10000000-0000-0000-0000-000000000001',null,null);
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'Full-day conflict was not rejected.'; end if;
end $$;

select public.schedule_job_with_time_off_protection(
 '40000000-0000-0000-0000-000000000001',current_date+10,'09:00',2,'individual','10000000-0000-0000-0000-000000000001',null,'Customer emergency coverage');
do $$ begin
  if nullif(current_setting('app.time_off_override_reason',true),'') is not null then raise exception 'Override context leaked beyond its RPC.'; end if;
end $$;

select public.schedule_job_with_time_off_protection(
 '40000000-0000-0000-0000-000000000002',current_date+20,'10:00',2,'individual','10000000-0000-0000-0000-000000000003',null,null);

do $$ declare rejected boolean:=false; begin
  begin perform public.schedule_job_with_time_off_protection(
    '40000000-0000-0000-0000-000000000002',current_date+20,'14:00',1,'individual','10000000-0000-0000-0000-000000000003',null,null);
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'Partial-day overlap was not rejected.'; end if;
end $$;

do $$ declare rejected boolean:=false; begin
  begin perform public.schedule_job_with_time_off_protection(
    '40000000-0000-0000-0000-000000000003',current_date+20,'14:00',1,'crew',null,'30000000-0000-0000-0000-000000000001',null);
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'Crew-member conflict was not rejected.'; end if;
end $$;

select public.schedule_job_with_time_off_protection(
 '40000000-0000-0000-0000-000000000003',current_date+20,'14:00',1,'crew',null,'30000000-0000-0000-0000-000000000001','Approved temporary coverage');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
do $$ declare rejected boolean:=false; begin
  begin perform public.update_job_schedule_with_time_off_protection('40000000-0000-0000-0000-000000000003',current_date+20,'14:00',1,'Unauthorized override attempt');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Crew Lead override was accepted.'; end if;
end $$;

reset role;
do $$ begin
  if (select count(*) from public.employee_time_off_schedule_overrides)<>2 then raise exception 'Expected two override audit rows.'; end if;
  if exists(select 1 from public.employee_time_off_schedule_overrides where actor_user_id<>'20000000-0000-0000-0000-000000000002' or char_length(override_reason)<10) then raise exception 'Override audit identity or reason is invalid.'; end if;
  if (select state from public.job_equipment_responsibility_tasks where job_id='40000000-0000-0000-0000-000000000001')<>'Pending Assignment' then raise exception 'Equipment workflow state changed.'; end if;
  if (select status from public.time_entries where job_id='40000000-0000-0000-0000-000000000001')<>'Open' then raise exception 'Payroll/time entry state changed.'; end if;
end $$;

rollback;
