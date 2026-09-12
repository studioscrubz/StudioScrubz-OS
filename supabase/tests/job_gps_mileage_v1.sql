-- Rollback-only. Run only on a disposable test DB with the migration applied.
-- Not executed by this implementation; no Docker/local Supabase required.
\set ON_ERROR_STOP on
begin;
create function pg_temp.check_gps(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.gps_failure(query text,expected text) returns void language plpgsql as $$
declare caught text;
begin begin execute query; exception when others then caught:=sqlerrm; end;
if caught is null or position(expected in caught)=0 then raise exception 'Expected %, got %',expected,caught; end if; end $$;
create function pg_temp.fail_gps_insert() returns trigger language plpgsql as $$
begin if current_setting('gps.test_fail',true)='yes' and new.mileage_number like 'GPS-%' then raise exception 'Simulated mileage save failure'; end if; return new; end $$;
create trigger test_gps_failure before insert on public.mileage_entries for each row execute function pg_temp.fail_gps_insert();
do $$
declare u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); other_e uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
  client uuid:=gen_random_uuid(); j uuid:=gen_random_uuid(); j2 uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); bad_v uuid:=gen_random_uuid();
  pos jsonb; arrival jsonb; result jsonb; t public.job_mileage_trips; again public.job_mileage_trips; cancelled public.job_mileage_trips;
  r text; count_before integer;
