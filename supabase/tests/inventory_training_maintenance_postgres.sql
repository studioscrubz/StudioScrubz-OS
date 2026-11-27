\set ON_ERROR_STOP on
-- Disposable native release fixture only. Every assertion rolls back.
begin;
insert into public.employees(id,employment_status,employment_type,first_name,last_name) values
 ('f2000000-0000-0000-0000-000000000001','Active','Part-Time','Test','Employee'),
 ('f2000000-0000-0000-0000-000000000002','Active','Part-Time','Other','Employee');
insert into public.user_profiles(id,employee_id,role,is_active) values
 ('f1000000-0000-0000-0000-000000000001',null,'Master Admin',true),
 ('f1000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000001','Scrub Technician',true),
 ('f1000000-0000-0000-0000-000000000003','f2000000-0000-0000-0000-000000000002','Scrub Technician',true);
insert into public.employee_onboarding_cases(id,employee_id) values('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000002',true);
do $$ begin if public.inventory_chemical_authorization() then raise exception 'Untrained employee authorized'; end if; end $$;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000001',true);
select public.inventory_assess_training('f3000000-0000-0000-0000-000000000001','chemical_preparation',true,true,'Observed practical assessment');
select public.inventory_assess_training('f3000000-0000-0000-0000-000000000001','chemical_safety',true,true,'Observed SDS and PPE competency');
select public.inventory_create_location('Test individual','individual','f2000000-0000-0000-0000-000000000001') as location \gset
select public.inventory_assign_kit('KIT-TEST-001','standard',:'location') as kit \gset
select public.inventory_save_asset(null,'EQP-TEST-001','vacuum',:'location','good') as asset \gset
select set_config('test.asset',:'asset',true),set_config('test.location',:'location',true);
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000003',true);
do $$ begin
 begin perform public.inventory_acknowledge_training('f3000000-0000-0000-0000-000000000001','chemical_preparation'); raise exception 'Expected unrelated training denial'; exception when insufficient_privilege then null; end;
 begin perform public.inventory_acknowledge_asset(current_setting('test.asset')::uuid); raise exception 'Expected unrelated equipment denial'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000002',true);
do $$ begin if public.inventory_chemical_authorization() then raise exception 'Missing acknowledgment authorized'; end if; end $$;
select public.inventory_acknowledge_training('f3000000-0000-0000-0000-000000000001','chemical_preparation');
select public.inventory_acknowledge_training('f3000000-0000-0000-0000-000000000001','chemical_safety');
do $$ begin if not public.inventory_chemical_authorization() then raise exception 'Assessed acknowledged employee rejected'; end if; end $$;
select public.inventory_acknowledge_kit(:'kit');
select public.inventory_acknowledge_asset(:'asset');
select public.inventory_report_equipment(:'asset','damage','Broken vacuum cord',null) as report \gset
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000001',true);
do $$ begin
 if not exists(select 1 from public.technician_equipment_assets where id=current_setting('test.asset')::uuid and condition='out_of_service') then raise exception 'Unsafe equipment remained in service'; end if;
 begin perform public.inventory_save_asset(current_setting('test.asset')::uuid,'EQP-TEST-001','vacuum',current_setting('test.location')::uuid,'good'); raise exception 'Expected unresolved maintenance gate'; exception when raise_exception then if sqlerrm='Expected unresolved maintenance gate' then raise; end if; end;
end $$;
select public.inventory_resolve_equipment(:'report','repair_authorized','Authorized cord replacement');
select public.inventory_resolve_equipment(:'report','completed','Cord replaced and electrical safety checked');
select public.inventory_save_asset(:'asset','EQP-TEST-001','vacuum',:'location','good');
select public.inventory_assess_training('f3000000-0000-0000-0000-000000000001','chemical_preparation',false,false,'Reassessment required');
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000002',true);
do $$ begin if public.inventory_chemical_authorization() then raise exception 'Failed reassessment did not revoke authorization'; end if; end $$;
reset role;
update public.employees set employment_status='Inactive' where id='f2000000-0000-0000-0000-000000000001';
do $$ begin
 if not exists(select 1 from public.technician_kit_assignments where kit_number='KIT-TEST-001' and return_required) then raise exception 'Offboarding recovery not recorded'; end if;
end $$;
rollback;
\echo 'Training competency, acknowledgment isolation, maintenance and offboarding assertions passed'
