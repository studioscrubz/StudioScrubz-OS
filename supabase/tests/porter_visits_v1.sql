-- Integration regression suite for a DISPOSABLE database with both V1 migrations applied.
-- Not run by this task. Do not execute against production. Everything rolls back.
-- Run with psql -v ON_ERROR_STOP=1 -f supabase/tests/porter_visits_v1.sql
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.expect_failure(query text, expected text) returns void language plpgsql as $$
declare caught text;
begin
 begin execute query; exception when others then caught:=sqlerrm; end;
 if caught is null or position(expected in caught)=0 then raise exception 'Expected %, got %',expected,caught; end if;
end $$;
do $$
declare
 u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid();
 client1 uuid:=gen_random_uuid(); client2 uuid:=gen_random_uuid(); prop uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid();
 v1 uuid; v2 uuid; extra uuid; ver timestamptz; current_ver timestamptz; area1 uuid; area2 uuid; other_area uuid;
 snapshots jsonb; role_name text; expected_count integer; count_rows integer;
begin
 insert into auth.users(id,aud,role,email,created_at,updated_at) values(u,'authenticated','authenticated',u||'@example.invalid',now(),now());
 insert into public.employees(id,employee_number,first_name,last_name,email,department,employment_status,employment_type)
 values(e,'TEST-'||e,'Porter','Fixture',e||'@example.invalid','Scrub Technicians','Active','Part-Time');
 insert into public.user_profiles(id,email,display_name,role,is_active,employee_id)
 values(u,u||'@example.invalid','Porter Fixture','Manager',true,e)
 on conflict(id) do update set role='Manager',is_active=true,employee_id=e;
 insert into public.crews(id,crew_name,crew_lead_id,status) values(c1,'Porter Fixture A',e,'Active'),(c2,'Porter Fixture B',null,'Active');
 insert into public.crew_members(crew_id,employee_id) values(c1,e);
 insert into public.clients(id,client_type,company_name) values(client1,'Commercial','Porter Fixture'),(client2,'Commercial','Other Fixture');
 insert into public.properties(id,client_id,property_name,property_type,address) values(prop,client1,'Porter Property','Commercial','1 Fixture Lane');
 insert into public.property_service_plans(id,client_id,property_id,name,status,start_date,frequency,service_days,assigned_crew_id)
 values(plan,client1,prop,'Snapshot Plan','Active',current_date,'Weekly',array[1]::smallint[],c1);
 insert into public.property_service_plan_areas(service_plan_id,name,description,sort_order,is_required,requires_photo,active)
 values(plan,'First','Original description',0,true,true,true),(plan,'Second',null,1,true,false,true),(plan,'Inactive',null,2,true,true,false);
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
 v1:=public.create_porter_visit(plan,current_date);
 v2:=public.create_porter_visit(plan,current_date,c2);
 select jsonb_agg(to_jsonb(a) order by sort_order) into snapshots from public.property_service_visit_areas a where visit_id=v1;
 perform pg_temp.assert_true(jsonb_array_length(snapshots)=2,'only active areas copied');
 perform pg_temp.assert_true((snapshots->0->>'name')='First' and (snapshots->0->>'requires_photo')::boolean and (snapshots->0->>'is_required')::boolean,'snapshot flags and order');
 perform pg_temp.assert_true((select client_id=client1 and property_id=prop and assigned_crew_id=c1 from public.property_service_visits where id=v1),'context and default crew derived from plan');
 execute 'reset role';
 update public.property_service_plan_areas set name='Changed',description='Changed',is_required=false,requires_photo=false,active=false where service_plan_id=plan;
 update public.property_service_plans set name='Renamed' where id=plan;
 perform pg_temp.assert_true((select jsonb_agg(to_jsonb(a) order by sort_order) from public.property_service_visit_areas a where visit_id=v1)=snapshots,'plan edits never alter snapshots');
 update public.property_service_plans set client_id=client2 where id=plan;
 execute 'set local role authenticated';
 perform pg_temp.expect_failure(format('select public.create_porter_visit(%L,current_date)',plan),'relationship');
 execute 'reset role';
 update public.property_service_plans set client_id=client1,status='Paused' where id=plan;
 execute 'set local role authenticated';
 perform pg_temp.expect_failure(format('select public.create_porter_visit(%L,current_date)',plan),'active, non-archived');
 execute 'reset role';
 update public.property_service_plans set status='Active',archived_at=null where id=plan;

 foreach role_name in array array['Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician'] loop
  update public.user_profiles set role=role_name where id=u;
  execute 'set local role authenticated';
  expected_count:=case when role_name in ('Master Admin','Administrator','Manager') then 2 when role_name='Sales' then 0 else 1 end;
  select count(*) into count_rows from public.property_service_visits where id in(v1,v2);
  perform pg_temp.assert_true(count_rows=expected_count,role_name||' visit RLS');
  select count(*) into count_rows from public.property_service_visit_areas where visit_id in(v1,v2);
  perform pg_temp.assert_true(count_rows=expected_count*2,role_name||' area RLS');
  select count(*) into count_rows from public.get_porter_visits() r where (r->>'id')::uuid in(v1,v2);
  perform pg_temp.assert_true(count_rows=expected_count,role_name||' read RPC scope');
  if expected_count=2 then extra:=public.create_porter_visit(plan,current_date);
  else
   perform pg_temp.expect_failure(format('select public.create_porter_visit(%L,current_date)',plan),'Only management');
   perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,now(),%L)',v2,'start'),'access denied');
  end if;
  perform pg_temp.expect_failure('update public.property_service_visits set status=''Completed''','permission denied');
  execute 'reset role';
 end loop;
 update public.user_profiles set role='Crew Lead',employee_id=null where id=u;
 execute 'set local role authenticated';
 perform pg_temp.assert_true(not exists(select 1 from public.property_service_visits where id=v1),'unlinked field employee denied');
 execute 'reset role';
 update public.user_profiles set employee_id=e where id=u;
 execute 'set local role authenticated';
 select updated_at into ver from public.property_service_visits where id=v1;
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,%L,%L::jsonb)',v1,ver,'edit','{}'),'Only management');
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,%L)',v1,ver,'cancel'),'Only management');
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,%L)',v1,ver,'complete'),'Start the visit');
 perform public.mutate_porter_visit(v1,ver,'start');
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,%L)',v1,ver,'start'),'Visit changed');
 select updated_at into current_ver from public.property_service_visits where id=v1;
 perform pg_temp.assert_true(current_ver>ver,'version increases');
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,%L)',v1,current_ver,'complete'),'required Pending');
 execute 'reset role';
 select id into other_area from public.property_service_visit_areas where visit_id=v2 limit 1;
 execute 'set local role authenticated';
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,%L,%L::jsonb)',v1,current_ver,'area',jsonb_build_object('area_id',other_area,'status','Completed')),'does not belong');
 select id into area1 from public.property_service_visit_areas where visit_id=v1 and sort_order=0;
 select id into area2 from public.property_service_visit_areas where visit_id=v1 and sort_order=1;
 perform public.mutate_porter_visit(v1,current_ver,'area',jsonb_build_object('area_id',area1,'status','Completed'));
 perform pg_temp.assert_true((select completed_at is not null from public.property_service_visit_areas where id=area1),'area completion timestamp');
 select updated_at into current_ver from public.property_service_visits where id=v1;
 perform public.mutate_porter_visit(v1,current_ver,'area',jsonb_build_object('area_id',area1,'status','Pending'));
 perform pg_temp.assert_true((select completed_at is null from public.property_service_visit_areas where id=area1),'Pending clears timestamp');
 select updated_at into current_ver from public.property_service_visits where id=v1;
 perform public.mutate_porter_visit(v1,current_ver,'area',jsonb_build_object('area_id',area1,'status','Completed'));
 select updated_at into current_ver from public.property_service_visits where id=v1;
 perform public.mutate_porter_visit(v1,current_ver,'area',jsonb_build_object('area_id',area2,'status','Unable to Complete','notes','Access unavailable'));
 select updated_at into current_ver from public.property_service_visits where id=v1;
 perform public.mutate_porter_visit(v1,current_ver,'complete');
 select updated_at into current_ver from public.property_service_visits where id=v1;
 perform pg_temp.assert_true((select status='Completed' and started_at is not null and completed_at is not null from public.property_service_visits where id=v1),'completion succeeds with resolved required areas');
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,%L)',v1,current_ver,'notes'),'read-only');
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,%L,%L::jsonb)',v1,current_ver,'area',jsonb_build_object('area_id',area1,'status','Pending')),'read-only');
 execute 'reset role';
 update public.user_profiles set role='Manager' where id=u;
 execute 'set local role authenticated';
 select updated_at into current_ver from public.property_service_visits where id=v2;
 perform public.mutate_porter_visit(v2,current_ver,'cancel');
 select updated_at into current_ver from public.property_service_visits where id=v2;
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,%L)',v2,current_ver,'start'),'read-only');
 execute 'reset role';
 raise notice 'Porter Visit integration assertions passed; rolling back fixtures.';
end $$;
rollback;
