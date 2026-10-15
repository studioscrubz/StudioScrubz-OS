\set ON_ERROR_STOP on

begin;

do $$ begin
  if not exists(select 1 from public.business_settings) then insert into public.business_settings default values; end if;
end $$;

insert into auth.users(id,email,role,aud) values
  ('81000000-0000-4000-8000-000000000001','agreement-draft-admin@example.test','authenticated','authenticated');
insert into public.user_profiles(id,email,display_name,role,is_active) values
  ('81000000-0000-4000-8000-000000000001','agreement-draft-admin@example.test','Agreement Draft Admin','Administrator',true);
insert into public.clients(id,client_type,first_name,last_name,status) values
  ('82000000-0000-4000-8000-000000000001','Residential','Draft','Client','Active');
insert into public.properties(id,client_id,property_name,property_type,address) values
  ('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Draft Home','Residential','1 Draft Way');

set local session_replication_role = replica;
insert into public.proposals(
  id,revision_group_id,proposal_number,client_id,property_id,division,client_name,frequency,
  requested_date,result,photos,status,approval_status,accepted,expiration_date,is_current_revision,
  sent_at,client_access_token,client_access_token_expires_at,client_delivery_snapshot
) values
(
  '84000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','TEST-AUTO-STANDARD',
  '82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','Residential','Draft Client','Biweekly',null,
  '{"serviceName":"Standard Cleaning","serviceDescription":"Accepted description","baseEstimateAmount":240,"frequencyDiscount":20,"manualDiscount":10,"taxes":0,"perVisitTotal":210,"monthlyTotal":455,"acceptedPricingAllocation":{"version":1,"baseServiceAmount":190,"addons":[{"id":"addon-1","label":"Inside Oven","pricingType":"Flat Price","quantity":1,"unitName":null,"unitPrice":20,"lineTotal":20}],"totalAmount":210},"adjustments":[{"id":"addon-1","label":"Inside Oven","amount":20,"catalogAddonId":"catalog-addon-1"}],"scope":[{"id":"scope-1","text":"Clean agreed rooms"}],"terms":{"paymentTerms":"Due on receipt","cancellationPolicy":"Accepted cancellation policy","accessRequirements":"Client provides access","specialConditions":"Protect wood floors"},"estimatedDuration":3}'::jsonb,
  '[]'::jsonb,'Sent','Approved',false,current_date+30,true,now(),'standard-acceptance-token-00000000000000000001',now()+interval '1 day',
  '{"service_name":"Standard Cleaning","per_visit_total":210}'::jsonb
),
(
  '84000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000002','TEST-AUTO-UPKEEP',
  '82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','Residential','Draft Client','Monthly',null,
  '{"serviceName":"StudioScrubz Upkeep Plan","serviceDescription":"Three accepted light-cleaning visits","baseEstimateAmount":300,"manualDiscount":0,"taxes":0,"perVisitTotal":70,"monthlyTotal":210,"upkeepPlan":{"standardCleaningValue":100,"adjustmentPercent":30,"upkeepVisitValue":70,"visitsIncluded":3,"monthlyPackage":210},"adjustments":[],"scope":[{"id":"scope-2","text":"Light maintenance cleaning"}],"terms":{"paymentTerms":"Monthly","cancellationPolicy":"Accepted upkeep cancellation policy","accessRequirements":"Client provides access","specialConditions":""},"estimatedDuration":2}'::jsonb,
  '[]'::jsonb,'Sent','Approved',false,current_date+30,true,now(),null,null,'{"service_name":"StudioScrubz Upkeep Plan","monthly_total":210}'::jsonb
);
set local session_replication_role = origin;

-- Public online acceptance must atomically create the Standard Cleaning Draft.
set local role anon;
select public.accept_proposal_by_token('standard-acceptance-token-00000000000000000001','Draft Client',true);
select public.accept_proposal_by_token('standard-acceptance-token-00000000000000000001','Draft Client',true);
reset role;

