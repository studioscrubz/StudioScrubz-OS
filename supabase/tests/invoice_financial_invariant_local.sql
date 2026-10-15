-- LOCAL-ONLY synthetic validation for 20260827021517_invoice_financial_invariant.sql.
-- Leaves clearly synthetic fixtures in the local database for inspection.

\set ON_ERROR_STOP on

begin;

create temporary table financial_test_results (
  test_name text primary key,
  passed boolean not null,
  detail text not null
) on commit preserve rows;

insert into public.clients (
  id, client_type, first_name, last_name, company_name,
  email, status
) values (
  'f1000000-0000-0000-0000-000000000001', 'Residential',
  'Financial', 'Test Client', null, 'financial-test@example.invalid', 'Active'
);

insert into public.properties (
  id, client_id, property_name, property_type,
  address, city, state, zip
) values (
  'f1000000-0000-0000-0000-000000000002',
  'f1000000-0000-0000-0000-000000000001', 'Financial Test Property',
  'Residential', '100 Test Only Lane', 'Fixture City', 'CA', '00000'
);

insert into public.proposals (
  id, proposal_number, client_id, property_id, division, frequency,
  client_name, property_name, status
) values (
  'f1000000-0000-0000-0000-000000000003', 'PR-FIN-LOCAL-001',
  'f1000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000002',
  'Residential', 'One-Time', 'Financial Test Client', 'Financial Test Property', 'Draft'
);

insert into public.jobs (
  id, job_number, proposal_id, client_id, property_id, division,
  client_name, property_name, service_name, status, price, balance,
  completed_at
) values (
  'f1000000-0000-0000-0000-000000000004', 'JOB-FIN-LOCAL-001',
  'f1000000-0000-0000-0000-000000000003',
  'f1000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000002',
  'Residential', 'Financial Test Client', 'Financial Test Property',
  'Synthetic Job Service', 'Completed', 125.50, 125.50, now()
);

insert into public.service_agreements (
  id, agreement_number, client_id, property_id, proposal_id, division,
  agreement_name, service_name, frequency, start_date, billing_type,
  billing_amount, status
) values (
  'f1000000-0000-0000-0000-000000000005', 'AGR-FIN-LOCAL-001',
  'f1000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000002',
  'f1000000-0000-0000-0000-000000000003',
  'Residential', 'Synthetic Weekly Agreement', 'Synthetic Weekly Service',
  'Weekly', current_date, 'Weekly', 75.00, 'Active'
);

insert into public.invoices (
  id, invoice_number, client_id, property_id, client_name, property_name,
  service_name, status, line_items, subtotal, discount, tax, total,
  amount_paid, balance_due
) values (
  'f2000000-0000-0000-0000-000000000001', 'INV-FIN-BASIC-LOCAL',
  'f1000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000002',
  'Financial Test Client', 'Financial Test Property', 'Synthetic Basic Invoice',
  'Open', '[{"description":"Synthetic service","quantity":1,"rate":500,"amount":500}]',
  500.00, 0.00, 0.00, 500.00, 0.00, 500.00
);

insert into financial_test_results
select 'basic_invoice', amount_paid = 0 and balance_due = 500,
  format('paid=%s balance=%s status=%s', amount_paid, balance_due, status)
from public.invoices where id = 'f2000000-0000-0000-0000-000000000001';

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where email = 'test@example.invalid' limit 1),
  true
);

select public.record_invoice_payment_v2(
  'f2000000-0000-0000-0000-000000000001', 200.00, current_date,
  'Credit Card', 'f3000000-0000-0000-0000-000000000020', 'SYNTHETIC-PARTIAL', 'Synthetic partial payment'
);

insert into financial_test_results
select 'partial_payment', amount_paid = 200 and balance_due = 300 and status = 'Partially Paid',
  format('paid=%s balance=%s status=%s', amount_paid, balance_due, status)
from public.invoices where id = 'f2000000-0000-0000-0000-000000000001';

