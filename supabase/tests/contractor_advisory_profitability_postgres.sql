-- Run after the existing contractor fixture and isolation tests.
insert into public.contractor_opportunities(id,company_id,service_type,property_address,property_type,
 scope_of_work,requested_date,estimated_person_hours,proposed_amount,status,partner_confirmed_at,final_scope,agreed_amount)
values
 ('30000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000001',
 'Cleaning','91 Example Lane','Residential','Confirmed scope',current_date+1,8,400,'Awaiting Approval',now(),'Confirmed scope',400),
 ('30000000-0000-4000-8000-000000000092','10000000-0000-4000-8000-000000000001',
 'Cleaning','92 Example Lane','Residential','Confirmed scope',current_date+1,8,400,'Awaiting Approval',now(),'Confirmed scope',400);
insert into public.contractor_profitability(opportunity_id,assessed_by,assessed_amount,assessed_scope,projection,minimum_price,cost_complete,updated_at)
values('30000000-0000-4000-8000-000000000092','00000000-0000-4000-8000-000000000001',
 400,'Confirmed scope','{}',500,true,'2026-11-09 00:00:00+00');

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
do $$
declare job_id uuid;
begin
 job_id:=public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000091');
 if job_id is null or job_id<>public.convert_contractor_opportunity_to_job('30000000-0000-4000-8000-000000000091')
 then raise exception 'Advisory acceptance or repeat conversion failed'; end if;
 begin
  perform public.offer_contractor_profitability_price('30000000-0000-4000-8000-000000000092','Reviewed estimated costs','2026-11-09 00:00:00+00');
  raise exception 'Manager sent suggested price';
 exception when insufficient_privilege then null;
 end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
do $$ begin
 begin
  perform public.offer_contractor_profitability_price('30000000-0000-4000-8000-000000000092','Reviewed estimated costs','2026-11-08 00:00:00+00');
  raise exception 'Stale version accepted';
 exception when others then
  if sqlerrm not like 'The assessment or request changed.%' then raise; end if;
 end;
end $$;
select public.offer_contractor_profitability_price('30000000-0000-4000-8000-000000000092','Reviewed estimated costs','2026-11-09 00:00:00+00');
reset role;

do $$ begin
 if not exists(select 1 from public.contractor_opportunities where id='30000000-0000-4000-8000-000000000092'
   and agreed_amount=500 and partner_confirmed_at is null and status='Negotiating' and linked_job_id is null)
 then raise exception 'Suggested price must be a new unconfirmed offer'; end if;
 if not exists(select 1 from public.contractor_audit_events where opportunity_id='30000000-0000-4000-8000-000000000092'
   and event_type='Profitability Price Offered' and detail->>'reason'='Reviewed estimated costs')
 then raise exception 'Suggested price approval must be audited'; end if;
end $$;
