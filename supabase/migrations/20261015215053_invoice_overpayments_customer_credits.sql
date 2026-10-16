-- Record manual Invoice overpayments without changing Invoice totals.
-- payments.amount remains the amount applied to the Invoice; received_amount
-- records the full tender and unapplied_amount is preserved as customer credit.
begin;

alter table public.payments
  add column received_amount numeric,
  add column unapplied_amount numeric not null default 0,
  add column recorded_by uuid references public.user_profiles(id) on delete set null,
  add column recorded_by_name text,
  add column idempotency_key uuid;

alter table public.payments drop constraint payments_amount_check;
alter table public.payments
  add constraint payments_amount_check check (amount >= 0),
  add constraint payments_received_amount_check check (received_amount is null or received_amount > 0),
  add constraint payments_unapplied_amount_check check (unapplied_amount >= 0),
  add constraint payments_received_allocation_check check (
    (received_amount is null and unapplied_amount = 0)
    or (received_amount is not null
      and round(received_amount, 2) = round(amount + unapplied_amount, 2))
  );

create unique index payments_idempotency_key_unique
  on public.payments(idempotency_key)
  where idempotency_key is not null;

create table public.customer_credits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  customer_name_snapshot text not null,
  source_invoice_id uuid not null references public.invoices(id) on delete restrict,
  source_payment_id uuid not null unique references public.payments(id) on delete restrict,
  original_amount numeric not null check (original_amount > 0),
  remaining_amount numeric not null check (remaining_amount >= 0 and remaining_amount <= original_amount),
  status text not null default 'Unapplied' check (status in ('Unapplied', 'Applied', 'Refunded', 'Voided')),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_by_name text not null,
  created_at timestamptz not null default now()
);

create index customer_credits_client_idx
  on public.customer_credits(client_id, created_at desc);
create index customer_credits_invoice_idx
  on public.customer_credits(source_invoice_id, created_at desc);

alter table public.customer_credits enable row level security;
revoke all on table public.customer_credits from public, anon, authenticated;
grant select on table public.customer_credits to authenticated;
create policy customer_credits_financial_admin_read
on public.customer_credits for select to authenticated
using (
  (select auth.uid()) is not null
  and public.has_any_role(array['Master Admin', 'Administrator'])
);

-- Credits are immutable until a future, explicitly audited apply/refund/void
-- workflow is introduced. In particular, their source Payment cannot be
-- changed, voided, reversed, or deleted independently of the Credit.
create function private.protect_unapplied_customer_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Unapplied customer Credit records are immutable.';
end;
$$;

create trigger customer_credits_prevent_mutation
before update or delete on public.customer_credits
for each row execute function private.protect_unapplied_customer_credit();

create function private.protect_customer_credit_source_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.customer_credits credit
    where credit.source_payment_id = old.id
  ) then
    raise exception 'A Payment that created an unapplied customer Credit cannot be changed, voided, reversed, or deleted.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger payments_protect_customer_credit_source
before update or delete on public.payments
for each row execute function private.protect_customer_credit_source_payment();

