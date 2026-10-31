\set ON_ERROR_STOP on

begin;

create function pg_temp.expect_rejection(p_sql text, p_message text)
returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'Expected rejection: %', p_message;
end $$;

do $$
begin
  if to_regclass('public.profitability_settings') is null
    or to_regclass('public.profitability_route_cache') is null
    or to_regclass('public.profitability_projections') is null
    or to_regprocedure('public.get_profitability_projection(uuid,uuid)') is null
    or to_regprocedure('public.save_profitability_projection(uuid,uuid,jsonb)') is null
    or not exists (select 1 from pg_trigger where tgname = 'estimates_reject_general_profitability_json')
    or not exists (select 1 from pg_trigger where tgname = 'proposals_reject_general_profitability_json') then
    raise exception 'Profitability migration objects are incomplete.';
  end if;
  if not coalesce((select relrowsecurity from pg_class where oid = 'public.profitability_projections'::regclass), false) then
    raise exception 'Profitability projections does not enforce RLS.';
  end if;
  if has_table_privilege('authenticated', 'public.profitability_projections', 'select')
    or has_table_privilege('anon', 'public.profitability_projections', 'select') then
    raise exception 'Restricted projection table is readable by a browser role.';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$
declare
  saved jsonb;
begin
  saved := public.save_profitability_settings('{"version":1,"cleanerHourlyWage":30,"employerBurdenRate":0.2,"targetGrossMarginRate":0.35,"travelOrigin":"9110 De Soto Ave, Chatsworth, CA 91311","defaultVehiclesPerJob":1,"vehicleOperatingRatePerMile":0.65,"companyRequiredTravelIsCompensable":true}'::jsonb);
  if saved->>'cleanerHourlyWage' <> '30.00' or public.get_profitability_settings()->>'targetGrossMarginRate' <> '0.35' then
    raise exception 'Master Admin settings RPC did not persist normalized values.';
  end if;
  saved := public.save_profitability_projection(
    '20000000-0000-4000-8000-000000000001', null,
    '{"version":1,"price":500,"cleanerCount":1,"hoursPerCleaner":2,"estimatedLaborHours":2,"hourlyWage":30,"loadedHourlyLaborCost":36,"directCosts":{},"travel":{"verification":"Unverified","origin":"9110 De Soto Ave, Chatsworth, CA 91311","destination":"100 Main St, Chatsworth, CA 91311"}}'::jsonb
  );
  if public.get_profitability_projection('20000000-0000-4000-8000-000000000001', null)->>'price' <> '500' then
    raise exception 'Master Admin cannot read its saved profitability projection.';
  end if;
end $$;

-- Direct table access is denied even to the authorized caller; the audited RPC is required.
select pg_temp.expect_rejection('select * from public.profitability_projections', 'Master direct projection read');

-- Administrator, Manager, Sales, Crew Lead, and Scrubz Technician cannot call either restricted RPC.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select pg_temp.expect_rejection('select public.get_profitability_projection(''20000000-0000-4000-8000-000000000001'', null)', 'Administrator projection read');
select pg_temp.expect_rejection('select public.save_profitability_projection(''20000000-0000-4000-8000-000000000001'', null, ''{}''::jsonb)', 'Administrator projection write');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select pg_temp.expect_rejection('select public.get_profitability_projection(''20000000-0000-4000-8000-000000000001'', null)', 'Manager projection read');
select pg_temp.expect_rejection('select public.save_profitability_projection(''20000000-0000-4000-8000-000000000001'', null, ''{}''::jsonb)', 'Manager projection write');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select pg_temp.expect_rejection('select public.get_profitability_projection(''20000000-0000-4000-8000-000000000001'', null)', 'Sales projection read');
select pg_temp.expect_rejection('select public.save_profitability_projection(''20000000-0000-4000-8000-000000000001'', null, ''{}''::jsonb)', 'Sales projection write');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select pg_temp.expect_rejection('select public.get_profitability_projection(''20000000-0000-4000-8000-000000000001'', null)', 'Crew Lead projection read');
select pg_temp.expect_rejection('select public.save_profitability_projection(''20000000-0000-4000-8000-000000000001'', null, ''{}''::jsonb)', 'Crew Lead projection write');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select pg_temp.expect_rejection('select public.get_profitability_projection(''20000000-0000-4000-8000-000000000001'', null)', 'Scrubz Technician projection read');
select pg_temp.expect_rejection('select public.save_profitability_projection(''20000000-0000-4000-8000-000000000001'', null, ''{}''::jsonb)', 'Scrubz Technician projection write');

-- A Master Admin may update the owned public record, but any profitability JSON injection is rejected by the trigger.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select pg_temp.expect_rejection($$update public.estimates set result = jsonb_set(result, '{profitability}', '{"version":1}'::jsonb) where id = '20000000-0000-4000-8000-000000000001'$$, 'Estimate result injection');
select pg_temp.expect_rejection($$update public.estimates set approved_pricing_snapshot = jsonb_set(approved_pricing_snapshot, '{result,profitability}', '{"version":1}'::jsonb, true) where id = '20000000-0000-4000-8000-000000000001'$$, 'Estimate nested snapshot injection');
select pg_temp.expect_rejection($$update public.proposals set client_delivery_snapshot = jsonb_set(client_delivery_snapshot, '{result}', '{"profitability":{"version":1}}'::jsonb, true) where id = '30000000-0000-4000-8000-000000000001'$$, 'Proposal nested customer snapshot injection');

-- The migration preserves customer-visible pricing and removes the confidential fields from all broad JSON snapshots.
reset role;
do $$
begin
  if (select result->>'customerTotal' from public.estimates where id = '20000000-0000-4000-8000-000000000001') <> '500'
    or (select result ? 'profitability' from public.estimates where id = '20000000-0000-4000-8000-000000000001')
    or (select approved_pricing_snapshot->'result' ? 'profitability' from public.estimates where id = '20000000-0000-4000-8000-000000000001')
    or (select client_delivery_snapshot ? 'profitability' from public.proposals where id = '30000000-0000-4000-8000-000000000001')
    or (select count(*) from public.profitability_projections) < 2 then
    raise exception 'Migration did not preserve public records while segregating private projections.';
  end if;
end $$;

rollback;