-- Authorized manual acceptance must use the same handoff for Upkeep Plans.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select public.record_manual_proposal_acceptance(
  '84000000-0000-4000-8000-000000000002','In Person',now(),'Upkeep acceptance test',true
);
select public.record_manual_proposal_acceptance(
  '84000000-0000-4000-8000-000000000002','In Person',now(),'Upkeep acceptance test',true
);
reset role;

do $$
declare standard_row public.service_agreements; upkeep_row public.service_agreements;
begin
  select * into standard_row from public.service_agreements where proposal_id='84000000-0000-4000-8000-000000000001';
  if not found or standard_row.status <> 'Draft' or standard_row.sent_at is not null
    or standard_row.billing_type <> 'Per Visit' or standard_row.billing_amount <> 210
    or standard_row.start_date is not null or standard_row.days_of_week <> '[]'::jsonb
    or standard_row.pricing_snapshot->'accepted_proposal_result' is distinct from
      (select result from public.proposals where id='84000000-0000-4000-8000-000000000001')
    or standard_row.pricing_snapshot#>>'{accepted_pricing_allocation,totalAmount}' <> '210'
  then raise exception 'Standard accepted Proposal Draft was not generated from its authoritative snapshot.'; end if;

  select * into upkeep_row from public.service_agreements where proposal_id='84000000-0000-4000-8000-000000000002';
  if not found or upkeep_row.status <> 'Draft' or upkeep_row.service_name <> 'StudioScrubz Upkeep Plan'
    or upkeep_row.frequency <> 'Monthly' or upkeep_row.billing_type <> 'Monthly' or upkeep_row.billing_amount <> 210
    or upkeep_row.day_of_month is not null or upkeep_row.second_day_of_month is not null or upkeep_row.third_day_of_month is not null
    or upkeep_row.pricing_snapshot#>>'{upkeep_plan,visitsIncluded}' <> '3'
    or upkeep_row.pricing_snapshot#>>'{upkeep_plan,monthlyPackage}' <> '210'
  then raise exception 'Upkeep Plan Draft did not preserve one monthly three-visit package.'; end if;

  if (select count(*) from public.service_agreements where proposal_id in (
    '84000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000002')) <> 2 then
    raise exception 'Acceptance retries created duplicate Agreements.';
  end if;
  if (select count(*) from public.proposal_history where proposal_id='84000000-0000-4000-8000-000000000001'
    and event_type='Service Agreement Created') <> 1 then raise exception 'Agreement creation history was duplicated.'; end if;

  begin
    update public.service_agreements set status='Sent' where id=standard_row.id;
    raise exception 'Incomplete Draft unexpectedly left Draft status.';
  exception when others then
    if sqlerrm not like '%Confirm the Agreement start date%' then raise; end if;
  end;
end $$;

-- Declined and superseded Proposals must never generate Agreements.
set local session_replication_role = replica;
insert into public.proposals(
  id,revision_group_id,proposal_number,division,client_name,frequency,result,photos,status,
  approval_status,accepted,expiration_date,is_current_revision,superseded_at
) values
  ('84000000-0000-4000-8000-000000000003','84000000-0000-4000-8000-000000000003','TEST-AUTO-DECLINED','Residential','No Draft','One-Time','{"serviceName":"Standard Cleaning","perVisitTotal":100}'::jsonb,'[]','Declined','Approved',false,current_date+30,true,null),
  ('84000000-0000-4000-8000-000000000004','84000000-0000-4000-8000-000000000004','TEST-AUTO-SUPERSEDED','Residential','No Draft','One-Time','{"serviceName":"Standard Cleaning","perVisitTotal":100}'::jsonb,'[]','Accepted','Approved',true,current_date+30,false,now());
set local session_replication_role = origin;

do $$ begin
  if private.ensure_proposal_draft_agreement('84000000-0000-4000-8000-000000000003') is not null
    or private.ensure_proposal_draft_agreement('84000000-0000-4000-8000-000000000004') is not null then
    raise exception 'An ineligible Proposal generated an Agreement.';
  end if;
end $$;

rollback;