select public.record_invoice_payment_v2(
  'f2000000-0000-0000-0000-000000000001', 300.00, current_date,
  'ACH', 'f3000000-0000-0000-0000-000000000021', 'SYNTHETIC-FULL', 'Synthetic final payment'
);

insert into financial_test_results
select 'full_payment', amount_paid = 500 and balance_due = 0 and status = 'Paid' and paid_at is not null,
  format('paid=%s balance=%s status=%s paid_at=%s', amount_paid, balance_due, status, paid_at)
from public.invoices where id = 'f2000000-0000-0000-0000-000000000001';

do $$
begin
  begin
    perform public.record_invoice_payment_v2(
      'f2000000-0000-0000-0000-000000000001', 1.00, current_date,
      'Cash', 'f3000000-0000-0000-0000-000000000022', 'SYNTHETIC-OVERPAY', null
    );
    insert into financial_test_results
    select 'overpayment', p.amount = 0 and p.received_amount = 1 and p.unapplied_amount = 1,
      format('applied=%s received=%s credit=%s',p.amount,p.received_amount,p.unapplied_amount)
    from public.payments p where p.idempotency_key = 'f3000000-0000-0000-0000-000000000022';
  exception when others then
    insert into financial_test_results values ('overpayment', false, sqlerrm);
  end;
end
$$;

do $$
begin
  begin
    perform public.record_invoice_payment_v2(
      'f2000000-0000-0000-0000-000000000001', -1.00, current_date,
      'Cash', 'f3000000-0000-0000-0000-000000000023', 'SYNTHETIC-NEGATIVE', null
    );
    insert into financial_test_results values ('negative_payment', false, 'Unexpectedly accepted negative payment.');
  exception when others then
    insert into financial_test_results values ('negative_payment', true, sqlerrm);
  end;
end
$$;

do $$
declare
  field_name text;
  statement_text text;
begin
  foreach field_name in array array['subtotal', 'discount', 'tax', 'total', 'amount_paid', 'balance_due'] loop
    statement_text := format($sql$
      insert into public.invoices (
        invoice_number, client_id, property_id, status, subtotal, discount,
        tax, total, amount_paid, balance_due
      ) values (
        %L, 'f1000000-0000-0000-0000-000000000001',
        'f1000000-0000-0000-0000-000000000002', 'Open',
        %s, %s, %s, %s, %s, %s
      )
    $sql$,
      'INV-FIN-NEG-' || field_name,
      case when field_name = 'subtotal' then '-1' else '100' end,
      case when field_name = 'discount' then '-1' else '0' end,
      case when field_name = 'tax' then '-1' else '0' end,
      case when field_name = 'total' then '-1' else '100' end,
      case when field_name = 'amount_paid' then '-1' else '0' end,
      case when field_name = 'balance_due' then '-1' else '100' end
    );
    begin
      execute statement_text;
      insert into financial_test_results values ('negative_' || field_name, false, 'Unexpectedly accepted negative value.');
    exception when others then
      insert into financial_test_results values ('negative_' || field_name, true, sqlerrm);
    end;
  end loop;
end
$$;

do $$
begin
  begin
    update public.invoices
    set balance_due = 50
    where id = 'f2000000-0000-0000-0000-000000000001';
    insert into financial_test_results values ('direct_balance_manipulation', false, 'Unexpectedly changed balance.');
  exception when others then
    insert into financial_test_results values ('direct_balance_manipulation', true, sqlerrm);
  end;

  begin
    update public.invoices
    set amount_paid = 50, balance_due = 450, status = 'Partially Paid', paid_at = null
    where id = 'f2000000-0000-0000-0000-000000000001';
    insert into financial_test_results values ('direct_paid_manipulation', false, 'Unexpectedly changed paid amount.');
  exception when others then
    insert into financial_test_results values ('direct_paid_manipulation', true, sqlerrm);
  end;
end
$$;

do $$
declare
  payment_id uuid;
