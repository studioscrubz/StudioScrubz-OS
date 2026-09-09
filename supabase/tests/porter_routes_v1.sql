-- Rollback-only integration suite for a DISPOSABLE database with all Porter migrations applied.
-- Not executed by this task. Never run against production.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/porter_routes_v1.sql
begin;
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.expect_failure(query text,expected text) returns void language plpgsql as $$
declare caught text;
begin begin execute query; exception when others then caught:=sqlerrm; end;
 if caught is null or position(expected in caught)=0 then raise exception 'Expected %, got %',expected,caught; end if;
end $$;
do $$
declare
 u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); inactive uuid:=gen_random_uuid();
 cl uuid:=gen_random_uuid(); prop uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid();
 v1 uuid; v2 uuid; v3 uuid; wrong_date uuid; wrong_crew uuid; r1 uuid; r2 uuid; cancelled_route uuid; extra uuid;
 ver timestamptz; stale timestamptz; role_name text; snapshot jsonb; result jsonb; body jsonb; expected integer;
begin
 insert into auth.users(id,aud,role,email,created_at,updated_at) values(u,'authenticated','authenticated',u||'@example.invalid',now(),now());
 insert into public.employees(id,employee_number,first_name,last_name,email,department,employment_status,employment_type)
 values(e,'TEST-'||e,'Porter','Route Fixture',e||'@example.invalid','Scrub Technicians','Active','Part-Time');
 insert into public.user_profiles(id,email,display_name,role,is_active,employee_id)
 values(u,u||'@example.invalid','Route Fixture','Manager',true,e)
 on conflict(id) do update set role='Manager',is_active=true,employee_id=e;
 insert into public.crews(id,crew_name,crew_lead_id,status) values(c1,'Route Fixture A',e,'Active'),(c2,'Route Fixture B',null,'Active'),(inactive,'Inactive route crew',null,'Active');
 update public.crews set archived_at=now() where id=inactive;
 insert into public.crew_members(crew_id,employee_id) values(c1,e);
 insert into public.clients(id,client_type,company_name) values(cl,'Commercial','Route Fixture');
 insert into public.properties(id,client_id,property_name,property_type,address) values(prop,cl,'Route Property','Commercial','1 Fixture Lane');
 insert into public.property_service_plans(id,client_id,property_id,name,status,start_date,frequency,service_days,assigned_crew_id)
 values(plan,cl,prop,'Route Plan','Active',current_date,'Weekly',array[1]::smallint[],c1);
 perform set_config('request.jwt.claim.sub',u::text,true);
 execute 'set local role authenticated';
 v1:=public.create_porter_visit(plan,current_date);
 v2:=public.create_porter_visit(plan,current_date);
 v3:=public.create_porter_visit(plan,current_date);
 wrong_date:=public.create_porter_visit(plan,current_date+1);
 wrong_crew:=public.create_porter_visit(plan,current_date,c2);
 perform pg_temp.expect_failure(format('select public.create_porter_route(null,%L)',c1),'Route date');
 perform pg_temp.expect_failure('select public.create_porter_route(current_date,null)','active crew');
 perform pg_temp.expect_failure(format('select public.create_porter_route(current_date,%L)',inactive),'active crew');
 perform pg_temp.expect_failure(format('select public.create_porter_route(current_date,%L,null,null,%L)',c1,jsonb_build_array(jsonb_build_object('visit_id',wrong_date))),'Visit date');
 perform pg_temp.expect_failure(format('select public.create_porter_route(current_date,%L,null,null,%L)',c1,jsonb_build_array(jsonb_build_object('visit_id',wrong_crew))),'Visit crew');
 body:=jsonb_build_array(jsonb_build_object('visit_id',v1),jsonb_build_object('visit_id',v1));
 perform pg_temp.expect_failure(format('select public.create_porter_route(current_date,%L,null,null,%L)',c1,body),'Duplicate');
 r1:=public.create_porter_route(current_date,c1,'First',null,jsonb_build_array(jsonb_build_object('visit_id',v1)));
 r2:=public.create_porter_route(current_date,c2,'Other',null,jsonb_build_array(jsonb_build_object('visit_id',wrong_crew)));
 perform pg_temp.expect_failure(format('select public.create_porter_route(current_date,%L,null,null,%L)',c1,jsonb_build_array(jsonb_build_object('visit_id',v1))),'another active route');
 select updated_at into ver from public.property_service_visits where id=v1;
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,''edit'',%L)',v1,ver,jsonb_build_object('scheduled_date',current_date+1,'assigned_crew_id',c1)),'Remove this visit');
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,''edit'',%L)',v1,ver,jsonb_build_object('scheduled_date',current_date,'assigned_crew_id',c2)),'Remove this visit');

 execute 'reset role';
 foreach role_name in array array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician','Sales'] loop
  update public.user_profiles set role=role_name where id=u;
  execute 'set local role authenticated';
  expected:=case when role_name in ('Master Admin','Administrator','Manager') then 2 when role_name='Sales' then 0 else 1 end;
  perform pg_temp.assert_true((select count(*) from public.property_service_routes where id in(r1,r2))=expected,role_name||' route RLS');
  perform pg_temp.assert_true((select count(*) from public.property_service_route_stops where route_id in(r1,r2))=expected,role_name||' stop RLS');
  perform pg_temp.assert_true((select count(*) from public.get_porter_routes() j where (j->>'id')::uuid in(r1,r2))=expected,role_name||' scoped RPC');
  if expected=2 then extra:=public.create_porter_route(current_date,c1);
  else
   perform pg_temp.expect_failure(format('select public.create_porter_route(current_date,%L)',c1),'Only management');
   perform pg_temp.expect_failure(format('select public.mutate_porter_route(%L,now(),''cancel'')',r1),'Only management');
   perform pg_temp.assert_true(not exists(select 1 from public.get_porter_routes(r2)),'unassigned UUID denied');
  end if;
  perform pg_temp.expect_failure('update public.property_service_routes set status=''Completed''','permission denied');
  perform pg_temp.expect_failure('delete from public.property_service_route_stops','permission denied');
  perform pg_temp.expect_failure(format('select public.replace_porter_route_stops(%L,''[]'')',r1),'permission denied');
  execute 'reset role';
 end loop;
 update public.user_profiles set role='Crew Lead',employee_id=null where id=u;
 execute 'set local role authenticated';
 perform pg_temp.assert_true(not exists(select 1 from public.get_porter_routes(r1)),'unlinked employee denied');
 execute 'reset role';
 update public.user_profiles set role='Manager',employee_id=e where id=u;
 execute 'set local role authenticated';

 select updated_at into ver from public.property_service_routes where id=r1; stale:=ver;
 body:=jsonb_build_object('route_name','Edited','notes','Route notes','stops',jsonb_build_array(jsonb_build_object('visit_id',v2),jsonb_build_object('visit_id',v1)));
 perform public.mutate_porter_route(r1,ver,'edit',body);
 perform pg_temp.assert_true((select array_agg(visit_id order by stop_order)=array[v2,v1] from public.property_service_route_stops where route_id=r1),'add stop and reorder');
 perform pg_temp.assert_true((select array_agg(stop_order order by stop_order)=array[1,2] from public.property_service_route_stops where route_id=r1),'contiguous stop order');
 perform pg_temp.expect_failure(format('select public.mutate_porter_route(%L,%L,''edit'',%L)',r1,stale,body),'Route changed');
 select updated_at into ver from public.property_service_routes where id=r1;
 body:=jsonb_build_object('stops',jsonb_build_array(jsonb_build_object('visit_id',v1,'id',(select id from public.property_service_route_stops where route_id=r2 limit 1))));
 perform pg_temp.expect_failure(format('select public.mutate_porter_route(%L,%L,''edit'',%L)',r1,ver,body),'cross-route');
 body:=jsonb_build_object('stops',jsonb_build_array(jsonb_build_object('visit_id',v1)));
 perform public.mutate_porter_route(r1,ver,'edit',body);
 perform pg_temp.assert_true((select count(*)=1 and min(stop_order)=1 from public.property_service_route_stops where route_id=r1),'remove compacts order');
 -- Removed Scheduled visits are eligible again.
 cancelled_route:=public.create_porter_route(current_date,c1,null,null,jsonb_build_array(jsonb_build_object('visit_id',v2)));
 select to_jsonb(v) into snapshot from public.property_service_visits v where id=v2;
 select updated_at into ver from public.property_service_routes where id=cancelled_route;
 perform public.mutate_porter_route(cancelled_route,ver,'cancel');
 perform pg_temp.assert_true((select to_jsonb(v)=snapshot from public.property_service_visits v where id=v2),'cancel does not mutate visit');
 perform pg_temp.assert_true((select count(*)=1 and bool_and(released_at is not null) from public.property_service_route_stops where route_id=cancelled_route),'cancel preserves stop history and releases claim');
 extra:=public.create_porter_route(current_date,c1,null,null,jsonb_build_array(jsonb_build_object('visit_id',v2)));
 select updated_at into ver from public.property_service_routes where id=extra;
 perform pg_temp.expect_failure(format('select public.mutate_porter_route(%L,%L,''complete'')',extra,ver),'Start the route');

 select updated_at into ver from public.property_service_routes where id=r1;
 perform public.mutate_porter_route(r1,ver,'start');
 perform pg_temp.assert_true((select status='Scheduled' from public.property_service_visits where id=v1),'route start does not start visit');
 select updated_at into ver from public.property_service_routes where id=r1;
 perform pg_temp.expect_failure(format('select public.mutate_porter_route(%L,%L,''edit'',%L)',r1,ver,body),'Planned');
 perform pg_temp.expect_failure(format('select public.mutate_porter_route(%L,%L,''complete'')',r1,ver),'every Porter Visit');
 select updated_at into stale from public.property_service_visits where id=v1;
 perform public.mutate_porter_visit(v1,stale,'start');
 perform pg_temp.expect_failure(format('select public.mutate_porter_route(%L,%L,''complete'')',r1,ver),'every Porter Visit');
 -- Empty plan snapshot needs no area/evidence work; open issues do not block either completion.
 perform public.save_porter_visit_issue(v1,null,null,'report',jsonb_build_object('category','Other','severity','High','title','Observation'));
 select updated_at into stale from public.property_service_visits where id=v1;
 perform public.mutate_porter_visit(v1,stale,'complete');
 perform public.mutate_porter_route(r1,ver,'complete');
 select updated_at into ver from public.property_service_routes where id=r1;
 perform pg_temp.expect_failure(format('select public.mutate_porter_route(%L,%L,''cancel'')',r1,ver),'read-only');
 select updated_at into ver from public.property_service_routes where id=cancelled_route;
 perform pg_temp.expect_failure(format('select public.mutate_porter_route(%L,%L,''start'')',cancelled_route,ver),'read-only');

 -- Cancelled visits also satisfy route completion.
 select updated_at into ver from public.property_service_routes where id=extra;
 perform public.mutate_porter_route(extra,ver,'start');
 select updated_at into ver from public.property_service_visits where id=v2;
 perform public.mutate_porter_visit(v2,ver,'cancel');
 select updated_at into ver from public.property_service_routes where id=extra;
 perform public.mutate_porter_route(extra,ver,'complete');

 -- In-progress route cancellation preserves the in-progress visit.
 extra:=public.create_porter_route(current_date,c1,null,null,jsonb_build_array(jsonb_build_object('visit_id',v3)));
 select updated_at into ver from public.property_service_routes where id=extra;
 perform public.mutate_porter_route(extra,ver,'start');
 select updated_at into ver from public.property_service_visits where id=v3;
 perform public.mutate_porter_visit(v3,ver,'start');
 select to_jsonb(v) into snapshot from public.property_service_visits v where id=v3;
 select updated_at into ver from public.property_service_routes where id=extra;
 perform public.mutate_porter_route(extra,ver,'cancel');
 perform pg_temp.assert_true((select to_jsonb(v)=snapshot from public.property_service_visits v where id=v3),'cancel in-progress route preserves running visit');
 perform pg_temp.expect_failure(format('select public.create_porter_route(current_date,%L,null,null,%L)',c1,jsonb_build_array(jsonb_build_object('visit_id',v3))),'Only Scheduled');
 -- A cancelled historical route never bypasses a visit's new crew authorization.
 extra:=public.create_porter_route(current_date+1,c1,null,null,jsonb_build_array(jsonb_build_object('visit_id',wrong_date)));
 select updated_at into ver from public.property_service_routes where id=extra;
 perform public.mutate_porter_route(extra,ver,'cancel');
 select updated_at into ver from public.property_service_visits where id=wrong_date;
 perform public.mutate_porter_visit(wrong_date,ver,'edit',jsonb_build_object('scheduled_date',current_date+1,'assigned_crew_id',c2));
 execute 'reset role';
 update public.user_profiles set role='Crew Lead' where id=u;
 execute 'set local role authenticated';
 select j into result from public.get_porter_routes(extra) j;
 perform pg_temp.assert_true(result->'stops'->0->'visit'='null'::jsonb,'historical route does not expose reassigned visit');
 perform set_config('request.jwt.claim.sub','',true);
 perform pg_temp.assert_true(not exists(select 1 from public.get_porter_routes()),'unauthenticated read denied');
 perform pg_temp.expect_failure(format('select public.create_porter_route(current_date,%L)',c1),'Only management');
 execute 'reset role';
end $$;
set constraints all immediate;
rollback;
