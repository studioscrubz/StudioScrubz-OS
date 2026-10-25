\set ON_ERROR_STOP on
begin;
insert into public.properties(id) values('90000000-0000-0000-0000-000000000001');
insert into public.properties(id) values('90000000-0000-0000-0000-000000000002');
insert into public.employees(id,first_name,last_name) values
 ('10000000-0000-0000-0000-000000000001','Pilot','Technician'),
 ('10000000-0000-0000-0000-000000000002','Pilot','Manager'),
 ('10000000-0000-0000-0000-000000000003','Other','Technician'),
 ('10000000-0000-0000-0000-000000000004','Assigned','Crew Lead');
insert into public.user_profiles(id,role,is_active,employee_id) values
 ('20000000-0000-0000-0000-000000000001','Scrub Technician',true,'10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','Manager',true,'10000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000003','Scrub Technician',true,'10000000-0000-0000-0000-000000000003'),
 ('20000000-0000-0000-0000-000000000004','Crew Lead',true,'10000000-0000-0000-0000-000000000004');
insert into public.jobs(id,job_number,status,property_id,assigned_employee_id) values
 ('40000000-0000-0000-0000-000000000001','GPS-PILOT','Crew Assigned',
  '90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
insert into public.time_entries(job_id,employee_id,status) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Open');
insert into public.walkthroughs(
 id,property_id,assigned_employee_id,status,walkthrough_date,walkthrough_time
) values
 ('50000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004','Scheduled',current_date,'09:00'),
 ('50000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','Scheduled',current_date,'10:00');

-- Direct table access remains unavailable even to an authenticated performer.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
do $$ declare rejected boolean:=false; begin
 begin perform 1 from public.jobsite_geofence_settings;
 exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Authenticated walkthrough performer read the protected GPS table directly.'; end if;
end $$;

-- The assigned walkthrough performer can register only the property resolved
-- from that walkthrough. No property identifier is accepted from the client.
select public.capture_walkthrough_jobsite_gps(
 '50000000-0000-0000-0000-000000000001',
 jsonb_build_object('latitude',34.2,'longitude',-118.4,'accuracy',12,'capturedAt',now()),250
);
reset role;
do $$ begin
 if not exists(
   select 1 from public.jobsite_geofence_settings
   where property_id='90000000-0000-0000-0000-000000000002'
     and latitude=34.2 and longitude=-118.4
 ) then raise exception 'Walkthrough GPS was not associated with its server-resolved property.'; end if;
end $$;

-- A different authenticated user cannot capture the assigned walkthrough.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
do $$ declare rejected boolean:=false; begin
 begin perform public.capture_walkthrough_jobsite_gps(
   '50000000-0000-0000-0000-000000000002',
   jsonb_build_object('latitude',34.3,'longitude',-118.5,'accuracy',12,'capturedAt',now()),250);
 exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Unassigned user captured walkthrough GPS.'; end if;
end $$;

-- Once present, the performer cannot overwrite the property reference.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
do $$ declare rejected boolean:=false; begin
 begin perform public.capture_walkthrough_jobsite_gps(
   '50000000-0000-0000-0000-000000000001',
   jsonb_build_object('latitude',35.2,'longitude',-117.4,'accuracy',12,'capturedAt',now()),350);
 exception when others then
   if sqlerrm like 'GPS already registered.%' then rejected:=true; else raise; end if;
 end;
 if not rejected then raise exception 'Walkthrough performer overwrote an existing GPS reference.'; end if;
end $$;
reset role;
do $$ begin
 if not exists(
   select 1 from public.jobsite_geofence_settings
   where property_id='90000000-0000-0000-0000-000000000002'
     and latitude=34.2 and longitude=-118.4 and radius_meters=250
 ) then raise exception 'Existing GPS reference changed after rejected overwrite.'; end if;
 if has_function_privilege('anon','public.get_walkthrough_jobsite_gps(uuid)','EXECUTE')
   or has_function_privilege('anon','public.capture_walkthrough_jobsite_gps(uuid,jsonb,integer)','EXECUTE')
 then raise exception 'Anonymous role retained Walkthrough GPS RPC execution.'; end if;
end $$;

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
 if (select count(*) from public.jobsite_arrival_checks)<>2 then raise exception 'Arrival attempts must be retained as separate evidence.'; end if;
 if (select count(distinct result) from public.jobsite_arrival_checks)<>2 then raise exception 'Both within and outside radius results must remain in evidence.'; end if;
 failed:=false;
 begin update public.jobsite_arrival_checks set result='Within Radius';
 exception when others then failed:=true; end;
 if not failed then raise exception 'Arrival evidence was mutable.'; end if;
 if (select status from public.time_entries where job_id='40000000-0000-0000-0000-000000000001')<>'Open'
 then raise exception 'GPS changed payroll.'; end if;
 if (select status from public.jobs where id='40000000-0000-0000-0000-000000000001')<>'Crew Assigned'
 then raise exception 'GPS changed job lifecycle.'; end if;
end $$;
rollback;
