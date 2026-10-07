-- Align manual Invoice payment authorization with the application permission map.
-- "Main Admin" is the canonical Master Admin role; Administrator is the only
-- additional existing role with invoices.recordPayment authority.
create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_reference_number text default null,
  p_notes text default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  payment_row public.payments;
  normalized_amount numeric;
  authoritative_paid numeric;
  new_balance numeric;
  new_status text;
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin', 'Administrator']) then
    raise exception 'Payment recording permission is required.' using errcode = '42501';
  end if;

  select * into invoice_row
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then raise exception 'Invoice not found.'; end if;
  if invoice_row.archived_at is not null
    or invoice_row.status in ('Archived', 'Cancelled') then
    raise exception 'This Invoice cannot receive payments.';
  end if;

  normalized_amount := round(p_amount, 2);
  if normalized_amount is null or normalized_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if p_payment_date is null then raise exception 'Payment date is required.'; end if;
  if p_payment_method is null or p_payment_method not in (
    'Cash', 'Check', 'Credit Card', 'Debit Card', 'ACH', 'Zelle',
    'Venmo', 'Cash App', 'Apple Pay', 'Other'
  ) then raise exception 'Choose a valid payment method.'; end if;

  select round(coalesce(sum(amount), 0), 2) into authoritative_paid
  from public.payments
  where invoice_id = invoice_row.id and voided_at is null;

  if authoritative_paid + normalized_amount > round(invoice_row.total, 2) then
    raise exception 'Payment exceeds the remaining Invoice balance.';
  end if;

  insert into public.payments (
    invoice_id, client_id, job_id, amount, payment_date, payment_method,
    reference_number, notes
  ) values (
    invoice_row.id, invoice_row.client_id, invoice_row.job_id,
    normalized_amount, p_payment_date, p_payment_method,
    nullif(btrim(p_reference_number), ''), nullif(btrim(p_notes), '')
  ) returning * into payment_row;

  select round(coalesce(sum(amount), 0), 2) into authoritative_paid
  from public.payments
  where invoice_id = invoice_row.id and voided_at is null;

  new_balance := greatest(round(invoice_row.total - authoritative_paid, 2), 0);
  new_status := case
    when authoritative_paid >= round(invoice_row.total, 2) and invoice_row.total > 0 then 'Paid'
    when authoritative_paid > 0 then 'Partially Paid'
    when invoice_row.status = 'Draft' then 'Draft'
    when invoice_row.status = 'Sent' then 'Sent'
    else 'Open'
  end;

  update public.invoices
  set amount_paid = authoritative_paid,
      balance_due = new_balance,
      status = new_status,
      paid_at = case
        when new_status = 'Paid' then coalesce(invoice_row.paid_at, now())
        else null
      end
  where id = invoice_row.id;

  return payment_row;
end;
$$;

revoke all on function public.record_invoice_payment(uuid, numeric, date, text, text, text)
from public, anon, authenticated;
grant execute on function public.record_invoice_payment(uuid, numeric, date, text, text, text)
to authenticated;

