\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='test@example.invalid' limit 1),true);
select public.reclassify_customer_credit_as_tip(
  (select id from public.customer_credits where status='Unapplied' and remaining_amount>0 order by created_at limit 1),
  (select source_payment_id from public.customer_credits where status='Unapplied' and remaining_amount>0 order by created_at limit 1),
  'Concurrent correction session B',
  'f4000000-0000-0000-0000-00000000000b'
);
rollback;
-- Expected: session B waits for A, then fails because the Credit is no longer Unapplied.
