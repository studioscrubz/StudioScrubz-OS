\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='test@example.invalid' limit 1),true);
select public.record_invoice_payment_v2('f2000000-0000-0000-0000-000000000004',1,current_date,'Cash','f3000000-0000-0000-0000-00000000000c','CROSS-INVOICE','Cross-Invoice concurrency');
rollback;
