-- StudioScrubz OS: secure public Invoice links.
-- REVIEW ONLY. Run manually in the Supabase SQL editor after review.

alter table public.invoices
  add column if not exists client_access_token text,
  add column if not exists client_access_token_expires_at timestamptz,
  add column if not exists customer_notes text;

revoke all on public.invoices from anon;
revoke all on public.payments from anon;
drop policy if exists "Temporary invoice read" on public.invoices;
drop policy if exists "Temporary invoice create" on public.invoices;
drop policy if exists "Temporary invoice update" on public.invoices;
drop policy if exists "Temporary payment read" on public.payments;
drop policy if exists "Temporary payment create" on public.payments;

create unique index if not exists invoices_client_access_token_key
  on public.invoices (client_access_token)
  where client_access_token is not null;

create index if not exists invoices_client_access_token_expires_idx
  on public.invoices (client_access_token_expires_at)
  where client_access_token is not null;

create or replace function public.get_invoice_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'invoice_number', i.invoice_number,
    'status', i.status,
    'issue_date', i.issue_date,
    'due_date', i.due_date,
    'client_name', i.client_name,
    'property_name', i.property_name,
    'service_name', i.service_name,
    'job_number', j.job_number,
    'agreement_number', a.agreement_number,
    'contract_billing_type', i.contract_billing_type,
    'billing_period_start', i.billing_period_start,
    'line_items', coalesce(i.line_items, '[]'::jsonb),
    'subtotal', i.subtotal,
    'discount', i.discount,
    'tax', i.tax,
    'total', i.total,
    'amount_paid', i.amount_paid,
    'balance_due', i.balance_due,
    'terms', i.terms,
    'customer_notes', i.customer_notes,
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'amount', p.amount,
        'payment_date', p.payment_date,
        'payment_method', p.payment_method
      ) order by p.payment_date, p.created_at)
      from public.payments p
      where p.invoice_id = i.id
    ), '[]'::jsonb),
    'business_name', coalesce(b.business_name, 'StudioScrubz'),
    'tagline', b.tagline,
    'business_email', b.business_email,
    'business_phone', b.business_phone,
    'website', b.website,
    'address', b.address,
    'city', b.city,
    'state', b.state,
    'zip', b.zip
  )
  from public.invoices i
  left join public.jobs j on j.id = i.job_id
  left join public.service_agreements a on a.id = i.service_agreement_id
  left join lateral (select * from public.business_settings limit 1) b on true
  where p_token is not null
    and length(p_token) >= 40
    and i.client_access_token = p_token
    and (i.client_access_token_expires_at is null or i.client_access_token_expires_at > now())
  limit 1;
$$;

revoke all on function public.get_invoice_by_token(text) from public, anon, authenticated;
grant execute on function public.get_invoice_by_token(text) to anon, authenticated;

alter table public.payments
  add column if not exists payment_provider text,
  add column if not exists provider_payment_id text,
  add column if not exists provider_order_id text;

create unique index if not exists payments_provider_payment_id_key
  on public.payments (payment_provider, provider_payment_id)
  where payment_provider is not null and provider_payment_id is not null;

create table if not exists public.square_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  idempotency_key text not null unique,
  square_payment_link_id text unique,
  square_order_id text unique,
  square_payment_id text unique,
  checkout_url text,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'Created' check (status in ('Created','Pending','Completed','Failed','Cancelled','Conflict')),
  conflict_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.square_checkout_attempts enable row level security;
revoke all on public.square_checkout_attempts from public, anon, authenticated;

create index if not exists square_checkout_attempts_invoice_id_idx
  on public.square_checkout_attempts (invoice_id, created_at desc);

create unique index if not exists square_checkout_attempts_one_active_invoice_idx
  on public.square_checkout_attempts (invoice_id)
  where status in ('Created','Pending');

