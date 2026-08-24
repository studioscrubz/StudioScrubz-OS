-- StudioScrubz OS: Square-hosted checkout tipping support.
-- REVIEW ONLY. Do not execute automatically.

begin;

alter table public.payments
  add column if not exists tip_amount numeric not null default 0,
  add column if not exists gross_amount numeric;

alter table public.payments drop constraint if exists payments_tip_amount_check;
alter table public.payments add constraint payments_tip_amount_check
  check (tip_amount >= 0);

alter table public.payments drop constraint if exists payments_gross_amount_check;
alter table public.payments add constraint payments_gross_amount_check check (
  gross_amount is null
  or (
    gross_amount >= amount
    and round(gross_amount, 2) = round(amount + tip_amount, 2)
  )
);

comment on column public.payments.amount is
  'Amount applied to Invoice principal. Tips must not be included.';
comment on column public.payments.tip_amount is
  'Provider-authoritative voluntary gratuity; excluded from Invoice principal and balance.';
comment on column public.payments.gross_amount is
  'Total provider-collected amount, including gratuity. NULL for legacy/manual Payments when unavailable.';

create or replace function public.record_square_invoice_payment_v2(
  p_attempt_id uuid,
  p_square_payment_id text,
  p_square_order_id text,
  p_service_amount_cents bigint,
  p_tip_amount_cents bigint,
  p_gross_amount_cents bigint,
  p_currency text,
  p_paid_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.square_checkout_attempts;
  invoice_row public.invoices;
  existing_payment public.payments;
  authoritative_paid numeric;
  service_amount numeric;
  tip_amount numeric;
  gross_amount numeric;
  remaining numeric;
  payment_row public.payments;
begin
  if p_service_amount_cents is null or p_service_amount_cents <= 0
    or p_tip_amount_cents is null or p_tip_amount_cents < 0
    or p_gross_amount_cents is null or p_gross_amount_cents <= 0
    or p_gross_amount_cents <> p_service_amount_cents + p_tip_amount_cents then
    raise exception 'Square Payment amounts are invalid.';
  end if;

  select * into attempt_row
  from public.square_checkout_attempts
  where id = p_attempt_id
  for update;
  if not found then raise exception 'Square checkout attempt not found.'; end if;

  select * into invoice_row
  from public.invoices
  where id = attempt_row.invoice_id
  for update;
  if not found then raise exception 'Invoice not found.'; end if;

  service_amount := round(p_service_amount_cents::numeric / 100, 2);
  tip_amount := round(p_tip_amount_cents::numeric / 100, 2);
  gross_amount := round(p_gross_amount_cents::numeric / 100, 2);

  select * into existing_payment
  from public.payments
  where payment_provider = 'Square'
    and provider_payment_id = p_square_payment_id;
  if found then
    if existing_payment.invoice_id is distinct from invoice_row.id then
      raise exception 'Square Payment is already associated with another Invoice.';
    end if;
    if round(existing_payment.amount, 2) is distinct from service_amount
      or (existing_payment.gross_amount is not null and (
        round(existing_payment.tip_amount, 2) is distinct from tip_amount
        or round(existing_payment.gross_amount, 2) is distinct from gross_amount
      )) then
      raise exception 'Square Payment financial details do not match the existing Payment record.';
    end if;
    return jsonb_build_object('created', false, 'conflict', false, 'payment_id', existing_payment.id);
  end if;

  if attempt_row.square_order_id is distinct from p_square_order_id then
    raise exception 'Square order does not match the checkout attempt.';
  end if;
  if attempt_row.amount_cents is distinct from p_service_amount_cents then
    update public.square_checkout_attempts
    set status = 'Conflict', square_payment_id = p_square_payment_id, completed_at = p_paid_at,
      conflict_reason = 'Square completed service amount does not match the authoritative checkout amount.', updated_at = now()
    where id = p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;
  if attempt_row.currency is distinct from p_currency or p_currency <> 'USD' then
    update public.square_checkout_attempts
    set status = 'Conflict', square_payment_id = p_square_payment_id, completed_at = p_paid_at,
      conflict_reason = 'Square completed payment currency does not match the Invoice currency.', updated_at = now()
    where id = p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;
  if invoice_row.archived_at is not null or invoice_row.status in ('Cancelled', 'Archived') then
    update public.square_checkout_attempts
    set status = 'Conflict', square_payment_id = p_square_payment_id, completed_at = p_paid_at,
      conflict_reason = 'Square completed payment for a cancelled or archived Invoice.', updated_at = now()
    where id = p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;

  select round(coalesce(sum(amount), 0), 2) into authoritative_paid
  from public.payments
  where invoice_id = invoice_row.id;
  remaining := greatest(round(invoice_row.total - authoritative_paid, 2), 0);
  if service_amount > remaining then
    update public.square_checkout_attempts
    set status = 'Conflict', square_payment_id = p_square_payment_id, completed_at = p_paid_at,
      conflict_reason = 'Square completed service amount exceeds the current authoritative Invoice balance; manual reconciliation or refund is required.', updated_at = now()
    where id = p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;

  insert into public.payments (
    invoice_id, client_id, job_id, amount, tip_amount, gross_amount,
    payment_date, payment_method, reference_number, notes,
    payment_provider, provider_payment_id, provider_order_id
  ) values (
    invoice_row.id, invoice_row.client_id, invoice_row.job_id,
    service_amount, tip_amount, gross_amount,
    (p_paid_at at time zone 'UTC')::date, 'Credit Card', p_square_payment_id,
    'Verified Square online payment', 'Square', p_square_payment_id, p_square_order_id
  )
  returning * into payment_row;

  select round(coalesce(sum(amount), 0), 2) into authoritative_paid
  from public.payments
  where invoice_id = invoice_row.id;
  update public.invoices
  set amount_paid = authoritative_paid,
    balance_due = greatest(round(total - authoritative_paid, 2), 0),
    status = case
      when authoritative_paid >= round(total, 2) and total > 0 then 'Paid'
      when authoritative_paid > 0 then 'Partially Paid'
      else 'Open'
    end,
    paid_at = case
      when authoritative_paid >= round(total, 2) and total > 0 then coalesce(paid_at, p_paid_at)
      else null
    end
  where id = invoice_row.id;

  update public.square_checkout_attempts
  set status = 'Completed', square_payment_id = p_square_payment_id,
    completed_at = p_paid_at, conflict_reason = null, updated_at = now()
  where id = p_attempt_id;

  return jsonb_build_object('created', true, 'conflict', false, 'payment_id', payment_row.id);
end;
$$;

revoke all on function public.record_square_invoice_payment_v2(uuid,text,text,bigint,bigint,bigint,text,timestamptz)
from public, anon, authenticated;
grant execute on function public.record_square_invoice_payment_v2(uuid,text,text,bigint,bigint,bigint,text,timestamptz)
to service_role;

notify pgrst, 'reload schema';

commit;
