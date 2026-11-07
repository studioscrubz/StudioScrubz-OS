-- The exact reviewed migrations must work in clean native PostgreSQL.
\set ON_ERROR_STOP on
create table test_identity(id uuid primary key,email text);
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000001','admin@example.test',now()),
 ('00000000-0000-4000-8000-000000000002','manager@example.test',now()),
 ('00000000-0000-4000-8000-000000000011','alpha@example.test',now()),
 ('00000000-0000-4000-8000-000000000012','beta@example.test',now()),
 ('00000000-0000-4000-8000-000000000013','expired@example.test',now());
insert into public.user_profiles(id,role,is_active) values
 ('00000000-0000-4000-8000-000000000001','Master Admin',true),
 ('00000000-0000-4000-8000-000000000002','Manager',true);
insert into public.contractor_companies(id,name,contact_email,status) values
 ('10000000-0000-4000-8000-000000000001','Alpha Cleaning','alpha@example.test','Active'),
 ('10000000-0000-4000-8000-000000000002','Beta Cleaning','beta@example.test','Active');
insert into public.contractor_invitations(id,company_id,invited_email,member_role,token_hash,invited_by)
values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','alpha@example.test','Company Admin',repeat('a',64),'00000000-0000-4000-8000-000000000001');
insert into public.contractor_invitations(id,company_id,invited_email,member_role,token_hash,created_at,expires_at,invited_by)
values ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','expired@example.test','Member',repeat('b',64),now()-interval '9 days',now()-interval '2 days','00000000-0000-4000-8000-000000000001');

-- Direct API write privileges must be absent even when RLS internal policy exists.
do $$ begin
 if has_table_privilege('authenticated','public.contractor_profitability','UPDATE') then raise exception 'Manager direct financial updates permitted'; end if;
 if has_table_privilege('authenticated','public.contractor_opportunities','UPDATE') then raise exception 'Workflow bypass available'; end if;
 if has_table_privilege('authenticated','public.contractor_companies','INSERT') then raise exception 'Unsafe company creation grants'; end if;
end $$;
-- External A cannot read companies, opportunity details or confidential assessments.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',false);
do $$ declare n int; begin
 select count(*) into n from public.contractor_companies;
 if n<>0 then raise exception 'External company row leak'; end if;
 select count(*) into n from public.contractor_profitability;
 if n<>0 then raise exception 'Financial RLS leak'; end if;
end $$;
select public.redeem_contractor_invitation(repeat('a',64));
do $$ declare n int; begin
 select count(*) into n from public.contractor_members;
 if n<>0 then raise exception 'External memberships must only be returned through the protected API'; end if;
 begin
 perform public.redeem_contractor_invitation(repeat('a',64));
 raise exception 'Double redemption unexpectedly succeeded';
 exception when others then
   if sqlerrm='Double redemption unexpectedly succeeded' then raise; end if;
 end;
end $$;
-- Different signed-in email cannot redeem another company's invitation.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',false);
do $$ begin
 begin
 perform public.redeem_contractor_invitation(repeat('a',64));
 raise exception 'Cross-company replay succeeded';
 exception when others then
  if sqlerrm='Cross-company replay succeeded' then raise; end if;
 end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000013',false);
do $$ begin
 begin
 perform public.redeem_contractor_invitation(repeat('b',64));
 raise exception 'Expired invitation was redeemed';
 exception when others then
  if sqlerrm='Expired invitation was redeemed' then raise; end if;
 end;
end $$;
-- Internal Master Admin sees records, Manager is operational but cannot UPDATE protected financial table.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
do $$ declare n int; begin
 select count(*) into n from public.contractor_companies;
 if n<>2 then raise exception 'Master Admin company visibility broken'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
do $$ declare n int; begin
 select count(*) into n from public.contractor_companies;
 if n<>2 then raise exception 'Manager company read broken'; end if;