create or replace function public.record_square_invoice_payment(
  p_attempt_id uuid,
  p_square_payment_id text,
  p_square_order_id text,
  p_amount_cents bigint,
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
  payment_amount numeric;
  remaining numeric;
  payment_row public.payments;
begin
  select * into attempt_row from public.square_checkout_attempts where id = p_attempt_id for update;
  if not found then raise exception 'Square checkout attempt not found.'; end if;

  select * into invoice_row from public.invoices where id = attempt_row.invoice_id for update;
  if not found then raise exception 'Invoice not found.'; end if;

  select * into existing_payment from public.payments
  where payment_provider = 'Square' and provider_payment_id = p_square_payment_id;
  if found then
    if existing_payment.invoice_id is distinct from invoice_row.id then raise exception 'Square Payment is already associated with another Invoice.'; end if;
    return jsonb_build_object('created', false, 'conflict', false, 'payment_id', existing_payment.id);
  end if;

  if attempt_row.square_order_id is distinct from p_square_order_id then raise exception 'Square order does not match the checkout attempt.'; end if;
  if attempt_row.amount_cents is distinct from p_amount_cents then
    update public.square_checkout_attempts set status='Conflict',square_payment_id=p_square_payment_id,completed_at=p_paid_at,conflict_reason='Square completed payment amount does not match the authoritative checkout amount.',updated_at=now() where id=p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;
  if attempt_row.currency is distinct from p_currency or p_currency <> 'USD' then
    update public.square_checkout_attempts set status='Conflict',square_payment_id=p_square_payment_id,completed_at=p_paid_at,conflict_reason='Square completed payment currency does not match the Invoice currency.',updated_at=now() where id=p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;
  if invoice_row.archived_at is not null or invoice_row.status in ('Cancelled','Archived') then
    update public.square_checkout_attempts set status='Conflict',square_payment_id=p_square_payment_id,completed_at=p_paid_at,conflict_reason='Square completed payment for a cancelled or archived Invoice.',updated_at=now() where id=p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;

  select round(coalesce(sum(amount),0),2) into authoritative_paid from public.payments where invoice_id=invoice_row.id;
  payment_amount := round(p_amount_cents::numeric / 100, 2);
  remaining := greatest(round(invoice_row.total - authoritative_paid,2),0);
  if payment_amount > remaining then
    update public.square_checkout_attempts set status='Conflict',square_payment_id=p_square_payment_id,completed_at=p_paid_at,conflict_reason='Square completed payment exceeds the current authoritative Invoice balance; manual reconciliation or refund is required.',updated_at=now() where id=p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;

  insert into public.payments (
    invoice_id,client_id,job_id,amount,payment_date,payment_method,reference_number,notes,
    payment_provider,provider_payment_id,provider_order_id
  ) values (
    invoice_row.id,invoice_row.client_id,invoice_row.job_id,payment_amount,
    (p_paid_at at time zone 'UTC')::date,'Credit Card',p_square_payment_id,
    'Verified Square online payment','Square',p_square_payment_id,p_square_order_id
  ) returning * into payment_row;

  select round(coalesce(sum(amount),0),2) into authoritative_paid from public.payments where invoice_id=invoice_row.id;
  update public.invoices set
    amount_paid=authoritative_paid,
    balance_due=greatest(round(total-authoritative_paid,2),0),
    status=case when authoritative_paid>=round(total,2) and total>0 then 'Paid' when authoritative_paid>0 then 'Partially Paid' else 'Open' end,
    paid_at=case when authoritative_paid>=round(total,2) and total>0 then coalesce(paid_at,p_paid_at) else null end
  where id=invoice_row.id;

  update public.square_checkout_attempts set status='Completed',square_payment_id=p_square_payment_id,completed_at=p_paid_at,conflict_reason=null,updated_at=now() where id=p_attempt_id;
  return jsonb_build_object('created', true, 'conflict', false, 'payment_id', payment_row.id);
end;
$$;

revoke all on function public.record_square_invoice_payment(uuid,text,text,bigint,text,timestamptz)
from public, anon, authenticated;
grant execute on function public.record_square_invoice_payment(uuid,text,text,bigint,text,timestamptz)
to service_role;

notify pgrst, 'reload schema';
