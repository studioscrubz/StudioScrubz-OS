\set ON_ERROR_STOP on
begin;
do $$ begin
  assert (select responsible_employee_id='00000000-0000-0000-0000-000000000001' from public.job_equipment_responsibility_tasks where job_id='00000000-0000-0000-0000-000000000004'),'Safe backfill';
  assert (select count(*)=2 from public.job_equipment_responsibility_events where reason like 'RESOLUTION REQUIRED:%'),'Unsafe backfill flagged';
  assert (select count(*)=3 from public.job_equipment_assignments where released_at is null and employee_id='00000000-0000-0000-0000-000000000002'),'Unsafe and historical assignments preserved';
  assert (select status='Cancelled' and mileage_entry_id is null from public.job_mileage_trips where job_id='00000000-0000-0000-0000-000000000007'),'Existing stale GPS cleanup';
  assert not has_function_privilege('authenticated','public.start_operational_job_before_equipment(uuid)','execute'),'Internal start is not an API';
  assert not has_function_privilege('authenticated','private.reconcile_job_equipment_responsibility_task(uuid,uuid,uuid)','execute'),'Reconciliation is private';
end $$;
create function pg_temp.expect_error(sql text,pattern text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlerrm not ilike '%'||pattern||'%' then raise; end if; return;
  end;
  raise exception 'Expected rejection: %',sql;
end $$;
do $$
declare lead uuid:=gen_random_uuid(); member uuid:=gen_random_uuid(); admin uuid:=gen_random_uuid();
  u uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); crew uuid:=gen_random_uuid();
  job uuid:=gen_random_uuid(); next_job uuid:=gen_random_uuid(); vehicle uuid:=gen_random_uuid(); trip uuid;
  prior jsonb; done uuid; old_assignment uuid; cl uuid; historical uuid:=gen_random_uuid(); hist_task jsonb;
begin
  insert into public.employees(id) values(lead),(member),(admin);
  insert into auth.users values(u),(m),(a);
  insert into public.user_profiles values(u,lead,'Master Admin'),(m,member,'Scrub Technician'),(a,admin,'Master Admin');
  insert into public.crews(id,crew_lead_id) values(crew,lead);
  insert into public.jobs(id,assigned_crew_id) values(job,crew),(next_job,crew);
  assert (select responsible_employee_id=lead from public.job_equipment_responsibility_tasks where job_id=job),'Lead auto assignment';
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform pg_temp.expect_error(format('select public.set_job_equipment_responsibility(%L,array[%L::uuid],null)',job,admin),'Crew Lead');
  perform pg_temp.expect_error(format('select public.confirm_job_equipment_responsibility(%L)',job),'Crew Lead');
  perform set_config('request.jwt.claim.sub',m::text,true);
  perform pg_temp.expect_error(format('select public.set_job_equipment_responsibility(%L,array[%L::uuid],null)',job,member),'Crew Lead');
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.expect_error(format('select public.confirm_job_equipment_responsibility(%L)',job),'Crew Lead');
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform pg_temp.expect_error(format('select public.set_job_equipment_responsibility(%L,array[%L::uuid],null)',job,member),'Crew Lead');
  perform public.set_job_equipment_responsibility(job,array[lead],null);
  perform set_config('test.gps','verified',true);
  perform pg_temp.expect_error(format('select public.start_operational_job(%L)',job),'confirm');
  perform public.confirm_job_equipment_responsibility(job);
  perform public.start_operational_job(job);
  assert (select status='In Progress' from public.jobs where id=job),'Confirmed lead start';
  insert into public.vehicles(id,assigned_crew_id) values(vehicle,crew);
  perform public.start_job_gps_trip(job,vehicle,'{"latitude":34,"longitude":-118,"accuracy":5}');
  select id into trip from public.job_mileage_trips where job_id=job;
  update public.jobs set status='Completed' where id=job;
  assert (select status='Cancelled' and mileage_entry_id is null and start_latitude=34 from public.job_mileage_trips where id=trip),'Terminal cancellation without fabricated arrival/mileage';
  select to_jsonb(t) into prior from public.job_mileage_trips t where id=trip;
  perform public.start_job_gps_trip(next_job,vehicle,'{"latitude":34,"longitude":-118,"accuracy":5}');
  update public.jobs set status='Cancelled' where id=next_job;
  assert not exists(select 1 from public.job_mileage_trips where user_id=u and status='Active'),'Cancelled closes trip';
  update public.jobs set status='Archived' where id=job;
  assert (select to_jsonb(t)=prior from public.job_mileage_trips t where id=trip),'Cancelled history unchanged';
  update public.jobs set status='Crew Assigned' where id=next_job;
  perform public.start_job_gps_trip(next_job,vehicle,'{"latitude":34,"longitude":-118,"accuracy":5}');
  update public.jobs set archived_at=now() where id=next_job;
  assert not exists(select 1 from public.job_mileage_trips where user_id=u and status='Active'),'Archive timestamp closes trip';
  insert into public.job_mileage_trips(job_id,user_id,status,ended_at,mileage_entry_id) values(job,u,'Completed',now(),gen_random_uuid()) returning id into done;
  select to_jsonb(t) into prior from public.job_mileage_trips t where id=done;
  update public.jobs set status='Completed' where id=job;
  assert (select to_jsonb(t)=prior from public.job_mileage_trips t where id=done),'Completed trip unchanged';
  insert into public.jobs(id,assigned_crew_id) values(historical,crew);
  update public.jobs set status='Completed' where id=historical;
  select to_jsonb(t) into hist_task from public.job_equipment_responsibility_tasks t where job_id=historical;
  update public.jobs set archived_at=null,status='Crew Assigned' where id=next_job;
  select id into old_assignment from public.job_equipment_assignments where job_id=next_job and released_at is null;
  insert into public.job_equipment_clearances(assignment_id,job_id,status,checkpoint) values(old_assignment,next_job,'Pending','End Job') returning id into cl;
  perform pg_temp.expect_error(format('update public.crews set crew_lead_id=%L where id=%L',member,crew),'clearance');
  assert (select crew_lead_id=lead from public.crews where id=crew),'Unsafe reassignment rolled back';
  update public.job_equipment_clearances set status='Cleared' where id=cl;
  update public.crews set crew_lead_id=member where id=crew;
  assert (select responsible_employee_id=member from public.job_equipment_responsibility_tasks where job_id=next_job),'Future responsibility changes';
  assert (select to_jsonb(t)=hist_task from public.job_equipment_responsibility_tasks t where job_id=historical),'Historical custody unchanged';
  assert exists(select 1 from public.job_equipment_assignment_audit where assignment_id=old_assignment and action='Released'),'Release audited';
  assert (select equipment_responsibility_confirmed_at is null from public.jobs where id=next_job),'New lead must confirm';
end $$;
rollback;
