\set ON_ERROR_STOP on
begin;
insert into public.employees(id,employment_status,employment_type,archived_at,first_name,last_name) values
 ('10000000-0000-0000-0000-000000000011','Active','W-2',null,'Checklist','Tester'),
 ('10000000-0000-0000-0000-000000000012','Active','W-2',null,'Other','Tester'),
 ('10000000-0000-0000-0000-000000000013','Active','1099',null,'Contractor','Tester');
insert into public.user_profiles(id,employee_id,role,is_active) values
 ('20000000-0000-0000-0000-000000000011',null,'Master Admin',true),
 ('20000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000011','Scrub Technician',true),
 ('20000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000012','Crew Lead',true),
 ('20000000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000013','Scrub Technician',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000012',true);
select public.inventory_submit_supply_checklist('30000000-0000-0000-0000-000000000011','{"trash":"restock","bulk_alcohol":"restock","vacuum":"repair","paper":"good"}');
select public.inventory_submit_supply_checklist('30000000-0000-0000-0000-000000000011','{"trash":"restock","bulk_alcohol":"restock","vacuum":"repair","paper":"good"}');
select public.inventory_submit_supply_checklist('30000000-0000-0000-0000-000000000012','{"trash":"restock"}');
do $$ begin
 if (select count(*) from public.technician_inventory_locations)<>1 or (select count(*) from public.technician_supply_checklists)<>2 or (select count(*) from public.technician_restock_requests)<>3 then raise exception 'Incorrect checklist results or duplicate request'; end if;
 if exists(select 1 from public.technician_restock_requests where not checklist_only or current_quantity is not null or requested_quantity is not null) or exists(select 1 from public.technician_inventory_stock) then raise exception 'Invented stock quantity'; end if;
 begin perform public.inventory_submit_supply_checklist(gen_random_uuid(),'{"trash":"repair"}'); raise exception 'Expected invalid equipment rejection'; exception when raise_exception then if sqlerrm='Expected invalid equipment rejection' then raise; end if; end;
 begin perform public.inventory_finish_checklist_request((select id from public.technician_restock_requests limit 1),'completed'); raise exception 'Expected manager denial'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000013',true);
do $$ begin
 if exists(select 1 from public.technician_supply_checklists) or exists(select 1 from public.technician_restock_requests) then raise exception 'Other employee checklist leaked'; end if;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000014',true);
do $$ begin
 begin perform public.inventory_submit_supply_checklist(gen_random_uuid(),'{"trash":"restock"}'); raise exception 'Expected contractor denial'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000011',true);
select public.inventory_finish_checklist_request((select id from public.technician_restock_requests where item_key='trash'),'completed');
do $$ begin
 if not exists(select 1 from public.technician_restock_requests where item_key='trash' and status='completed' and reviewed_at is not null) then raise exception 'Fulfillment not saved'; end if;
 if exists(select 1 from public.technician_inventory_stock) then raise exception 'Checklist changed ledger'; end if;
end $$;
rollback;
