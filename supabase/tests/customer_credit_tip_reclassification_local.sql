-- LOCAL-ONLY. Run after invoice_financial_invariant_local.sql and the migration.
\set ON_ERROR_STOP on
begin;
create temporary table credit_tip_results(name text primary key, passed boolean, detail text);

select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='test@example.invalid' limit 1),true);

do $$
declare actor_id uuid; saved_role text; credit_row public.customer_credits; payment_before public.payments;
  invoice_before public.invoices; event_row public.customer_credit_tip_reclassification_events;
  wrong_client_payment_id uuid := 'f4000000-0000-0000-0000-000000000010';
  wrong_client_credit_id uuid := 'f4000000-0000-0000-0000-000000000011';
begin
  select id into actor_id from auth.users where email='test@example.invalid' limit 1;
  select role into saved_role from public.user_profiles where id=actor_id;
  select * into credit_row from public.customer_credits where source_payment_id=(select id from public.payments where idempotency_key='f3000000-0000-0000-0000-000000000022');
  select * into payment_before from public.payments where id=credit_row.source_payment_id;
  select * into invoice_before from public.invoices where id=credit_row.source_invoice_id;

  update public.user_profiles set role='Administrator' where id=actor_id;
  begin
    perform public.reclassify_customer_credit_as_tip(credit_row.id,credit_row.source_payment_id,'Unauthorized correction attempt','f4000000-0000-0000-0000-000000000001');
    insert into credit_tip_results values('unauthorized',false,'accepted');
  exception when insufficient_privilege then insert into credit_tip_results values('unauthorized',true,sqlerrm); end;
  update public.user_profiles set role='Master Admin' where id=actor_id;

  insert into public.payments(id,invoice_id,client_id,amount,received_amount,unapplied_amount,payment_date,payment_method)
  values(wrong_client_payment_id,credit_row.source_invoice_id,null,0,1,1,current_date,'Cash');
  insert into public.customer_credits(id,client_id,customer_name_snapshot,source_invoice_id,source_payment_id,original_amount,remaining_amount,created_by_name)
  values(wrong_client_credit_id,null,'Wrong Client Fixture',credit_row.source_invoice_id,wrong_client_payment_id,1,1,'Test Fixture');
  begin
    perform public.reclassify_customer_credit_as_tip(wrong_client_credit_id,wrong_client_payment_id,'Wrong client ownership regression','f4000000-0000-0000-0000-000000000012');
    insert into credit_tip_results values('wrong_client',false,'accepted');
  exception when others then insert into credit_tip_results values('wrong_client',true,sqlerrm); end;

  begin
    perform public.reclassify_customer_credit_as_tip(credit_row.id,'00000000-0000-0000-0000-000000000001','Wrong source Payment regression','f4000000-0000-0000-0000-000000000002');
    insert into credit_tip_results values('wrong_payment',false,'accepted');
  exception when others then insert into credit_tip_results values('wrong_payment',true,sqlerrm); end;

  select * into event_row from public.reclassify_customer_credit_as_tip(credit_row.id,credit_row.source_payment_id,'Customer confirmed excess as tip','f4000000-0000-0000-0000-000000000003');
  insert into credit_tip_results
  select 'full_reclassification',p.received_amount=payment_before.received_amount and p.amount=payment_before.amount
    and p.unapplied_amount=0 and p.tip_amount=payment_before.tip_amount+credit_row.remaining_amount
    and c.remaining_amount=0 and c.status='Reclassified as Tip'
    and i.total=invoice_before.total and i.amount_paid=invoice_before.amount_paid and i.balance_due=invoice_before.balance_due,
    format('received=%s applied=%s tip=%s credit=%s',p.received_amount,p.amount,p.tip_amount,c.remaining_amount)
  from public.payments p join public.customer_credits c on c.source_payment_id=p.id join public.invoices i on i.id=p.invoice_id
  where p.id=credit_row.source_payment_id;

  perform public.reclassify_customer_credit_as_tip(credit_row.id,credit_row.source_payment_id,'Customer confirmed excess as tip','f4000000-0000-0000-0000-000000000003');
  insert into credit_tip_results select 'idempotent_retry',count(*)=1,format('events=%s',count(*)) from public.customer_credit_tip_reclassification_events where credit_id=credit_row.id;

  begin
    perform public.reclassify_customer_credit_as_tip(credit_row.id,credit_row.source_payment_id,'Second correction must fail','f4000000-0000-0000-0000-000000000004');
    insert into credit_tip_results values('repeat_new_key',false,'accepted');
  exception when others then insert into credit_tip_results values('repeat_new_key',true,sqlerrm); end;
  update public.user_profiles set role=saved_role where id=actor_id;
end $$;

select * from credit_tip_results order by name;
do $$ begin if exists(select 1 from credit_tip_results where not passed) then raise exception 'Customer Credit tip regression failed'; end if; end $$;
rollback;