begin
  insert into auth.users(id,aud,role,email,created_at,updated_at) values(u,'authenticated','authenticated',u||'@gps.invalid',now(),now());
  insert into public.employees(id,employee_number,first_name,last_name,email,department,employment_status,employment_type)
    values(e,'GPS-'||e,'GPS','Tester',e||'@gps.invalid','Scrub Technicians','Active','Part-Time'),
      (other_e,'GPS-'||other_e,'Other','Tester',other_e||'@gps.invalid','Scrub Technicians','Active','Part-Time');
  insert into public.user_profiles(id,email,display_name,role,is_active,employee_id) values(u,u||'@gps.invalid','GPS','Scrub Technician',true,e)
    on conflict(id) do update set role='Scrub Technician',is_active=true,employee_id=e;
  insert into public.crews(id,crew_name,status) values(c,'GPS fixture','Active');
  insert into public.crew_members(crew_id,employee_id) values(c,e);
  insert into public.clients(id,client_type,first_name,last_name,phone) values(client,'Residential','GPS','Client','8185550100');
  insert into public.jobs(id,job_number,division,status,assigned_crew_id,assigned_team,client_id,scheduled_date,start_time)
    values(j,'GPS-'||j,'Residential','Crew Assigned',c,'[]',client,current_date,'09:00'),
      (j2,'GPS-'||j2,'Residential','Crew Assigned',c,'[]',client,current_date,'10:00');
  insert into public.vehicles(id,vehicle_number,make,model,status,assigned_employee_id)
    values(v,'GPS-'||v,'Test','Car','Active',e),(bad_v,'GPS-'||bad_v,'Other','Car','Active',other_e);
  insert into public.business_settings(id) values('00000000-0000-0000-0000-000000000019') on conflict do nothing;
  update public.business_settings set mileage_rate=null;
  pos:=jsonb_build_object('latitude',34,'longitude',-118,'accuracy',10,'capturedAt',clock_timestamp());
  arrival:=pos||jsonb_build_object('latitude',35);
  perform set_config('request.jwt.claim.sub',u::text,true);
  execute 'set local role authenticated';
  perform pg_temp.gps_failure(format('select public.start_job_gps_trip(%L,%L,%L)',j,bad_v,pos),'assigned');
  perform pg_temp.gps_failure(format('select public.start_job_gps_trip(%L,%L,%L)',j,v,pos||'{"accuracy":101}'::jsonb),'100 meters');
  result:=public.start_job_gps_trip(j,v,pos);
  t:=jsonb_populate_record(null::public.job_mileage_trips,result->'trip');
  perform pg_temp.check_gps((result->>'initiated')::boolean,'existing On My Way claimed once');
  result:=public.start_job_gps_trip(j,v,pos);
  perform pg_temp.check_gps((result->'trip'->>'id')::uuid=t.id and not (result->>'initiated')::boolean,'start idempotent');
  perform pg_temp.gps_failure(format('select public.start_job_gps_trip(%L,%L,%L)',j2,v,pos),'Another GPS trip');
  perform pg_temp.gps_failure('select public.set_company_mileage_rate(0.5)','access denied');
  perform pg_temp.check_gps(not has_table_privilege('authenticated','public.job_mileage_trips','INSERT'),'no direct writes');
  perform set_config('gps.test_fail','yes',true);
  perform pg_temp.gps_failure(format('select public.finish_job_gps_trip(%L,%L)',t.id,arrival),'Simulated');
  perform pg_temp.check_gps((select status='Active' and mileage_entry_id is null from public.job_mileage_trips where id=t.id),'failed arrival rolls back');
  perform set_config('gps.test_fail','no',true);
  t:=public.finish_job_gps_trip(t.id,arrival);
  again:=public.finish_job_gps_trip(t.id,'{}');
  perform pg_temp.check_gps(t.mileage_entry_id=again.mileage_entry_id,'arrival idempotent even on stale retry');
  perform pg_temp.check_gps(abs(t.estimated_miles-69.09)<0.02,'known one degree straight-line distance');
  perform pg_temp.check_gps(t.mileage_rate_snapshot is null,'unconfigured rate supported');
  perform pg_temp.check_gps((select count(*)=1 and max(deductible_amount)=0 from public.get_job_gps_mileage(j)),'self-safe display and null-rate deduction');
  perform pg_temp.gps_failure(format('select public.cancel_job_gps_trip(%L)',t.id),'Completed');
  execute 'reset role';
  perform pg_temp.check_gps((select status='Crew Assigned' from public.jobs where id=j),'no Job transition');
  perform pg_temp.check_gps(not exists(select 1 from public.time_entries where job_id=j),'no payroll side effect');
  foreach r in array array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician','Sales'] loop
    update public.user_profiles set role=r where id=u;
    execute 'set local role authenticated';
    perform pg_temp.check_gps((select count(*) from public.get_job_gps_trips(j))=case when r='Sales' then 0 else 1 end,r||' scoped trip read');
    if r in ('Master Admin','Administrator','Manager') then perform public.set_company_mileage_rate(0.5);
    else perform pg_temp.gps_failure('select public.set_company_mileage_rate(0.5)','access denied'); end if;
    if r='Sales' then perform pg_temp.gps_failure(format('select public.start_job_gps_trip(%L,%L,%L)',j2,v,pos),'access denied'); end if;
    execute 'reset role';
  end loop;
  update public.user_profiles set role='Crew Lead' where id=u;
  delete from public.crew_members where crew_id=c and employee_id=e;
  execute 'set local role authenticated';
  perform pg_temp.check_gps((select count(*)=0 from public.get_job_gps_trips(j)),'unassigned denied');
  perform pg_temp.gps_failure(format('select public.start_job_gps_trip(%L,%L,%L)',j2,v,pos),'access denied');
  execute 'reset role';
  insert into public.crew_members(crew_id,employee_id) values(c,e);
  execute 'set local role authenticated';
  result:=public.start_job_gps_trip(j2,v,pos); cancelled:=jsonb_populate_record(null::public.job_mileage_trips,result->'trip');
  cancelled:=public.cancel_job_gps_trip(cancelled.id);
  perform pg_temp.check_gps(cancelled.mileage_entry_id is null and cancelled.status='Cancelled','cancel creates no mileage');
  perform pg_temp.gps_failure(format('select public.finish_job_gps_trip(%L,%L)',cancelled.id,arrival),'Cancelled');
  result:=public.start_job_gps_trip(j2,v,pos); again:=jsonb_populate_record(null::public.job_mileage_trips,result->'trip');
  again:=public.finish_job_gps_trip(again.id,arrival);
  perform pg_temp.check_gps(again.mileage_rate_snapshot=0.5,'configured rate snapshotted');
  execute 'reset role';
  update public.business_settings set mileage_rate=1;
  perform pg_temp.check_gps((select mileage_rate=0.5 from public.mileage_entries where id=again.mileage_entry_id),'historical rate unchanged');
  perform pg_temp.check_gps((select count(*)=1 from public.mileage_entries where id=t.mileage_entry_id),'one entry for repeated finish');
  insert into public.crew_members(crew_id,employee_id) values(c,other_e);
  update public.user_profiles set employee_id=other_e where id=u;
  execute 'set local role authenticated';
  perform pg_temp.check_gps((select count(*)=0 from public.get_job_gps_trips(j)),'same crew cannot read another employee GPS trip');
  perform pg_temp.check_gps((select count(*)=0 from public.get_job_gps_mileage(j)),'same crew cannot read another employee GPS mileage');
  perform pg_temp.gps_failure(format('select public.finish_job_gps_trip(%L,%L)',t.id,arrival),'access denied');
  execute 'reset role';
  update public.user_profiles set role='Manager' where id=u;
  execute 'set local role authenticated';
  perform pg_temp.check_gps((select count(*)=1 from public.get_job_gps_trips(j)),'management can view company trip');
  perform pg_temp.gps_failure(format('select public.finish_job_gps_trip(%L,%L)',t.id,arrival),'access denied');
  execute 'reset role';
end $$;
rollback;
