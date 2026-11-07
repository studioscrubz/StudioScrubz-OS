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
 if n<>1 then raise exception 'External member should only see self'; end if;
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
do $ begin
 begin
 perform public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000001');
 raise exception 'Stale profitability assessment converted';
 exception when others then
  if sqlerrm='Stale profitability assessment converted' then raise; end if;
 end;
end $;
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