create or replace function public.record_invoice_payment_v2(
  p_invoice_id uuid,
  p_received_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_idempotency_key uuid,
  p_reference_number text default null,
  p_notes text default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.user_profiles;
  invoice_row public.invoices;
  payment_row public.payments;
  normalized_received numeric;
  authoritative_applied numeric;
  remaining_before numeric;
  applied_amount numeric;
  excess_amount numeric;
  new_balance numeric;
  new_status text;
  actor_name text;
begin
  select * into actor
  from public.user_profiles
  where id = (select auth.uid()) and is_active
  for share;
  if not found or actor.role not in ('Master Admin', 'Administrator') then
    raise exception 'Payment recording permission is required.' using errcode = '42501';
  end if;

  normalized_received := round(p_received_amount, 2);
  if normalized_received is null or normalized_received <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if p_idempotency_key is null then
    raise exception 'A payment idempotency key is required.';
  end if;
  if p_payment_date is null then raise exception 'Payment date is required.'; end if;
  if p_payment_method is null or p_payment_method not in (
    'Cash', 'Check', 'Credit Card', 'Debit Card', 'ACH', 'Zelle',
    'Venmo', 'Cash App', 'Apple Pay', 'Other'
  ) then raise exception 'Choose a valid payment method.'; end if;

  -- Serialize every use of an idempotency key before locking an Invoice. This
  -- also covers simultaneous requests that reuse one key on different Invoices.
  perform pg_advisory_xact_lock(hashtextextended('invoice-payment:' || p_idempotency_key::text, 0));

  select * into invoice_row
  from public.invoices
  where id = p_invoice_id
  for update;
  if not found then raise exception 'Invoice not found.'; end if;
  if invoice_row.archived_at is not null
    or invoice_row.status in ('Archived', 'Cancelled') then
    raise exception 'This Invoice cannot receive payments.';
  end if;

  select * into payment_row
  from public.payments
  where idempotency_key = p_idempotency_key;
  if found then
    if payment_row.invoice_id is distinct from invoice_row.id
      or round(payment_row.received_amount, 2) is distinct from normalized_received
      or payment_row.payment_date is distinct from p_payment_date
      or payment_row.payment_method is distinct from p_payment_method
      or payment_row.reference_number is distinct from nullif(btrim(p_reference_number), '')
      or payment_row.notes is distinct from nullif(btrim(p_notes), '') then
      raise exception 'The payment idempotency key is already associated with different payment details.';
    end if;
    return payment_row;
  end if;

  select round(coalesce(sum(amount), 0), 2) into authoritative_applied
  from public.payments
  where invoice_id = invoice_row.id and voided_at is null;

  remaining_before := greatest(round(invoice_row.total - authoritative_applied, 2), 0);
  applied_amount := least(normalized_received, remaining_before);
  excess_amount := round(normalized_received - applied_amount, 2);
  actor_name := coalesce(nullif(btrim(actor.display_name), ''), actor.email, 'Authorized Administrator');

  insert into public.payments (
    invoice_id, client_id, job_id, amount, received_amount, unapplied_amount,
    payment_date, payment_method, reference_number, notes,
    recorded_by, recorded_by_name, idempotency_key
  ) values (
    invoice_row.id, invoice_row.client_id, invoice_row.job_id,
    applied_amount, normalized_received, excess_amount,
    p_payment_date, p_payment_method,
    nullif(btrim(p_reference_number), ''), nullif(btrim(p_notes), ''),
    actor.id, actor_name, p_idempotency_key
  ) returning * into payment_row;

  if excess_amount > 0 then
    insert into public.customer_credits (
      client_id, customer_name_snapshot, source_invoice_id, source_payment_id,
      original_amount, remaining_amount, created_by, created_by_name
    ) values (
      invoice_row.client_id, coalesce(nullif(btrim(invoice_row.client_name), ''), 'Unassigned Customer'),
      invoice_row.id, payment_row.id, excess_amount, excess_amount, actor.id, actor_name
    );
  end if;

  select round(coalesce(sum(amount), 0), 2) into authoritative_applied
  from public.payments
  where invoice_id = invoice_row.id and voided_at is null;

  new_balance := greatest(round(invoice_row.total - authoritative_applied, 2), 0);
  new_status := case
    when authoritative_applied >= round(invoice_row.total, 2) and invoice_row.total > 0 then 'Paid'
    when authoritative_applied > 0 then 'Partially Paid'
    when invoice_row.status = 'Draft' then 'Draft'
    when invoice_row.status = 'Sent' then 'Sent'
    else 'Open'
  end;

  update public.invoices
  set amount_paid = authoritative_applied,
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

-- Keep the customer-facing receipt explicit: Invoice revenue remains the
-- applied amount, while the full tender and any unapplied Credit are separate.
create or replace function public.get_invoice_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'invoice_number', i.invoice_number, 'status', i.status,
    'issue_date', i.issue_date, 'due_date', i.due_date,
    'client_name', i.client_name, 'property_name', i.property_name,
    'service_name', i.service_name, 'job_number', j.job_number,
    'agreement_number', a.agreement_number,
    'contract_billing_type', i.contract_billing_type,
    'billing_period_start', i.billing_period_start,
    'is_consolidated', i.is_consolidated,
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

-- Retain the historical function for database dependencies, but prevent clients
-- from bypassing the idempotent overpayment ledger through the legacy endpoint.
revoke all on function public.record_invoice_payment(uuid,numeric,date,text,text,text)
from public, anon, authenticated;
revoke all on function public.record_invoice_payment_v2(uuid,numeric,date,text,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.record_invoice_payment_v2(uuid,numeric,date,text,uuid,text,text)
to authenticated;
revoke all on function private.protect_unapplied_customer_credit() from public, anon, authenticated;
revoke all on function private.protect_customer_credit_source_payment() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