end $$;
reset role;
-- Missing confirmation / nonexistent assessment prevents job conversion.
insert into public.contractor_opportunities(id,company_id,service_type,property_address,property_type,
 scope_of_work,requested_date,estimated_person_hours,proposed_amount,status)
values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 'Standard Cleaning','100 Example Lane, Los Angeles CA','Residential','Deeply clean kitchen and bathrooms',current_date+1,8,450,'Accepted');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
do $$ begin
 begin
 perform public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000001');
 raise exception 'Unconfirmed conversion succeeded';
 exception when others then
  if sqlerrm='Unconfirmed conversion succeeded' then raise; end if;
 end;
end $$;
reset role;
update public.contractor_opportunities set partner_confirmed_at=now(),internal_confirmed_at=now(),
 final_scope='Deeply clean kitchen and bathrooms',agreed_amount=450 where id='30000000-0000-4000-8000-000000000001';
insert into public.contractor_profitability(opportunity_id,assessed_by,assessed_amount,assessed_scope,projection,minimum_price,cost_complete)
values('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',450,'Deeply clean kitchen and bathrooms','{}',500,true);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
do $$ begin
 begin
 perform public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000001');
 raise exception 'Below minimum conversion succeeded';
 exception when others then
  if sqlerrm='Below minimum conversion succeeded' then raise; end if;
 end;
end $$;
reset role;
update public.contractor_profitability set assessed_scope='Stale old scope',minimum_price=420 where opportunity_id='30000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
do $$ begin
 begin
 perform public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000001');
 raise exception 'Stale profitability assessment converted';
 exception when others then
  if sqlerrm='Stale profitability assessment converted' then raise; end if;
 end;
end $$;
reset role;
update public.contractor_profitability set minimum_price=420 where opportunity_id='30000000-0000-4000-8000-000000000001';
update public.contractor_profitability set assessed_scope='Deeply clean kitchen and bathrooms' where opportunity_id='30000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
create temporary table test_created as
select public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000001') as id;
do $$ declare first_id uuid;second_id uuid;begin
 select id into first_id from test_created;
 select public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000001') into second_id;
 if first_id<>second_id then raise exception 'Duplicate Job conversion'; end if;
end $$;
reset role;
do $$ declare n int;begin
 select count(*) into n from public.jobs;
 if n<>1 then raise exception 'Expected exactly one Job'; end if;
 select count(*) into n from public.contractor_opportunities where linked_job_id is not null and status='Crew Assignment';
 if n<>1 then raise exception 'Job linkage not saved'; end if;
end $$;

-- Verify that acceptance, profit approval and the operational Job are one transaction.
insert into public.contractor_opportunities(id,company_id,service_type,property_address,property_type,
 scope_of_work,requested_date,estimated_person_hours,proposed_amount)
values ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
 'Standard Cleaning','200 Example Lane, Los Angeles CA','Residential','Clean the lobby and bathrooms',current_date+1,8,450);

do $$ begin
 if has_function_privilege('authenticated','public.record_contractor_offer(uuid,uuid,numeric,text,text,text)','EXECUTE')
  then raise exception 'Browser can impersonate offer actor'; end if;
 if has_function_privilege('anon','public.redeem_contractor_invitation(text)','EXECUTE')
  then raise exception 'Anonymous invitation redemption is callable'; end if;
 if not exists(select 1 from storage.buckets where id='contractor-private' and not public and file_size_limit=4194304)
  then raise exception 'Private contractor upload bucket was not provisioned'; end if;
end $$;

set role service_role;
do $$ begin
 begin
  perform public.record_contractor_offer('30000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000012',475,'Clean both floors','Flat Price',null);
  raise exception 'Cross-company offer unexpectedly succeeded';
 exception when others then
  if sqlerrm<>'Opportunity is unavailable.' then raise; end if;
 end;
