alter table public.invoices
  add column deposit_requested boolean not null default false,
  add constraint invoices_deposit_minimum_total
    check (not deposit_requested or (total is not null and total > 500));

-- Serialize invoice changes with checkout creation. A previously issued Square
-- link can still be used, so changing the amount after issuance is unsafe.
create function private.protect_invoice_deposit_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.deposit_requested is distinct from old.deposit_requested
      or (old.deposit_requested and new.total is distinct from old.total))
    and (old.client_access_token is not null
      or exists (select 1 from public.payments where invoice_id = old.id and voided_at is null)
      or exists (select 1 from public.square_checkout_attempts where invoice_id = old.id
        and (status in ('Created', 'Pending') or square_order_id is not null))) then
    raise exception 'Deposit terms cannot change after the invoice link is created or payment has started.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_invoice_deposit_terms() from public, anon, authenticated;
create trigger protect_invoice_deposit_terms
before update of deposit_requested, total on public.invoices
for each row execute function private.protect_invoice_deposit_terms();

create function private.validate_square_invoice_deposit_amount()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  amount_paid numeric;
  expected_amount numeric;
begin
  select * into invoice_row from public.invoices where id = new.invoice_id for update;
  if invoice_row.deposit_requested then
    select coalesce(sum(amount), 0) into amount_paid from public.payments
      where invoice_id = new.invoice_id and voided_at is null;
    expected_amount := invoice_row.total - amount_paid;

    if invoice_row.archived_at is not null
      or invoice_row.status in ('Draft', 'Paid', 'Cancelled', 'Archived')
      or amount_paid < round(invoice_row.total * 0.25, 2)
      or expected_amount <= 0
      or new.amount_cents is distinct from round(expected_amount * 100) then
      raise exception 'The invoice payment amount changed.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.validate_square_invoice_deposit_amount() from public, anon, authenticated;
create trigger validate_square_invoice_deposit_amount
before insert on public.square_checkout_attempts
for each row execute function private.validate_square_invoice_deposit_amount();

create or replace function public.get_invoice_by_token(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'invoice_number', i.invoice_number, 'status', i.status,
    'issue_date', i.issue_date, 'due_date', i.due_date,
    'client_name', i.client_name, 'property_name', i.property_name,
    'service_name', i.service_name, 'job_number', j.job_number,
    'agreement_number', a.agreement_number,
    'contract_billing_type', i.contract_billing_type,
    'billing_period_start', i.billing_period_start,
    'is_consolidated', i.is_consolidated,
    'deposit_requested', i.deposit_requested,
    'zelle_deposit_recipient', case
      when i.deposit_requested and i.archived_at is null
        and i.status not in ('Draft', 'Paid', 'Cancelled', 'Archived')
        and i.amount_paid < round(i.total * 0.25, 2)
      then jsonb_build_object('name', b.post_construction_payment_recipient_name,
        'phone', b.post_construction_payment_recipient_phone)
    end,
    'job_lines', coalesce((
      select jsonb_agg(to_jsonb(line) - 'invoice_id' order by line.service_date_snapshot, line.job_number_snapshot)
      from public.invoice_job_lines line where line.invoice_id = i.id
    ), '[]'::jsonb),
    'line_items', coalesce(i.line_items, '[]'::jsonb),
    'subtotal', i.subtotal, 'discount', i.discount, 'tax', i.tax,
    'total', i.total, 'amount_paid', i.amount_paid, 'balance_due', i.balance_due,
    'terms', i.terms, 'customer_notes', i.customer_notes,
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
      'amount', p.amount,
      'received_amount', coalesce(p.received_amount, p.amount),
      'unapplied_amount', p.unapplied_amount,
      'tip_amount', p.tip_amount,
      'payment_date', p.payment_date,
      'payment_method', p.payment_method
    ) order by p.payment_date, p.created_at) from public.payments p
      where p.invoice_id = i.id and p.voided_at is null), '[]'::jsonb),
    'business_name', coalesce(b.business_name, 'StudioScrubz'),
    'tagline', b.tagline, 'business_email', b.business_email,
    'business_phone', b.business_phone, 'website', b.website,
    'address', b.address, 'city', b.city, 'state', b.state, 'zip', b.zip
  )
  from public.invoices i
  left join public.jobs j on j.id = i.job_id
  left join public.service_agreements a on a.id = i.service_agreement_id
  left join lateral (select * from public.business_settings limit 1) b on true
  where p_token is not null and length(p_token) >= 40
    and i.client_access_token = p_token
    and (i.client_access_token_expires_at is null or i.client_access_token_expires_at > now())
  limit 1;
$$;

notify pgrst, 'reload schema';
