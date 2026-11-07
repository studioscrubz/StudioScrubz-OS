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

\ir ../migrations/20261107192154_contractor_private_messages.sql

do $$
begin
 if has_table_privilege('authenticated','public.contractor_private_messages','SELECT')
    or has_table_privilege('authenticated','public.contractor_private_messages','INSERT')
    or has_table_privilege('anon','public.contractor_private_messages','SELECT')
    or has_table_privilege('authenticated','public.contractor_messages','SELECT') then
  raise exception 'Private or historical contractor messages are reachable by browser roles';
 end if;
 if not has_table_privilege('service_role','public.contractor_private_messages','SELECT,INSERT,UPDATE') then
  raise exception 'The contractor server cannot store or read private conversations';
 end if;
end
$$;

\ir ../migrations/20261107200058_contractor_request_review.sql

update public.contractor_companies set assigned_manager_id='00000000-0000-4000-8000-000000000002'
 where id='10000000-0000-4000-8000-000000000001';

-- New portal submissions save the property atomically and are queued for the manager.
insert into public.contractor_opportunities(id,company_id,submitted_by,service_type,property_type,property_name,
 property_address,scope_of_work,requested_date,estimated_person_hours,proposed_amount,request_options)
values('30000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000011','Deep Cleaning','Residential','Sample Residence',
 '321 Original Example Street','Clean the entire test property',current_date,4,500,'{}');

do $$begin
 if not exists(select 1 from public.contractor_opportunities o join public.properties p on p.id=o.request_property_id
  join public.contractor_companies c on c.id=o.company_id and c.client_id=p.client_id
  where o.id='30000000-0000-4000-8000-000000000009' and p.property_name='Sample Residence' and p.address=o.property_address) then
  raise exception 'New contractor property was not saved for its company';
 end if;
 begin
  insert into public.contractor_opportunities(company_id,service_type,property_type,property_address,scope_of_work,
   requested_date,estimated_person_hours,proposed_amount,request_options)
  values('10000000-0000-4000-8000-000000000001','Deep Cleaning','Residential','422 No Name Example Street',
   'Clean the entire test property',current_date,4,500,'{}');
  raise exception 'The missing residential name was accepted';
 exception when raise_exception then
  if sqlerrm<>'A name is required for residential requests.' then raise; end if;
 end;
end$$;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
do $$begin
 if not exists(select 1 from public.get_my_contractor_request_reviews() where id='30000000-0000-4000-8000-000000000009') then
  raise exception 'Assigned Operations Manager did not receive the review item';
 end if;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
do $$begin
 if exists(select 1 from public.get_my_contractor_request_reviews() where id='30000000-0000-4000-8000-000000000009') then
  raise exception 'Unassigned admin received an assigned manager review item';
 end if;
end$$;
reset role;

-- A pre-approval edit can change the requested address and invalidates old pricing.
insert into public.contractor_profitability(opportunity_id,assessed_by,assessed_amount,assessed_scope,minimum_price,cost_complete,projection)
values('30000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000002',500,'Clean the entire test property',100,true,'{}');
update public.contractor_opportunities
 set property_address='345 Corrected Example Street',request_revision=1
 where id='30000000-0000-4000-8000-000000000009';
do $$begin
 if exists(select 1 from public.contractor_profitability where opportunity_id='30000000-0000-4000-8000-000000000009') then
  raise exception 'Stale contractor profitability survived a request edit';
 end if;
 if not exists(select 1 from public.contractor_opportunities o join public.properties p on p.id=o.request_property_id
  where o.id='30000000-0000-4000-8000-000000000009' and p.address='345 Corrected Example Street') then
  raise exception 'Edited contractor address was not saved';
 end if;
end$$;

update public.contractor_opportunities
 set status='Awaiting Approval',partner_confirmed_at=now(),final_scope=scope_of_work,agreed_amount=proposed_amount
 where id='30000000-0000-4000-8000-000000000009';
insert into public.contractor_profitability(opportunity_id,request_revision,assessed_by,assessed_amount,assessed_scope,minimum_price,cost_complete,projection)
values('30000000-0000-4000-8000-000000000009',1,'00000000-0000-4000-8000-000000000002',500,'Clean the entire test property',100,true,'{}');

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
select public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000009');
reset role;
do $$begin
 if not exists(select 1 from public.contractor_opportunities o join public.jobs j on j.id=o.linked_job_id
  where o.id='30000000-0000-4000-8000-000000000009' and o.request_property_id=j.property_id and j.property_name='Sample Residence') then
  raise exception 'Approval failed to reuse the saved property and name';
 end if;
 if (select count(*) from public.properties where address='345 Corrected Example Street')<>1 then
  raise exception 'Approval duplicated the saved property';
 end if;
 begin
  update public.contractor_opportunities set request_revision=2
   where id='30000000-0000-4000-8000-000000000009';
  raise exception 'Approved contractor request was editable';
 exception when raise_exception then
  if sqlerrm<>'This contractor request is locked.' then raise; end if;
 end;
end$$;

-- Existing staff invitations and new teammate invitations use the same redemption flow.
\ir ../migrations/20261107205053_contractor_team_invitations.sql
insert into auth.users(id,email,email_confirmed_at)
values('00000000-0000-4000-8000-000000000014','teammate@example.test',now());
do $$begin
 if has_function_privilege('authenticated','public.prepare_contractor_team_invitation(uuid,text,text)','EXECUTE')
 or has_function_privilege('anon','public.prepare_contractor_team_invitation(uuid,text,text)','EXECUTE') then
  raise exception 'Team invite preparation exposed to browser roles';
 end if;