begin
  select id into payment_id from public.payments
  where invoice_id = 'f2000000-0000-0000-0000-000000000001'
  order by created_at limit 1;

  begin
    update public.payments set notes = 'Unauthorized mutation' where id = payment_id;
    insert into financial_test_results values ('payment_update_immutable', false, 'Unexpectedly updated Payment history.');
  exception when others then
    insert into financial_test_results values ('payment_update_immutable', true, sqlerrm);
  end;

  begin
    delete from public.payments where id = payment_id;
    insert into financial_test_results values ('payment_delete_immutable', false, 'Unexpectedly deleted Payment history.');
  exception when others then
    insert into financial_test_results values ('payment_delete_immutable', true, sqlerrm);
  end;
end
$$;

insert into public.invoices (
  id, invoice_number, client_id, property_id, status, subtotal, discount,
  tax, total, amount_paid, balance_due
) values (
  'f2000000-0000-0000-0000-000000000002', 'INV-FIN-SQUARE-LOCAL',
  'f1000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000002',
  'Open', 100.00, 0.00, 0.00, 100.00, 0.00, 100.00
);

insert into public.square_checkout_attempts (
  id, invoice_id, idempotency_key, square_environment, square_order_id,
  amount_cents, currency, status
) values (
  'f3000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000002',
  'synthetic-local-idempotency-001', 'sandbox', 'synthetic-square-order-001',
  10000, 'USD', 'Pending'
);

create temporary table square_first_result as
select public.record_square_invoice_payment_v2(
  'f3000000-0000-0000-0000-000000000001',
  'synthetic-square-payment-001', 'synthetic-square-order-001',
  10000, 2500, 12500, 'USD', now()
) as result;

insert into financial_test_results
select 'square_tip',
  invoice.amount_paid = 100 and invoice.balance_due = 0 and invoice.status = 'Paid'
    and payment.amount = 100 and payment.tip_amount = 25 and payment.gross_amount = 125,
  format('invoice_paid=%s balance=%s service=%s tip=%s gross=%s',
    invoice.amount_paid, invoice.balance_due, payment.amount, payment.tip_amount, payment.gross_amount)
from public.invoices invoice
join public.payments payment on payment.invoice_id = invoice.id
where invoice.id = 'f2000000-0000-0000-0000-000000000002';

create temporary table square_duplicate_result as
select public.record_square_invoice_payment_v2(
  'f3000000-0000-0000-0000-000000000001',
  'synthetic-square-payment-001', 'synthetic-square-order-001',
  10000, 2500, 12500, 'USD', now()
) as result;

insert into financial_test_results
select 'duplicate_square_payment',
  (select count(*) from public.payments where provider_payment_id = 'synthetic-square-payment-001') = 1
    and (result ->> 'created')::boolean = false,
  format('payment_count=%s created=%s',
    (select count(*) from public.payments where provider_payment_id = 'synthetic-square-payment-001'),
    result ->> 'created')
from square_duplicate_result;

create temporary table recurring_result as
select public.create_contract_agreement_invoice(
  'f1000000-0000-0000-0000-000000000005', current_date, null
) as invoice;

insert into financial_test_results
select 'recurring_contract_invoice',
  (invoice).subtotal = 75 and (invoice).total = 75
    and (invoice).amount_paid = 0 and (invoice).balance_due = 75,
  format('subtotal=%s total=%s paid=%s balance=%s',
    (invoice).subtotal, (invoice).total, (invoice).amount_paid, (invoice).balance_due)
from recurring_result;

create temporary table job_invoice_result as
select public.create_completed_job_invoice(
  'f1000000-0000-0000-0000-000000000004'
) as result;

insert into financial_test_results
select 'job_generated_invoice',
  invoice.subtotal = 125.50 and invoice.total = 125.50
    and invoice.amount_paid = 0 and invoice.balance_due = 125.50,
  format('subtotal=%s total=%s paid=%s balance=%s',
    invoice.subtotal, invoice.total, invoice.amount_paid, invoice.balance_due)
from job_invoice_result generated
join public.invoices invoice on invoice.id = (generated.result ->> 'invoice_id')::uuid;

commit;

select test_name, passed, detail
from financial_test_results
order by test_name;

select count(*) filter (where passed) as passed,
       count(*) filter (where not passed) as failed,
       count(*) as total
from financial_test_results;
