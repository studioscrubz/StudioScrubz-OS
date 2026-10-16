\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'test@example.invalid' limit 1), true);
select public.record_invoice_payment_v2(
  'f2000000-0000-0000-0000-000000000003', 300.00, current_date,
  'ACH', 'f3000000-0000-0000-0000-00000000000a', 'SYNTHETIC-CONCURRENCY', 'Synthetic concurrent payment'
);
select pg_sleep(3);
commit;
