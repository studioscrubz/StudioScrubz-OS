\set ON_ERROR_STOP on
begin;
insert into public.properties(id) values('90000000-0000-0000-0000-000000000001');
insert into public.employees(id,first_name,last_name) values
 ('10000000-0000-0000-0000-000000000001','Pilot','Technician'),
 ('10000000-0000-0000-0000-000000000002','Pilot','Manager'),
 ('10000000-0000-0000-0000-000000000003','Other','Technician');
insert into public.user_profiles(id,role,is_active,employee_id) values
 ('20000000-0000-0000-0000-000000000001','Scrub Technician',true,'10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','Manager',true,'10000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000003','Scrub Technician',true,'10000000-0000-0000-0000-000000000003');
insert into public.jobs(id,job_number,status,property_id,assigned_employee_id) values
 ('40000000-0000-0000-0000-000000000001','GPS-PILOT','Crew Assigned',
  '90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
insert into public.time_entries(job_id,employee_id,status) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Open');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
do $$ declare rejected boolean:=false; begin
 begin perform public.set_jobsite_geofence('90000000-0000-0000-0000-000000000001',
   jsonb_build_object('latitude',34.1,'longitude',-118.3,'accuracy',12,'capturedAt',now()),250);
 exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Technician could configure geofence.'; end if;
end $$;

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.set_jobsite_geofence('90000000-0000-0000-0000-000000000001',
 jsonb_build_object('latitude',34.1,'longitude',-118.3,'accuracy',12,'capturedAt',now()),250);

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.verify_jobsite_arrival('40000000-0000-0000-0000-000000000001',
 jsonb_build_object('latitude',34.1001,'longitude',-118.3001,'accuracy',12,'capturedAt',now()));
do $$ begin
 if (select result from public.get_jobsite_arrival_summary('40000000-0000-0000-0000-000000000001') s,
   lateral jsonb_to_record(s) as x(result jsonb)) is null then null; end if;
 if (public.get_jobsite_arrival_summary('40000000-0000-0000-0000-000000000001')->'lastCheck'->>'result') <> 'Within Radius'
 then raise exception 'Expected within-radius arrival'; end if;
end $$;
select public.verify_jobsite_arrival('40000000-0000-0000-0000-000000000001',
 jsonb_build_object('latitude',35.1,'longitude',-118.3,'accuracy',12,'capturedAt',now()));
do $$ begin
 if (public.get_jobsite_arrival_summary('40000000-0000-0000-0000-000000000001')->'lastCheck'->>'result') <> 'Outside Radius'
 then raise exception 'Expected outside-radius arrival'; end if;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
do $$ declare rejected boolean:=false; begin
 begin perform public.verify_jobsite_arrival('40000000-0000-0000-0000-000000000001',
   jsonb_build_object('latitude',34.1,'longitude',-118.3,'accuracy',12,'capturedAt',now()));
 exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Unassigned technician verified another Job.'; end if;
end $$;

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.approve_jobsite_arrival_exception(
 '40000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000001',
 'GPS was unavailable inside the basement level; manager confirmed in person.');
reset role;
do $$ declare failed boolean:=false; begin
 if (select count(*) from public.jobsite_arrival_exceptions)<>1 then raise exception 'Exception was not stored.'; end if;
 begin update public.jobsite_arrival_exceptions set reason='changed';
 exception when others then failed:=true; end;
 if not failed then raise exception 'Exception audit was mutable.'; end if;
 if (select count(*) from public.jobsite_arrival_checks)<>1 then raise exception 'Arrival check was not idempotent.'; end if;
 if (select status from public.time_entries where job_id='40000000-0000-0000-0000-000000000001')<>'Open'
 then raise exception 'GPS changed payroll.'; end if;
 if (select status from public.jobs where id='40000000-0000-0000-0000-000000000001')<>'Crew Assigned'
 then raise exception 'GPS changed job lifecycle.'; end if;
end $$;
rollback;
