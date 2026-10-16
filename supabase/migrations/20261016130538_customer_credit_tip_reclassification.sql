-- Reclassify a fully unapplied customer credit as a tip without changing the
-- original tender, Invoice allocation, Invoice total, or historical snapshots.
begin;

alter table public.payments
  drop constraint payments_received_allocation_check;
alter table public.payments
  add constraint payments_received_allocation_check check (
    (received_amount is null and unapplied_amount = 0)
    or (received_amount is not null
      and round(received_amount, 2) = round(amount + tip_amount + unapplied_amount, 2))
  );

alter table public.customer_credits
  drop constraint customer_credits_status_check;
alter table public.customer_credits
  add constraint customer_credits_status_check check (
    status in ('Unapplied', 'Applied', 'Refunded', 'Voided', 'Reclassified as Tip')
  );

create table public.customer_credit_tip_reclassification_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  credit_id uuid not null unique references public.customer_credits(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  client_id uuid references public.clients(id) on delete set null,
  amount numeric not null check (amount > 0),
  reason text not null check (char_length(btrim(reason)) >= 15),
  actor_id uuid references public.user_profiles(id) on delete set null,
  actor_name text not null,
  occurred_at timestamptz not null default now(),
  payment_before jsonb not null,
  payment_after jsonb not null,
  credit_before jsonb not null,
  credit_after jsonb not null
);

create index customer_credit_tip_reclassification_events_client_idx
  on public.customer_credit_tip_reclassification_events(client_id, occurred_at desc);

alter table public.customer_credit_tip_reclassification_events enable row level security;
revoke all on table public.customer_credit_tip_reclassification_events from public, anon, authenticated;
grant select on table public.customer_credit_tip_reclassification_events to authenticated;
create policy customer_credit_tip_reclassification_master_admin_read
on public.customer_credit_tip_reclassification_events for select to authenticated
using (
  (select auth.uid()) is not null
  and public.has_any_role(array['Master Admin'])
);

create function private.protect_customer_credit_tip_reclassification_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Customer Credit tip reclassification audit events are append-only.';
end;
$$;

create trigger customer_credit_tip_reclassification_events_append_only
before update or delete on public.customer_credit_tip_reclassification_events
for each row execute function private.protect_customer_credit_tip_reclassification_event();

create or replace function private.protect_unapplied_customer_credit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and exists (
    select 1
    from public.customer_credit_tip_reclassification_events event
    where event.credit_id = old.id
      and event.payment_id = old.source_payment_id
      and event.invoice_id = old.source_invoice_id
      and event.client_id is not distinct from old.client_id
      and event.amount = old.remaining_amount
      and old.status = 'Unapplied'
      and new.status = 'Reclassified as Tip'
      and new.remaining_amount = 0
      and (to_jsonb(new) - array['status','remaining_amount'])
        = (to_jsonb(old) - array['status','remaining_amount'])
      and event.credit_before = jsonb_build_object(
        'remaining_amount', old.remaining_amount, 'status', old.status
      )
      and event.credit_after = jsonb_build_object(
        'remaining_amount', new.remaining_amount, 'status', new.status
      )
  ) then
    return new;
  end if;
  raise exception 'Customer Credit records may only be changed by an authorized audited workflow.';
end;
$$;

create or replace function private.protect_customer_credit_source_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and exists (
    select 1
    from public.customer_credits credit
    join public.customer_credit_tip_reclassification_events event
      on event.credit_id = credit.id
    where credit.source_payment_id = old.id
      and event.payment_id = old.id
      and event.invoice_id = old.invoice_id
      and event.client_id is not distinct from old.client_id
      and event.amount = old.unapplied_amount
      and new.amount = old.amount
      and new.received_amount is not distinct from old.received_amount
      and new.unapplied_amount = 0
      and new.tip_amount = old.tip_amount + event.amount
      and (to_jsonb(new) - array['unapplied_amount','tip_amount'])
        = (to_jsonb(old) - array['unapplied_amount','tip_amount'])
      and event.payment_before = jsonb_build_object(
        'received_amount', old.received_amount,
        'applied_amount', old.amount,
        'unapplied_amount', old.unapplied_amount,
        'tip_amount', old.tip_amount
      )
      and event.payment_after = jsonb_build_object(
        'received_amount', new.received_amount,
        'applied_amount', new.amount,
        'unapplied_amount', new.unapplied_amount,
        'tip_amount', new.tip_amount
      )
  ) then
    return new;
  end if;
  if exists (
    select 1 from public.customer_credits credit
    where credit.source_payment_id = old.id
  ) then
    raise exception 'A Payment that created a customer Credit cannot be changed, voided, reversed, or deleted outside an authorized audited workflow.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function public.reclassify_customer_credit_as_tip(
  p_credit_id uuid,
  p_payment_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns public.customer_credit_tip_reclassification_events
