-- Local-only regression for 20261015215053_invoice_overpayments_customer_credits.sql.
-- Run after invoice_financial_invariant_local.sql against a disposable database.
begin;
create temporary table invoice_overpayment_results(name text primary key, passed boolean, detail text);
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='test@example.invalid' limit 1),true);

select public.record_invoice_payment_v2('f2000000-0000-0000-0000-000000000001',500,current_date,'ACH','f3000000-0000-0000-0000-000000000001','OVERPAY-500','Overpayment regression');
insert into invoice_overpayment_results
select 'allocation',p.received_amount=500 and p.unapplied_amount=p.received_amount-p.amount,format('received=%s applied=%s credit=%s',p.received_amount,p.amount,p.unapplied_amount)
from public.payments p where p.idempotency_key='f3000000-0000-0000-0000-000000000001';
insert into invoice_overpayment_results
select 'credit',count(*)=1 and min(c.original_amount)=min(p.unapplied_amount),format('credits=%s',count(*))
from public.payments p join public.customer_credits c on c.source_payment_id=p.id where p.idempotency_key='f3000000-0000-0000-0000-000000000001';

select public.record_invoice_payment_v2('f2000000-0000-0000-0000-000000000001',500,current_date,'ACH','f3000000-0000-0000-0000-000000000001','OVERPAY-500','Overpayment regression');
insert into invoice_overpayment_results select 'retry',count(*)=1,format('payments=%s',count(*)) from public.payments where idempotency_key='f3000000-0000-0000-0000-000000000001';

do $$ begin
  begin perform public.record_invoice_payment_v2('f2000000-0000-0000-0000-000000000001',0,current_date,'Cash','f3000000-0000-0000-0000-000000000002',null,null); insert into invoice_overpayment_results values('zero',false,'accepted'); exception when others then insert into invoice_overpayment_results values('zero',true,sqlerrm); end;
  begin perform public.record_invoice_payment_v2('f2000000-0000-0000-0000-000000000001',-1,current_date,'Cash','f3000000-0000-0000-0000-000000000003',null,null); insert into invoice_overpayment_results values('negative',false,'accepted'); exception when others then insert into invoice_overpayment_results values('negative',true,sqlerrm); end;
  begin perform public.record_invoice_payment_v2('f2000000-0000-0000-0000-000000000001',501,current_date,'ACH','f3000000-0000-0000-0000-000000000001','OVERPAY-500','Overpayment regression'); insert into invoice_overpayment_results values('retry_conflict',false,'accepted changed payload'); exception when others then insert into invoice_overpayment_results values('retry_conflict',true,sqlerrm); end;
  begin perform public.record_invoice_payment_v2('f2000000-0000-0000-0000-000000000003',500,current_date,'ACH','f3000000-0000-0000-0000-000000000001','OVERPAY-500','Overpayment regression'); insert into invoice_overpayment_results values('cross_invoice_retry',false,'accepted reused key'); exception when others then insert into invoice_overpayment_results values('cross_invoice_retry',true,sqlerrm); end;
  begin update public.payments set voided_at=now() where idempotency_key='f3000000-0000-0000-0000-000000000001'; insert into invoice_overpayment_results values('credit_source_void',false,'voided source'); exception when others then insert into invoice_overpayment_results values('credit_source_void',true,sqlerrm); end;
  begin delete from public.payments where idempotency_key='f3000000-0000-0000-0000-000000000001'; insert into invoice_overpayment_results values('credit_source_delete',false,'deleted source'); exception when others then insert into invoice_overpayment_results values('credit_source_delete',true,sqlerrm); end;
  begin update public.customer_credits set remaining_amount=0 where source_payment_id=(select id from public.payments where idempotency_key='f3000000-0000-0000-0000-000000000001'); insert into invoice_overpayment_results values('credit_mutation',false,'changed credit'); exception when others then insert into invoice_overpayment_results values('credit_mutation',true,sqlerrm); end;
end $$;
insert into public.payments(id,amount,payment_date,payment_method) values('f3000000-0000-0000-0000-000000000099',1,current_date,'Cash');
insert into invoice_overpayment_results select 'historical_null_received',received_amount is null and unapplied_amount=0,format('received=%s credit=%s',received_amount,unapplied_amount) from public.payments where id='f3000000-0000-0000-0000-000000000099';
select * from invoice_overpayment_results order by name;
do $$ begin if exists(select 1 from invoice_overpayment_results where not passed) then raise exception 'Invoice overpayment regression failed'; end if; end $$;
rollback;
