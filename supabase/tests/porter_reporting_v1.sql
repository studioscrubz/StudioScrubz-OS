-- Integration regression suite for a DISPOSABLE database with all Porter V1 migrations applied.
-- Not run by this task. Do not execute against production. Everything rolls back.
-- Run with psql -v ON_ERROR_STOP=1 -f supabase/tests/porter_reporting_v1.sql
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
 reporting_visit uuid; reporting_area uuid; visit_issue uuid; issue_version timestamptz; wrong_area uuid; photo_id uuid; photo_path text; snapshots jsonb; role_name text; expected_count integer; count_rows integer;
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
 execute 'reset role';
 insert into public.property_service_plan_areas(service_plan_id,name,sort_order,is_required,requires_photo,active)
 values(plan,'Optional photo-requested area',3,false,true,true);
 execute 'set local role authenticated';
 reporting_visit:=public.create_porter_visit(plan,current_date);
 select id into reporting_area from public.property_service_visit_areas where visit_id=reporting_visit and is_required and requires_photo limit 1;
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
 -- Photo reporting now enforces the original snapshot's requires_photo flag.
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,%L)',v1,current_ver,'complete'),'required photo evidence');
 photo_path:='porter-visits/'||v1||'/'||gen_random_uuid()||'.jpg';
 execute 'reset role';
 -- Synthetic Storage metadata: this suite does not upload real bytes or test Storage HTTP.
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('operational-photos',photo_path,u::text,'{"mimetype":"image/jpeg","size":1024}');
 execute 'set local role authenticated';
 perform public.add_porter_visit_photo(v1,area1,null,photo_path,'fixture.jpg','Regression evidence');
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

 -- Issue and photo security/lifecycle tests on an independent snapshotted visit.
 execute 'set local role authenticated';
 select updated_at into current_ver from public.property_service_visits where id=reporting_visit;
 perform pg_temp.expect_failure(format('select public.save_porter_visit_issue(%L,null,null,%L,%L::jsonb)',reporting_visit,'report',jsonb_build_object('title','Observation','category','Other','severity','Low')),'In Progress');
 perform public.mutate_porter_visit(reporting_visit,current_ver,'start');
 visit_issue:=public.save_porter_visit_issue(reporting_visit,null,null,'report',jsonb_build_object('visit_area_id',reporting_area,'title','Visual observation','category','Maintenance','severity','High','description','Needs management follow-up'));
 select id into wrong_area from public.property_service_visit_areas where visit_id=v2 limit 1;
 perform pg_temp.expect_failure(format('select public.save_porter_visit_issue(%L,null,null,%L,%L::jsonb)',reporting_visit,'report',jsonb_build_object('visit_area_id',wrong_area,'title','Wrong','category','Other','severity','Low')),'Area does not belong');
 execute 'reset role';
 foreach role_name in array array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician','Sales'] loop
  update public.user_profiles set role=role_name where id=u;
  photo_path:='porter-visits/'||reporting_visit||'/'||gen_random_uuid()||'.jpg';
  insert into storage.objects(bucket_id,name,owner_id,metadata) values('operational-photos',photo_path,u::text,'{"mimetype":"image/jpeg","size":1024}');
  execute 'set local role authenticated';
  perform pg_temp.assert_true(public.can_access_porter_photo_path(photo_path,true)=(role_name<>'Sales'),role_name||' upload path authorization');
  perform pg_temp.assert_true((select count(*)=case when role_name='Sales' then 0 else 1 end from public.property_service_visit_issues where id=visit_issue),role_name||' issue RLS');
  if role_name='Sales' then
   perform pg_temp.expect_failure(format('select public.add_porter_visit_photo(%L,%L,%L,%L,%L,null)',reporting_visit,reporting_area,visit_issue,photo_path,'fixture.jpg'),'access denied');
   perform pg_temp.expect_failure(format('select public.save_porter_visit_issue(%L,null,null,%L,%L::jsonb)',reporting_visit,'report','{}'),'access denied');
  else
   perform pg_temp.expect_failure(format('select public.add_porter_visit_photo(%L,%L,null,%L,%L,null)',reporting_visit,wrong_area,photo_path,'fixture.jpg'),'Area does not belong');
   perform pg_temp.expect_failure(format('select public.add_porter_visit_photo(%L,null,%L,%L,%L,null)',reporting_visit,visit_issue,photo_path,'fixture.jpg'),'Issue/area');
   photo_id:=public.add_porter_visit_photo(reporting_visit,reporting_area,visit_issue,photo_path,'fixture.jpg','Area evidence');
   perform pg_temp.assert_true(not public.can_cleanup_porter_photo(photo_path),'registered evidence cannot be deleted');
   if role_name in ('Crew Lead','Scrub Technician') then
    perform pg_temp.assert_true(not public.can_access_porter_photo_path('porter-visits/'||v2||'/'||gen_random_uuid()||'.jpg',false),'unassigned photo access denied');
    perform public.save_porter_visit_issue(reporting_visit,null,null,'report',jsonb_build_object('title','Field observation','category','Other','severity','Low'));
    perform pg_temp.expect_failure(format('select public.save_porter_visit_issue(%L,null,null,%L,%L::jsonb)',v2,'report','{}'),'access denied');
    perform pg_temp.expect_failure(format('select public.add_porter_visit_photo(%L,null,null,%L,%L,null)',reporting_visit,'porter-visits/'||v2||'/'||gen_random_uuid()||'.jpg','wrong.jpg'),'Invalid Porter photo path');
    select updated_at into issue_version from public.property_service_visit_issues where id=visit_issue;
    perform pg_temp.expect_failure(format('select public.save_porter_visit_issue(%L,%L,%L,%L,%L::jsonb)',reporting_visit,visit_issue,issue_version,'resolve','{}'),'Only management');
    execute 'reset role';
    update public.property_service_visit_issues set reported_by=null where id=visit_issue;
    execute 'set local role authenticated';
    perform pg_temp.expect_failure(format('select public.save_porter_visit_issue(%L,%L,%L,%L,%L::jsonb)',reporting_visit,visit_issue,issue_version,'edit','{}'),'Only the reporter or management');
    execute 'reset role';
    update public.property_service_visit_issues set reported_by=u where id=visit_issue;
    execute 'set local role authenticated';
    perform public.save_porter_visit_issue(reporting_visit,visit_issue,issue_version,'edit',jsonb_build_object('category','Safety','severity','High','title','Updated observation','description','Operational note'));
    perform pg_temp.expect_failure(format('select public.save_porter_visit_issue(%L,%L,%L,%L,%L::jsonb)',reporting_visit,visit_issue,issue_version,'edit','{}'),'Issue changed');
   end if;
  end if;
  execute 'reset role';
 end loop;
 update public.user_profiles set role='Crew Lead' where id=u;
 -- A visit-level photo is valid, but cannot satisfy an area's photo requirement.
 photo_path:='porter-visits/'||reporting_visit||'/'||gen_random_uuid()||'.jpg';
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('operational-photos',photo_path,u::text,'{"mimetype":"image/jpeg","size":1024}');
 execute 'set local role authenticated';
 perform public.add_porter_visit_photo(reporting_visit,null,null,photo_path,'visit.jpg',null);
 execute 'reset role';
 -- Simulate an archived attachment to verify only active evidence counts.
 update public.property_service_visit_photos set archived_at=now() where visit_id=reporting_visit and visit_area_id=reporting_area;
 execute 'set local role authenticated';
 for area1 in select id from public.property_service_visit_areas where visit_id=reporting_visit and is_required loop
  select updated_at into current_ver from public.property_service_visits where id=reporting_visit;
  perform public.mutate_porter_visit(reporting_visit,current_ver,'area',jsonb_build_object('area_id',area1,'status','Unable to Complete','notes','Access unavailable'));
 end loop;
 select updated_at into current_ver from public.property_service_visits where id=reporting_visit;
 perform pg_temp.expect_failure(format('select public.mutate_porter_visit(%L,%L,%L)',reporting_visit,current_ver,'complete'),'required photo evidence');
 execute 'reset role';
 photo_path:='porter-visits/'||reporting_visit||'/'||gen_random_uuid()||'.jpg';
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('operational-photos',photo_path,u::text,'{"mimetype":"image/jpeg","size":1024}');
 execute 'set local role authenticated';
 perform public.add_porter_visit_photo(reporting_visit,reporting_area,visit_issue,photo_path,'evidence.jpg',null);
 select updated_at into current_ver from public.property_service_visits where id=reporting_visit;
 perform pg_temp.assert_true(exists(select 1 from public.property_service_visit_areas a where a.visit_id=reporting_visit and not a.is_required and a.requires_photo and a.status='Pending'
  and not exists(select 1 from public.property_service_visit_photos p where p.visit_area_id=a.id and p.archived_at is null)), 'optional photo area remains Pending without evidence');
 perform public.mutate_porter_visit(reporting_visit,current_ver,'complete');
 perform pg_temp.assert_true((select status='Completed' from public.property_service_visits where id=reporting_visit),'optional photo-requested areas do not block completion');
 perform pg_temp.assert_true((select status='Open' from public.property_service_visit_issues where id=visit_issue),'Open issues do not block completion');
 perform pg_temp.expect_failure(format('select public.add_porter_visit_photo(%L,null,null,%L,%L,null)',reporting_visit,photo_path,'after.jpg'),'Historical visits');
 select updated_at into issue_version from public.property_service_visit_issues where id=visit_issue;
 perform pg_temp.expect_failure(format('select public.save_porter_visit_issue(%L,%L,%L,%L,%L::jsonb)',reporting_visit,visit_issue,issue_version,'edit','{}'),'In Progress');
 execute 'reset role';
 update public.user_profiles set role='Manager' where id=u;
 execute 'set local role authenticated';
 perform pg_temp.expect_failure(format('select public.add_porter_visit_photo(%L,null,null,%L,%L,null)',v2,photo_path,'cancelled.jpg'),'Historical visits');
 perform public.save_porter_visit_issue(reporting_visit,visit_issue,issue_version,'acknowledge',jsonb_build_object('resolution_notes','Reviewing observation'));
 select updated_at into issue_version from public.property_service_visit_issues where id=visit_issue;
 perform public.save_porter_visit_issue(reporting_visit,visit_issue,issue_version,'resolve',jsonb_build_object('resolution_notes','Property management notified internally'));
 perform pg_temp.assert_true((select status='Resolved' and resolved_at is not null and resolution_notes='Property management notified internally' from public.property_service_visit_issues where id=visit_issue),'management resolves after completion');
 perform pg_temp.expect_failure('delete from public.property_service_visit_issues','permission denied');
 execute 'reset role';
 raise notice 'Porter issue/photo integration assertions passed; rolling back fixtures.';
end $$;
rollback;