end$$;
set role service_role;
do $$begin
 begin
  perform public.prepare_contractor_team_invitation('00000000-0000-4000-8000-000000000011','unauthorized@example.test',repeat('4',64));
  raise exception 'Deactivated owner was able to invite teammates';
 exception when raise_exception then
  if sqlerrm<>'Only an active contractor owner can invite teammates.' then raise; end if;
 end;
end$$;
reset role;
update public.contractor_members set is_active=true where email='alpha@example.test';
set role service_role;
select * from public.prepare_contractor_team_invitation('00000000-0000-4000-8000-000000000011','teammate@example.test',repeat('1',64));
select * from public.prepare_contractor_team_invitation('00000000-0000-4000-8000-000000000011','teammate@example.test',repeat('2',64));
reset role;
do $$begin
 if not exists(select 1 from public.contractor_invitations where token_hash=repeat('1',64) and status='Revoked')
 or not exists(select 1 from public.contractor_invitations where token_hash=repeat('2',64) and status='Pending'
  and company_id='10000000-0000-4000-8000-000000000001' and member_role='Member'
  and invited_by='00000000-0000-4000-8000-000000000011') then
  raise exception 'Owner invitation was not scoped, attributed, or rotated correctly';
 end if;
end$$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000014',false);
select public.redeem_contractor_invitation(repeat('2',64));
reset role;
set role service_role;
do $$begin
 begin
  perform public.prepare_contractor_team_invitation('00000000-0000-4000-8000-000000000014','unauthorized@example.test',repeat('3',64));
  raise exception 'Regular member was able to invite teammates';
 exception when raise_exception then
  if sqlerrm<>'Only an active contractor owner can invite teammates.' then raise; end if;
 end;
end$$;
reset role;

-- Portal company creation and Accounts client linking are atomic.
\ir ../migrations/20261107210215_link_new_contractor_clients.sql
insert into public.clients(id,client_type,company_name,email,status)
values('40000000-0000-4000-8000-000000000099','Contractor','Existing Accounts Contractor','existing@example.test','Lead');
grant select,insert,update on public.clients to service_role;
set role service_role;
insert into public.contractor_companies(name,contact_email,contact_name,phone)
values('New Portal Contractor','new@example.test','Jamie Example','555-0100');
insert into public.contractor_companies(name,contact_email)
values(' existing accounts contractor ','EXISTING@example.test');
do $$begin
 begin
  insert into public.contractor_companies(name,contact_email)
  values('New Portal Contractor','new@example.test');
  raise exception 'Repeated company creation unexpectedly succeeded';
 exception when raise_exception then
  if sqlerrm<>'This Contractor client already has a portal company.' then raise; end if;
 end;
end$$;
reset role;
do $$begin
 if not exists(select 1 from public.contractor_companies p join public.clients c on c.id=p.client_id
  where p.name='New Portal Contractor' and p.status='Pending' and c.client_type='Contractor'
  and c.status='Active' and c.first_name='Jamie' and c.last_name='Example'
  and c.email='new@example.test' and c.phone='555-0100') then
  raise exception 'New contractor did not receive the expected Accounts client';
 end if;
 if not exists(select 1 from public.contractor_companies p join public.clients c on c.id=p.client_id
  where c.id='40000000-0000-4000-8000-000000000099' and c.status='Lead') then
  raise exception 'Existing Accounts client was not reused with its existing status';
 end if;
 if (select count(*) from public.clients where company_name='New Portal Contractor')<>1 then
  raise exception 'Duplicate Accounts client created';
 end if;
end$$;

-- A verified owner activates a pending company without a separate Operations action.
\ir ../migrations/20261107210843_activate_contractor_company_on_owner_redemption.sql
insert into auth.users(id,email,email_confirmed_at)
values('00000000-0000-4000-8000-000000000015','newowner@example.test',now());
insert into public.contractor_invitations(company_id,invited_email,member_role,token_hash,invited_by)
select id,'newowner@example.test','Member',repeat('5',64),'00000000-0000-4000-8000-000000000001'::uuid
from public.contractor_companies where name='New Portal Contractor'
union all
select id,'newowner@example.test','Company Admin',repeat('6',64),'00000000-0000-4000-8000-000000000001'::uuid
from public.contractor_companies where name='New Portal Contractor';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000015',false);
do $$begin
 begin
  perform public.redeem_contractor_invitation(repeat('5',64));
  raise exception 'A teammate invitation activated a pending company';
 exception when raise_exception then
  if sqlerrm<>'Company access is unavailable.' then raise; end if;
 end;
end$$;
reset role;
update public.contractor_companies set status='Suspended' where name='New Portal Contractor';
set role authenticated;
do $$begin
 begin
  perform public.redeem_contractor_invitation(repeat('6',64));
  raise exception 'An owner invitation reactivated a suspended company';
 exception when raise_exception then
  if sqlerrm<>'Company access is unavailable.' then raise; end if;
 end;
end$$;
reset role;
update public.contractor_companies set status='Pending' where name='New Portal Contractor';
set role authenticated;
select public.redeem_contractor_invitation(repeat('6',64));
reset role;
do $$begin
 if not exists(select 1 from public.contractor_companies c
  join public.contractor_members m on m.company_id=c.id
  join public.contractor_invitations i on i.company_id=c.id and i.redeemed_by=m.user_id
  where c.name='New Portal Contractor' and c.status='Active' and m.is_active
    and m.member_role='Company Admin' and i.status='Redeemed' and i.token_hash=repeat('6',64)) then
  raise exception 'Owner redemption did not atomically activate company and membership';
 end if;
end$$;
