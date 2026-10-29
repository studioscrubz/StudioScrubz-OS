\set ON_ERROR_STOP on

begin;

create function pg_temp.expect_rejection(p_sql text, p_message text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'Expected rejection: %', p_message;
end;
$$;

do $$
declare
  expected jsonb := '{"version":1,"overview":"","differentiators":[],"pastPerformance":[],"naicsCodes":[],"certifications":[],"uei":"","cageCode":"","serviceAreas":"","contactName":"","contactTitle":""}'::jsonb;
begin
  if (select corporate_capability_profile from public.business_settings limit 1) <> expected then
    raise exception 'The new profile did not receive the safe empty default.';
  end if;
  if not has_function_privilege('authenticated', 'public.get_corporate_capability_profile()', 'execute')
    or not has_function_privilege('authenticated', 'public.save_corporate_capability_profile(jsonb)', 'execute') then
    raise exception 'Authenticated callers cannot execute the profile RPCs.';
  end if;
  if has_function_privilege('anon', 'public.get_corporate_capability_profile()', 'execute')
    or has_function_privilege('anon', 'public.save_corporate_capability_profile(jsonb)', 'execute') then
    raise exception 'A public or anonymous role retained profile RPC execution.';
  end if;
  if has_function_privilege('authenticated', 'public.validate_corporate_capability_profile(jsonb)', 'execute')
    or has_function_privilege('anon', 'public.validate_corporate_capability_profile(jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.normalize_corporate_capability_profile()', 'execute')
    or has_function_privilege('anon', 'public.normalize_corporate_capability_profile()', 'execute') then
    raise exception 'The private validation helper is executable outside its owner.';
  end if;
end;
$$;

-- The three document-authoring roles can read the narrowly scoped profile.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$ begin
  if public.get_corporate_capability_profile()->>'overview' <> '' then
    raise exception 'Master Admin did not receive the default profile.';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select public.get_corporate_capability_profile();

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select public.get_corporate_capability_profile();
do $$ begin
  if exists (select 1 from public.business_settings) then
    raise exception 'Sales bypassed the narrow getter and read the protected Business Settings row.';
  end if;
end $$;

-- Manager, inactive Sales, and unauthenticated callers cannot read the profile.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select pg_temp.expect_rejection('select public.get_corporate_capability_profile()', 'Manager profile read');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select pg_temp.expect_rejection('select public.get_corporate_capability_profile()', 'inactive Sales profile read');
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_rejection('select public.get_corporate_capability_profile()', 'unauthenticated profile read');

-- Administrator and Sales can read but cannot save.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select pg_temp.expect_rejection(
  $$select public.save_corporate_capability_profile('{"version":1,"overview":"Administrator edit","differentiators":[],"pastPerformance":[],"naicsCodes":[],"certifications":[],"uei":"","cageCode":"","serviceAreas":"","contactName":"","contactTitle":""}'::jsonb)$$,
  'Administrator profile save'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select pg_temp.expect_rejection(
  $$select public.save_corporate_capability_profile('{"version":1,"overview":"Sales edit","differentiators":[],"pastPerformance":[],"naicsCodes":[],"certifications":[],"uei":"","cageCode":"","serviceAreas":"","contactName":"","contactTitle":""}'::jsonb)$$,
  'Sales profile save'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select pg_temp.expect_rejection(
  $$select public.save_corporate_capability_profile('{"version":1,"overview":"Manager edit","differentiators":[],"pastPerformance":[],"naicsCodes":[],"certifications":[],"uei":"","cageCode":"","serviceAreas":"","contactName":"","contactTitle":""}'::jsonb)$$,
  'Manager profile save'
);

-- Master Admin can save verified facts. The database trims text, preserves list
-- order, and normalizes UEI/CAGE casing before returning and storing the value.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.save_corporate_capability_profile(
  '{
    "version":1,
    "overview":"  Commercial cleaning for managed facilities.  ",
    "differentiators":["Documented completion", "Equipment-conscious service"],
    "pastPerformance":["Verified reference available on request"],
    "naicsCodes":["561720"],
    "certifications":["Verified small-business certification"],
    "uei":"abc123def456",
    "cageCode":"1a2b3",
    "serviceAreas":"  Greater Los Angeles  ",
    "contactName":"  Capability Desk  ",
    "contactTitle":"  Vendor Relations  "
  }'::jsonb
);

do $$
declare saved jsonb := public.get_corporate_capability_profile();
begin
  if saved->>'overview' <> 'Commercial cleaning for managed facilities.'
    or saved->>'uei' <> 'ABC123DEF456'
    or saved->>'cageCode' <> '1A2B3'
    or saved->>'serviceAreas' <> 'Greater Los Angeles'
    or saved->'naicsCodes' <> '["561720"]'::jsonb then
    raise exception 'The profile was not normalized or returned correctly: %', saved;
  end if;
  if saved is distinct from (select corporate_capability_profile from public.business_settings limit 1) then
    raise exception 'The getter did not return the authoritative stored profile.';
  end if;
end;
$$;

-- Strict validation rejects missing keys, unsupported fields, malformed IDs,
-- invalid list items, duplicate claims, overlong text, and oversized lists.
select pg_temp.expect_rejection(
  $$select public.save_corporate_capability_profile('{"version":1}'::jsonb)$$,
  'missing fields'
);
select pg_temp.expect_rejection(
  $$select public.save_corporate_capability_profile('{"version":1,"overview":"","differentiators":[],"pastPerformance":[],"naicsCodes":[],"certifications":[],"uei":"","cageCode":"","serviceAreas":"","contactName":"","contactTitle":"","unverifiedClaim":"yes"}'::jsonb)$$,
  'unsupported field'
);
select pg_temp.expect_rejection(
  $$select public.save_corporate_capability_profile('{"version":1,"overview":"","differentiators":[],"pastPerformance":[],"naicsCodes":["56-1720"],"certifications":[],"uei":"TOO-SHORT","cageCode":"","serviceAreas":"","contactName":"","contactTitle":""}'::jsonb)$$,
  'malformed identifiers'
);
select pg_temp.expect_rejection(
  $$select public.save_corporate_capability_profile('{"version":1,"overview":"","differentiators":["Same claim"," same claim "],"pastPerformance":[],"naicsCodes":[],"certifications":[],"uei":"","cageCode":"","serviceAreas":"","contactName":"","contactTitle":""}'::jsonb)$$,
  'duplicate claims'
);
select pg_temp.expect_rejection(
  $$select public.save_corporate_capability_profile(jsonb_build_object('version',1,'overview',repeat('x',2501),'differentiators','[]'::jsonb,'pastPerformance','[]'::jsonb,'naicsCodes','[]'::jsonb,'certifications','[]'::jsonb,'uei','','cageCode','','serviceAreas','','contactName','','contactTitle',''))$$,
  'overlong overview'
);
select pg_temp.expect_rejection(
  $$select public.save_corporate_capability_profile(jsonb_build_object('version',1,'overview','','differentiators',(select jsonb_agg('claim ' || n) from generate_series(1,13) n),'pastPerformance','[]'::jsonb,'naicsCodes','[]'::jsonb,'certifications','[]'::jsonb,'uei','','cageCode','','serviceAreas','','contactName','','contactTitle',''))$$,
  'oversized differentiator list'
);

do $$ begin
  if public.get_corporate_capability_profile()->>'uei' <> 'ABC123DEF456' then
    raise exception 'A rejected profile save changed the previously stored facts.';
  end if;
end $$;

-- Invalid direct writes are also blocked by the table constraint.
reset role;
select pg_temp.expect_rejection(
  $$update public.business_settings set corporate_capability_profile = '{"version":1}'::jsonb$$,
  'invalid direct table update'
);

rollback;
