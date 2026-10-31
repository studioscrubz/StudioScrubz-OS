\set ON_ERROR_STOP on

-- Run this against a fresh database after profitability_travel_fixture.sql and before
-- the permanent migration application. It proves the migration is safe inside the
-- transaction wrapper used by the native PostgreSQL harness.
begin;
\ir ../migrations/20261030090000_integrated_profitability_travel_costing.sql
do $$
begin
  if to_regclass('public.profitability_projections') is null
    or to_regprocedure('public.get_profitability_projection(uuid,uuid)') is null
    or not exists (select 1 from pg_trigger where tgname = 'estimates_reject_general_profitability_json') then
    raise exception 'Migration objects were not created inside the transaction.';
  end if;
end $$;
rollback;

do $$
begin
  if to_regclass('public.profitability_projections') is not null
    or to_regprocedure('public.get_profitability_projection(uuid,uuid)') is not null
    or exists (select 1 from pg_trigger where tgname = 'estimates_reject_general_profitability_json') then
    raise exception 'External transaction rollback left profitability objects behind.';
  end if;
  if (select result ? 'profitability' from public.estimates where id = '20000000-0000-4000-8000-000000000001') is not true then
    raise exception 'External transaction rollback did not restore the original Estimate JSON.';
  end if;
end $$;
