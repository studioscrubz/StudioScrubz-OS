\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='test@example.invalid' limit 1),true);
select public.reclassify_customer_credit_as_tip(
  (select id from public.customer_credits where status='Unapplied' and remaining_amount>0 order by created_at limit 1),
  (select source_payment_id from public.customer_credits where status='Unapplied' and remaining_amount>0 order by created_at limit 1),
  'Concurrent correction session A',
  'f4000000-0000-0000-0000-00000000000a'
);
select pg_sleep(3);
commit;
