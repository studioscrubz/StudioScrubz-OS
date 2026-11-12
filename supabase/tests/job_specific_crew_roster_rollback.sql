
-- Run in a transaction and ROLLBACK. Exercises production functions without retaining fixtures.
do $test$
declare
 manager_user uuid; lead uuid; tech_user uuid; tech uuid; other uuid:=gen_random_uuid();
 crew uuid; unused uuid; job_a uuid:=gen_random_uuid(); job_b uuid:=gen_random_uuid();
 admin_user uuid; admin_employee uuid; n integer; failed boolean; entry public.time_entries; label text;
begin
 select u.id,u.employee_id into manager_user,lead from public.user_profiles u join public.employees e on e.id=u.employee_id where u.is_active and u.role='Manager' and e.employment_status='Active' and e.archived_at is null limit 1;
 select u.id,u.employee_id into tech_user,tech from public.user_profiles u join public.employees e on e.id=u.employee_id where u.is_active and u.role='Scrub Technician' and e.employment_status='Active' and e.archived_at is null limit 1;
 if lead is null or tech is null then raise exception 'Required test roles unavailable'; end if;
 perform set_config('request.jwt.claim.sub',manager_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_user,'role','authenticated')::text,true);
 insert into public.employees(id,employee_number,first_name,last_name,department) values(other,'CREW-TEST-'||substr(other::text,1,8),'Roster','Fixture','Scrub Technicians');
 select id into crew from public.manage_operational_crew(null,'Crew release rollback fixture',lead,'Active',null,false,1);
 select id into unused from public.manage_operational_crew(null,'Unused rollback fixture',null,'Active',null,false,2);
 perform public.delete_operational_crew(unused);
 if exists(select 1 from public.crews where id=unused) then raise exception 'Unused crew deletion failed'; end if;
 insert into public.jobs(id,job_number,division,status,scheduled_date,start_time,estimated_duration,assigned_crew_id)
 values(job_a,'CREW-TEST-A-'||substr(job_a::text,1,8),'Residential','Crew Assigned',current_date+90,'09:00',2,crew),
 (job_b,'CREW-TEST-B-'||substr(job_b::text,1,8),'Residential','Crew Assigned',current_date+91,'09:00',2,crew);
 select u.id,u.employee_id into admin_user,admin_employee from public.user_profiles u join public.employees e on e.id=u.employee_id where u.is_active and u.role='Master Admin' and e.employment_status='Active' and e.archived_at is null limit 1;
 perform public.manage_operational_crew(crew,'Crew release rollback fixture',admin_employee,'Active',null,false,1);
 if not exists(select 1 from public.jobs where id=job_a and assigned_crew_lead_id=admin_employee) then raise exception 'Upcoming lead reassignment failed'; end if;
 perform public.manage_operational_crew(crew,'Crew release rollback fixture',lead,'Active',null,false,1);
 -- Legacy crew membership must grant neither job visibility nor payroll.
 insert into public.crew_members(crew_id,employee_id) values(crew,tech);
 perform set_config('request.jwt.claim.sub',tech_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',tech_user,'role','authenticated')::text,true);
 if public.can_access_job(job_a) or public.can_access_job(job_b) then raise exception 'Legacy crew membership authorized a job'; end if;
 failed:=false; begin perform public.set_job_crew_technicians(job_a,array[tech]); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Technician edited own roster'; end if;
 perform set_config('request.jwt.claim.sub',manager_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_user,'role','authenticated')::text,true);
 perform public.set_job_crew_technicians(job_a,array[tech]);
 failed:=false; begin perform public.set_job_crew_technicians(job_a,array[tech,other]); exception when others then failed:=true; end;
 if not failed then raise exception 'Capacity exceeded'; end if;
 failed:=false; begin perform public.delete_operational_crew(crew); exception when others then failed:=true; end;
 if not failed then raise exception 'Upcoming crew deletion allowed'; end if;
 update public.jobs set start_time='10:00' where id=job_a;
 if not exists(select 1 from public.job_assignment_events where job_id=job_a and recipient_user_id=tech_user and event_type='Changed') then raise exception 'Technician schedule notification missing'; end if;
 perform public.set_job_crew_technicians(job_a,'{}');
 if not exists(select 1 from public.job_assignment_events where job_id=job_a and recipient_user_id=tech_user and event_type='Removed') then raise exception 'Technician removal notification missing'; end if;
 perform public.set_job_crew_technicians(job_a,array[tech]);
 perform set_config('request.jwt.claim.sub',tech_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',tech_user,'role','authenticated')::text,true);
 if not public.can_access_job(job_a) or public.can_access_job(job_b) then raise exception 'Job-specific visibility failed'; end if;
 failed:=false; begin perform public.open_job_payroll_entry(job_b,tech,crew,now()); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Unassigned payroll allowed'; end if;
 -- Accept equipment through the existing assigned-lead workflow before payroll starts.
 -- Test the existing payroll core. Public start retains GPS and equipment preflight.
 perform set_config('request.jwt.claim.sub',manager_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_user,'role','authenticated')::text,true);
 perform public.set_job_equipment_responsibility(job_a,array[lead],null);
 perform public.confirm_job_equipment_responsibility(job_a);
 perform public.start_operational_job_with_presence_before_equipment(job_a,
  jsonb_build_array(jsonb_build_object('employeeId',tech,'status','Present'),jsonb_build_object('employeeId',lead,'status','Absent','reasonCode','Other','reasonDetail','Rollback fixture')));
 if not exists(select 1 from public.time_entries where job_id=job_a and employee_id=tech and status='Open') then raise exception 'Selected Present technician not clocked in'; end if;
 if exists(select 1 from public.time_entries where job_id=job_a and employee_id<>tech) then raise exception 'Unselected or absent payroll entry'; end if;
 if exists(select 1 from public.time_entries t join public.employees e on e.id=t.employee_id where t.job_id=job_a and (t.hourly_rate_snapshot<>e.hourly_rate or t.overtime_rate_snapshot<>e.hourly_rate*1.5)) then raise exception 'Payroll rate regression'; end if;
 failed:=false; begin perform public.set_job_crew_technicians(job_a,'{}'); exception when others then failed:=true; end;
 if not failed then raise exception 'Roster changed after job start'; end if;
 update public.jobs set status='Cancelled' where id=job_b;
 if not exists(select 1 from public.job_assignment_events where job_id=job_b and recipient_user_id=manager_user and event_type='Cancelled') then raise exception 'Lead cancellation notification missing'; end if;
 -- Removing a future assignment clears only that job's technicians.
 update public.jobs set status='Crew Assigned' where id=job_b;
 perform public.set_job_crew_technicians(job_b,array[other]);
 perform public.set_job_worker_assignment(job_b,'unassigned',null,null);
 if exists(select 1 from public.job_crew_technicians where job_id=job_b) then raise exception 'Stale assignment roster'; end if;
 if not exists(select 1 from public.job_crew_technicians where job_id=job_a and employee_id=tech) then raise exception 'Historical roster lost'; end if;
 -- Historical dependencies prevent deletion but permit archive/restore after all jobs resolve.
 perform public.close_job_payroll_entries(job_a,now());
 update public.jobs set status='Cancelled',operational_ended_at=now() where id=job_a;
 failed:=false; begin perform public.delete_operational_crew(crew); exception when others then failed:=true; end;
 if not failed then raise exception 'Historical crew deleted'; end if;
 perform public.manage_operational_crew(crew,'Crew release rollback fixture',lead,'Archived',null,true,1);
 perform public.manage_operational_crew(crew,'Crew release rollback fixture',lead,'Active',null,false,1);
 if not exists(select 1 from public.crews where id=crew and status='Active' and archived_at is null) then raise exception 'Crew restore failed'; end if;
 if not exists(select 1 from public.job_assignment_events where job_id=job_a and recipient_user_id=tech_user and event_type='Assigned') then raise exception 'Technician assignment notification missing'; end if;
 if not exists(select 1 from public.job_assignment_events where job_id=job_a and recipient_user_id=manager_user and event_type='Assigned') then raise exception 'Crew Lead assignment notification missing'; end if;
 set constraints all immediate;
 if has_function_privilege('authenticated','public.open_job_payroll_entry(uuid,uuid,uuid,timestamptz)','EXECUTE')
 or has_function_privilege('authenticated','public.start_operational_job_with_presence_before_equipment(uuid,jsonb)','EXECUTE') then raise exception 'Internal timekeeping helpers exposed'; end if;
 perform set_config('request.jwt.claim.sub',tech_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',tech_user,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 if exists(select 1 from public.job_assignment_events where recipient_user_id<>tech_user) then raise exception 'Assignment event recipient RLS failed'; end if;
 if exists(select 1 from public.job_crew_technicians where job_id=job_b) then raise exception 'Roster RLS failed'; end if;
 if not exists(select 1 from public.get_visible_job_roster(array[job_a]) where employee_id=tech) then raise exception 'Assigned roster RPC not visible'; end if;
 failed:=false; begin insert into public.job_crew_technicians(job_id,crew_id,employee_id,assigned_by_employee_id) values(job_b,crew,other,lead); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Direct roster writes allowed'; end if;
 execute 'reset role';
end $test$;