end $$;
select public.record_contractor_offer('30000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000011',475,'Clean both floors','Flat Price',null);
reset role;
update public.contractor_opportunities set status='Awaiting Approval',partner_confirmed_at=now()
 where id='30000000-0000-4000-8000-000000000002';

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
do $$ begin
 begin
  perform public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000002');
  raise exception 'Unassessed opportunity accepted';
 exception when others then
  if sqlerrm<>'Internal profitability assessment is required.' then raise; end if;
 end;
end $$;
reset role;

insert into public.contractor_profitability(opportunity_id,assessed_by,assessed_amount,assessed_scope,projection,minimum_price,cost_complete)
values ('30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',475,'Clean both floors','{}',450,true);

-- Simulate an operational Job constraint failure and verify all side effects roll back.
alter table public.jobs add constraint test_reject_handoff check (price <> 475);
set role authenticated;
do $$ begin
 begin
  perform public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000002',null,'2000-01-01');
  raise exception 'A stale acceptance unexpectedly succeeded';
 exception when others then
  if sqlerrm<>'Opportunity changed. Reload and review the confirmed terms.' then raise; end if;
 end;
 begin
  perform public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000002');
  raise exception 'Expected operational Job failure';
 exception when check_violation then null;
 end;
end $$;
reset role;
do $$ begin
 if not exists(select 1 from public.contractor_opportunities where id='30000000-0000-4000-8000-000000000002'
  and status='Awaiting Approval' and internal_confirmed_at is null and linked_job_id is null) then
  raise exception 'Job insert failure left an accepted opportunity';
 end if;
 if (select count(*) from public.properties)<>1 then raise exception 'Job insert failure left a property'; end if;
end $$;

alter table public.jobs drop constraint test_reject_handoff;
set role authenticated;
select public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000002','Approved fixture terms');
reset role;
do $$ begin
 if not exists(select 1 from public.contractor_opportunities o join public.jobs j on j.id=o.linked_job_id
  where o.id='30000000-0000-4000-8000-000000000002' and o.decision_reason='Approved fixture terms'
  and j.price=475 and j.scope->0->>'text'='Clean both floors') then
  raise exception 'Approved terms did not carry through to the operational Job';
 end if;
end $$;

update public.contractor_members set is_active=false where email='alpha@example.test';
set role service_role;
do $$ begin
 begin
  perform public.record_contractor_offer('30000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000011',490,'Another change','Flat Price',null);
  raise exception 'Deactivated member could submit an offer';
 exception when others then
  if sqlerrm<>'Opportunity is unavailable.' then raise; end if;
 end;
end $$;
reset role;

-- Run the existing invoicing RPC against a converted Contractor Job.
select linked_job_id as invoiced_job from public.contractor_opportunities
 where id='30000000-0000-4000-8000-000000000002' \gset
update public.jobs set status='Completed' where id=:'invoiced_job';
select set_config('test.contractor_invoiced_job',:'invoiced_job',false);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',false);
do $$ begin
 begin
  perform public.create_completed_job_invoice(current_setting('test.contractor_invoiced_job')::uuid);
  raise exception 'Partner was able to create an invoice';
 exception when others then
  if sqlerrm<>'Job completion invoicing is not permitted.' then raise; end if;
 end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
do $$ declare first_call jsonb;second_call jsonb;begin
 first_call:=public.create_completed_job_invoice(current_setting('test.contractor_invoiced_job')::uuid);
 second_call:=public.create_completed_job_invoice(current_setting('test.contractor_invoiced_job')::uuid);
 if first_call->>'created'<>'true' or second_call->>'created'<>'false'
  or first_call->>'invoice_id' is distinct from second_call->>'invoice_id' then
  raise exception 'Existing invoice handoff did not deduplicate the contractor Job';
 end if;
end $$;
reset role;
do $$ begin
 if not exists(select 1 from public.invoices i join public.clients c on c.id=i.client_id
  where i.job_id=current_setting('test.contractor_invoiced_job')::uuid and c.client_type='Contractor'
   and i.total=475 and i.balance_due=475 and i.amount_paid=0) then
  raise exception 'Existing invoice failed to use the negotiated Contractor Job compensation';
 end if;
end $$;
