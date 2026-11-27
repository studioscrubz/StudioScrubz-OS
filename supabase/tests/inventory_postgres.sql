\set ON_ERROR_STOP on
begin;
insert into public.employees(id,employment_status,employment_type,archived_at) values
 ('10000000-0000-0000-0000-000000000001','Active','W-2',null),
 ('10000000-0000-0000-0000-000000000002','Active','W-2',null),
 ('10000000-0000-0000-0000-000000000003','Active','1099',null);
insert into public.user_profiles(id,employee_id,role,is_active) values
 ('20000000-0000-0000-0000-000000000001',null,'Master Admin',true),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Scrub Technician',true),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Crew Lead',true),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','Scrub Technician',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.inventory_create_location('Central','central') as central \gset
select public.inventory_create_location('Solo','individual','10000000-0000-0000-0000-000000000001') as solo \gset
select public.inventory_create_location('Unrelated','individual','10000000-0000-0000-0000-000000000002') as unrelated \gset
select set_config('test.central',:'central',true),set_config('test.solo',:'solo',true),set_config('test.unrelated',:'unrelated',true);
select public.inventory_move('30000000-0000-0000-0000-000000000001','trash',20,'purchase','Physical receipt',null,:'central');
select public.inventory_move('30000000-0000-0000-0000-000000000001','trash',20,'purchase','Physical receipt',null,:'central');
do $$ begin
 if (select quantity from public.technician_inventory_stock where item_key='trash')<>20 then raise exception 'Retry double counted purchase'; end if;
 begin perform public.inventory_move('30000000-0000-0000-0000-000000000001','trash',21,'purchase','Changed payload',null,current_setting('test.central')::uuid); raise exception 'Expected payload conflict'; exception when raise_exception then if sqlerrm='Expected payload conflict' then raise; end if; end;
 begin perform public.inventory_move(gen_random_uuid(),'trash',21,'issue','Overdraw',current_setting('test.central')::uuid,current_setting('test.solo')::uuid); raise exception 'Expected overdraw rejection'; exception when raise_exception then if sqlerrm='Expected overdraw rejection' then raise; end if; end;
 begin perform public.inventory_move(gen_random_uuid(),'microfiber',1,'purchase','Aggregate duplication',null,current_setting('test.central')::uuid); raise exception 'Expected aggregate rejection'; exception when raise_exception then if sqlerrm='Expected aggregate rejection' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.inventory_request_restock(:'solo','trash',0,10,'Low supply','urgent') as request \gset
select set_config('test.request',:'request',true);
do $$ begin
 if (select count(*) from public.technician_inventory_locations)<>1 then raise exception 'Unrelated location disclosure'; end if;
 if exists(select 1 from public.technician_chemical_formulas) then raise exception 'Unverified formula disclosure'; end if;
 begin perform public.inventory_request_restock(current_setting('test.solo')::uuid,'trash',0,10,'Duplicate','routine'); raise exception 'Expected unique violation'; exception when unique_violation then null; end;
 begin perform public.inventory_move(gen_random_uuid(),'trash',1,'purchase','Unauthorized',null,current_setting('test.solo')::uuid); raise exception 'Expected authorization failure'; exception when insufficient_privilege then null; end;
 begin update public.technician_inventory_stock set quantity=999; raise exception 'Expected direct write denial'; exception when insufficient_privilege then null; end;
 begin perform public.inventory_request_restock(current_setting('test.unrelated')::uuid,'trash',0,1,'Unrelated','routine'); raise exception 'Expected unrelated denial'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.inventory_update_request(:'request','approved');
select public.inventory_move('30000000-0000-0000-0000-000000000002','trash',4,'issue','Partial fulfillment',:'central',:'solo',null,:'request');
select public.inventory_move('30000000-0000-0000-0000-000000000002','trash',4,'issue','Partial fulfillment',:'central',:'solo',null,:'request');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.inventory_update_request(:'request','received',4);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
-- Partial receipt must still permit subsequent fulfillment.
select public.inventory_move('30000000-0000-0000-0000-000000000003','trash',6,'issue','Remaining fulfillment',:'central',:'solo',null,:'request');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.inventory_update_request(:'request','received',10);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.inventory_update_request(:'request','completed');
do $$ begin
 if (select quantity from public.technician_inventory_stock where location_id=current_setting('test.central')::uuid and item_key='trash')<>10 then raise exception 'Incorrect central stock'; end if;
 if (select quantity from public.technician_inventory_stock where location_id=current_setting('test.solo')::uuid and item_key='trash')<>10 then raise exception 'Incorrect solo stock'; end if;
 if (select issued_quantity from public.technician_restock_requests where id=current_setting('test.request')::uuid)<>10 then raise exception 'Duplicate fulfillment'; end if;
 if not exists(select 1 from public.technician_inventory_audit) then raise exception 'Missing audit'; end if;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
do $$ begin
 if exists(select 1 from public.technician_inventory_locations) or exists(select 1 from public.technician_chemical_formulas) or exists(select 1 from public.technician_kit_standard_items) then raise exception 'Contractor disclosure'; end if;
end $$;
reset role;
do $$ begin
 begin update public.technician_chemical_formulas set status='released',verified_by='20000000-0000-0000-0000-000000000001',verified_at=now() where name='Dawn Glass Cleaner'; raise exception 'Expected safety release constraint'; exception when check_violation then null; end;
 if exists(select 1 from public.technician_inventory_stock where quantity<0) then raise exception 'Negative inventory'; end if;
end $$;
rollback;
\echo 'Inventory PostgreSQL authorization, partial fulfillment, audit, idempotency and safety assertions passed'
