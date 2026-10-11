\set ON_ERROR_STOP on

begin;

do $$ begin
  if not exists (select 1 from public.business_settings) then
    insert into public.business_settings default values;
  end if;
end $$;

insert into auth.users(id, email, role, aud) values
  ('71000000-0000-4000-8000-000000000001', 'manual-admin@example.test', 'authenticated', 'authenticated'),
  ('71000000-0000-4000-8000-000000000002', 'manual-tech@example.test', 'authenticated', 'authenticated');

insert into public.user_profiles(id, email, display_name, role, is_active) values
  ('71000000-0000-4000-8000-000000000001', 'manual-admin@example.test', 'Manual Admin', 'Administrator', true),
  ('71000000-0000-4000-8000-000000000002', 'manual-tech@example.test', 'Manual Tech', 'Scrub Technician', true);

insert into public.clients(id, client_type, company_name, status)
values ('73000000-0000-4000-8000-000000000001', 'Commercial', 'Manual Acceptance Test Client', 'Active');
insert into public.properties(id, client_id, property_name, property_type, address)
values ('74000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', 'Manual Acceptance Test Property', 'Commercial', '1 Test Way');

set local session_replication_role = replica;
insert into public.proposals(
  id, revision_group_id, proposal_number, division, client_name, frequency,
  result, photos, status, approval_status, accepted, expiration_date,
  is_current_revision, sent_at, client_delivery_snapshot
) values
  ('72000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'TEST-MANUAL-CURRENT', 'Residential', 'Test Client', 'One-Time',
   '{"serviceName":"Standard Cleaning","perVisitTotal":200}'::jsonb, '[]'::jsonb, 'Sent', 'Approved', false, current_date + 30, true, now() - interval '1 day', '{"per_visit_total":200}'::jsonb),
  ('72000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', 'TEST-MANUAL-SUPERSEDED', 'Residential', 'Test Client', 'One-Time',
   '{"serviceName":"Standard Cleaning","perVisitTotal":200}'::jsonb, '[]'::jsonb, 'Sent', 'Approved', false, current_date + 30, false, now() - interval '1 day', '{"per_visit_total":200}'::jsonb),
  ('72000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000003', 'TEST-MANUAL-DRAFT', 'Residential', 'Test Client', 'One-Time',
   '{"serviceName":"Standard Cleaning","perVisitTotal":200}'::jsonb, '[]'::jsonb, 'Draft', 'Not Submitted', false, current_date + 30, true, null, null),
  ('72000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000004', 'TEST-MANUAL-PC', 'Commercial', 'Manual Acceptance Test Client', 'One-Time',
   '{"serviceName":"Post-Construction Cleaning","perVisitTotal":1000,"baseEstimateAmount":1000,"scope":[]}'::jsonb, '[]'::jsonb, 'Viewed', 'Approved', false, current_date + 30, true, now() - interval '1 day', '{"service_name":"Post-Construction Cleaning","per_visit_total":1000,"deposit_percent":25}'::jsonb);
update public.proposals
set client_id = '73000000-0000-4000-8000-000000000001',
    property_id = '74000000-0000-4000-8000-000000000001'
where id = '72000000-0000-4000-8000-000000000004';
set local session_replication_role = origin;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);

do $$ begin
  if public.can_record_manual_proposal_acceptance() then raise exception 'Technician received manual acceptance access.'; end if;
  begin
    perform public.record_manual_proposal_acceptance('72000000-0000-4000-8000-000000000001', 'Phone', now(), 'Authorization reference', true);
    raise exception 'Technician manual acceptance unexpectedly succeeded.';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);

do $$ begin
  if not public.can_record_manual_proposal_acceptance() then raise exception 'Administrator manual acceptance access failed.'; end if;
  begin
    perform public.record_manual_proposal_acceptance('72000000-0000-4000-8000-000000000001', 'Phone', now(), 'Authorization reference', false);
    raise exception 'Missing confirmation unexpectedly succeeded.';
  exception when others then
    if sqlerrm not like '%Confirm the client explicitly authorized%' then raise; end if;
  end;
end $$;

select public.record_manual_proposal_acceptance(
  '72000000-0000-4000-8000-000000000001', 'Phone', now() - interval '1 hour',
  'Call log reference TEST-1', true
);

select public.record_manual_proposal_acceptance(
  '72000000-0000-4000-8000-000000000004', 'In Person', now() - interval '30 minutes',
  'In-person authorization record TEST-PC', true
);
select public.record_manual_proposal_acceptance(
  '72000000-0000-4000-8000-000000000004', 'In Person', now() - interval '30 minutes',
  'In-person authorization record TEST-PC', true
);
select public.record_manual_proposal_acceptance(
  '72000000-0000-4000-8000-000000000001', 'Phone', now() - interval '1 hour',
  'Call log reference TEST-1', true
);

reset role;
do $$
declare event_count integer;
begin
  if not exists (
    select 1 from public.proposals
    where id = '72000000-0000-4000-8000-000000000001'
      and status = 'Accepted' and accepted
      and acceptance_method = 'Manual - Phone'
      and signature is null and result = '{"serviceName":"Standard Cleaning","perVisitTotal":200}'::jsonb
  ) then raise exception 'Authorized manual acceptance changed invalid fields or failed.'; end if;

  select count(*) into event_count from public.proposal_history
  where proposal_id = '72000000-0000-4000-8000-000000000001'
    and event_type = 'Manual Acceptance';
  if event_count <> 1 then raise exception 'Repeat acceptance created % audit events.', event_count; end if;

  if (select count(*) from public.service_agreements where proposal_id = '72000000-0000-4000-8000-000000000004') <> 1
    or (select count(*) from public.proposal_deposit_requirements where proposal_id = '72000000-0000-4000-8000-000000000004') <> 1
    or (select count(*) from public.proposal_history where proposal_id = '72000000-0000-4000-8000-000000000004' and event_type = 'Manual Acceptance') <> 1
  then raise exception 'Repeat Post-Construction acceptance duplicated handoff records.'; end if;
  if not exists (
    select 1 from public.service_agreements
    where proposal_id = '72000000-0000-4000-8000-000000000004'
      and pricing_snapshot->>'acceptance_source' = 'Manual Acceptance'
      and pricing_snapshot->>'acceptance_method' = 'In Person'
  ) then raise exception 'Agreement metadata does not identify Manual Acceptance.'; end if;
end $$;

set local role authenticated;

do $$ begin
  begin
    perform public.record_manual_proposal_acceptance('72000000-0000-4000-8000-000000000002', 'Email', now(), 'Email reference', true);
    raise exception 'Superseded acceptance unexpectedly succeeded.';
  exception when others then
    if sqlerrm not like '%current, approved, unexpired Sent or Viewed%' then raise; end if;
  end;
  begin
    perform public.record_manual_proposal_acceptance('72000000-0000-4000-8000-000000000003', 'Email', now(), 'Email reference', true);
    raise exception 'Draft acceptance unexpectedly succeeded.';
  exception when others then
    if sqlerrm not like '%current, approved, unexpired Sent or Viewed%' then raise; end if;
  end;
  begin
    update public.proposals set result = result || '{"tampered":true}'::jsonb
    where id = '72000000-0000-4000-8000-000000000001';
    raise exception 'Accepted sent-offer mutation unexpectedly succeeded.';
  exception when others then
    if sqlerrm not like '%Sent Proposal revisions are immutable%' then raise; end if;
  end;
end $$;

rollback;
