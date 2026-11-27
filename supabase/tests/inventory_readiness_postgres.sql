-- Run ONLY in a disposable database restored from the production schema, without production data.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('e1000000-0000-0000-0000-000000000001','authenticated','authenticated','inventory-solo@example.invalid',now(),now()),
 ('e1000000-0000-0000-0000-000000000002','authenticated','authenticated','inventory-lead@example.invalid',now(),now());
insert into public.employees(id,employee_number,first_name,last_name,email,department,employment_status,employment_type) values
 ('e2000000-0000-0000-0000-000000000001','INV-TEST-001','Inventory','Solo','inventory-solo@example.invalid','Scrub Technicians','Active','Part-Time'),
 ('e2000000-0000-0000-0000-000000000002','INV-TEST-002','Inventory','Lead','inventory-lead@example.invalid','Scrub Technicians','Active','Part-Time');
insert into public.employee_screening_legacy_exemptions(employee_id) values('e2000000-0000-0000-0000-000000000001'),('e2000000-0000-0000-0000-000000000002');
insert into public.user_profiles(id,email,display_name,role,is_active,employee_id) values
 ('e1000000-0000-0000-0000-000000000001','inventory-solo@example.invalid','Inventory Solo','Scrub Technician',true,'e2000000-0000-0000-0000-000000000001'),
 ('e1000000-0000-0000-0000-000000000002','inventory-lead@example.invalid','Inventory Lead','Crew Lead',true,'e2000000-0000-0000-0000-000000000002');
insert into public.crews(id,crew_name,crew_lead_id,status) values('e3000000-0000-0000-0000-000000000001','Inventory Test Crew','e2000000-0000-0000-0000-000000000002','Active');
insert into public.jobs(id,job_number,division,status,service_name,assigned_employee_id,assigned_employee_name) values
 ('e4000000-0000-0000-0000-000000000001','INV-TEST-SOLO','Residential','Crew Assigned','Standard Cleaning','e2000000-0000-0000-0000-000000000001','Inventory Solo');
insert into public.jobs(id,job_number,division,status,service_name,assigned_crew_id,assigned_crew_lead_id) values
 ('e4000000-0000-0000-0000-000000000002','INV-TEST-CREW','Residential','Crew Assigned','Deep Cleaning','e3000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare requirements jsonb; results jsonb; begin
 requirements:=public.inventory_job_requirements('e4000000-0000-0000-0000-000000000001');
 if not exists(select 1 from jsonb_array_elements(requirements) x where x->>'key'='vacuum') then raise exception 'Standard kit missing vacuum'; end if;
 if exists(select 1 from jsonb_array_elements(requirements) x where x->>'key'='scraper') then raise exception 'Standard kit incorrectly requires deep supplies'; end if;
 select jsonb_agg(jsonb_build_object('key',r->>'key','status','checked','quantity',(r->>'minimum')::numeric,'notes','')) into results from jsonb_array_elements(requirements) r;
 begin perform public.inventory_submit_inspection(gen_random_uuid(),'e4000000-0000-0000-0000-000000000001',requirements,results); raise exception 'Expected paid time gate'; exception when raise_exception then if sqlerrm='Expected paid time gate' then raise; end if; end;
 begin perform public.inventory_job_requirements('e4000000-0000-0000-0000-000000000002'); raise exception 'Expected crew authorization rejection'; exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.employee_work_sessions(employee_id) values('e2000000-0000-0000-0000-000000000001'),('e2000000-0000-0000-0000-000000000002');
set local role authenticated;
select public.inventory_begin_preparation('e4000000-0000-0000-0000-000000000001');
do $$ declare requirements jsonb; results jsonb; begin
 requirements:=public.inventory_job_requirements('e4000000-0000-0000-0000-000000000001');
 select jsonb_agg(jsonb_build_object('key',r->>'key','status','checked','quantity',(r->>'minimum')::numeric,'notes','')) into results from jsonb_array_elements(requirements) r;
 if not public.inventory_submit_inspection('e5000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',requirements,results) then raise exception 'Safe solo inspection rejected'; end if;
 perform public.confirm_job_equipment_responsibility('e4000000-0000-0000-0000-000000000001');
 begin perform public.start_operational_job('e4000000-0000-0000-0000-000000000001'); raise exception 'Expected preserved GPS gate'; exception when raise_exception then if sqlerrm='Expected preserved GPS gate' then raise; end if; end;
 results:=jsonb_set(results,'{0,status}','"Not Needed"');
 begin perform public.inventory_submit_inspection(gen_random_uuid(),'e4000000-0000-0000-0000-000000000001',requirements,results); raise exception 'Expected mandatory rejection'; exception when raise_exception then if sqlerrm='Expected mandatory rejection' then raise; end if; end;
 results:=jsonb_set(jsonb_set(results,'{0,status}','"damaged"'),'{0,notes}','"Unsafe equipment reported"');
 if public.inventory_submit_inspection(gen_random_uuid(),'e4000000-0000-0000-0000-000000000001',requirements,results) then raise exception 'Damaged inspection approved'; end if;
 begin perform public.confirm_job_equipment_responsibility('e4000000-0000-0000-0000-000000000001'); raise exception 'Expected damaged readiness rejection'; exception when raise_exception then if sqlerrm='Expected damaged readiness rejection' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000002',true);
select public.inventory_begin_preparation('e4000000-0000-0000-0000-000000000002');
do $$ declare requirements jsonb; results jsonb; begin
 requirements:=public.inventory_job_requirements('e4000000-0000-0000-0000-000000000002');
 if not exists(select 1 from jsonb_array_elements(requirements) x where x->>'key'='scraper') then raise exception 'Deep checklist missing scraper'; end if;
 perform public.set_job_equipment_responsibility('e4000000-0000-0000-0000-000000000002',array['e2000000-0000-0000-0000-000000000002']::uuid[],'Test crew custody');
 select jsonb_agg(jsonb_build_object('key',r->>'key','status','checked','quantity',(r->>'minimum')::numeric,'notes','')) into results from jsonb_array_elements(requirements) r;
 if not public.inventory_submit_inspection(gen_random_uuid(),'e4000000-0000-0000-0000-000000000002',requirements,results) then raise exception 'Safe crew inspection rejected'; end if;
 perform public.confirm_job_equipment_responsibility('e4000000-0000-0000-0000-000000000002');
end $$;
reset role;
rollback;
\echo 'Readiness, paid preparation, solo/crew authorization, mandatory items and GPS gate assertions passed'