language plpgsql security definer set search_path = '' as $$
declare
  actor public.user_profiles;
  credit_row public.customer_credits;
  payment_row public.payments;
  invoice_row public.invoices;
  event_row public.customer_credit_tip_reclassification_events;
  normalized_reason text := regexp_replace(btrim(coalesce(p_reason, '')), '[[:space:]]+', ' ', 'g');
  actor_name text;
begin
  select * into actor
  from public.user_profiles
  where id = (select auth.uid()) and is_active
  for share;
  if not found or actor.role <> 'Master Admin' then
    raise exception 'Master Admin permission is required.' using errcode = '42501';
  end if;
  if p_credit_id is null or p_payment_id is null or p_idempotency_key is null then
    raise exception 'Credit, Payment, and idempotency identifiers are required.';
  end if;
  if char_length(normalized_reason) < 15 or char_length(normalized_reason) > 1000 then
    raise exception 'Enter a correction reason between 15 and 1000 characters.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('credit-tip:' || p_idempotency_key::text, 0));
  select * into event_row
  from public.customer_credit_tip_reclassification_events
  where idempotency_key = p_idempotency_key;
  if found then
    if event_row.credit_id is distinct from p_credit_id
      or event_row.payment_id is distinct from p_payment_id
      or event_row.reason is distinct from normalized_reason then
      raise exception 'The correction idempotency key is already associated with different details.';
    end if;
    return event_row;
  end if;

  select * into credit_row from public.customer_credits
  where id = p_credit_id for update;
  if not found then raise exception 'Customer Credit not found.'; end if;
  if credit_row.source_payment_id is distinct from p_payment_id then
    raise exception 'The Customer Credit does not belong to the specified Payment.';
  end if;
  if credit_row.status <> 'Unapplied' or credit_row.remaining_amount <= 0
    or credit_row.remaining_amount <> credit_row.original_amount then
    raise exception 'Only a fully available, previously unused Customer Credit may be reclassified as a tip.';
  end if;

  select * into payment_row from public.payments
  where id = p_payment_id for update;
  if not found or payment_row.voided_at is not null then
    raise exception 'The source Payment is missing or voided.';
  end if;
  if payment_row.invoice_id is distinct from credit_row.source_invoice_id
    or payment_row.client_id is distinct from credit_row.client_id
    or payment_row.unapplied_amount is distinct from credit_row.remaining_amount
    or payment_row.received_amount is null
    or round(payment_row.received_amount, 2) is distinct from
      round(payment_row.amount + payment_row.tip_amount + payment_row.unapplied_amount, 2) then
    raise exception 'The Customer Credit does not match its source Payment allocation.';
  end if;

  select * into invoice_row from public.invoices
  where id = credit_row.source_invoice_id for share;
  if not found
    or invoice_row.client_id is distinct from credit_row.client_id
    or invoice_row.id is distinct from payment_row.invoice_id then
    raise exception 'The Customer Credit, Payment, and Invoice ownership do not match.';
  end if;

  actor_name := coalesce(nullif(btrim(actor.display_name), ''), actor.email, 'Master Admin');
  insert into public.customer_credit_tip_reclassification_events(
    idempotency_key, credit_id, payment_id, invoice_id, client_id, amount,
    reason, actor_id, actor_name, payment_before, payment_after,
    credit_before, credit_after
  ) values (
    p_idempotency_key, credit_row.id, payment_row.id, invoice_row.id,
    credit_row.client_id, credit_row.remaining_amount, normalized_reason,
    actor.id, actor_name,
    jsonb_build_object(
      'received_amount', payment_row.received_amount,
      'applied_amount', payment_row.amount,
      'unapplied_amount', payment_row.unapplied_amount,
      'tip_amount', payment_row.tip_amount
    ),
    jsonb_build_object(
      'received_amount', payment_row.received_amount,
      'applied_amount', payment_row.amount,
      'unapplied_amount', 0,
      'tip_amount', payment_row.tip_amount + credit_row.remaining_amount
    ),
    jsonb_build_object('remaining_amount', credit_row.remaining_amount, 'status', credit_row.status),
    jsonb_build_object('remaining_amount', 0, 'status', 'Reclassified as Tip')
  ) returning * into event_row;

  update public.payments
  set unapplied_amount = 0,
      tip_amount = tip_amount + credit_row.remaining_amount
  where id = payment_row.id;

  update public.customer_credits
  set remaining_amount = 0,
      status = 'Reclassified as Tip'
  where id = credit_row.id;

  return event_row;
end;
$$;

-- Keep public receipts explicit after a correction: the tender is unchanged,
-- the Invoice allocation remains revenue, and the reclassified amount is a tip.
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

revoke all on function public.reclassify_customer_credit_as_tip(uuid,uuid,text,uuid)
from public, anon, authenticated;
grant execute on function public.reclassify_customer_credit_as_tip(uuid,uuid,text,uuid)
to authenticated;
revoke all on function private.protect_customer_credit_tip_reclassification_event()
from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
