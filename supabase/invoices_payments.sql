-- Review in Supabase SQL Editor. Intentionally not executed automatically.
create extension if not exists pgcrypto;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  job_id uuid references public.jobs(id) on delete restrict,
  service_agreement_id uuid references public.service_agreements(id) on delete restrict,
  contract_billing_type text check (contract_billing_type in ('Monthly','Flat Contract')),
  billing_period_start date,
  proposal_id uuid references public.proposals(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  client_name text, property_name text, customer_phone text, customer_email text, service_name text,
  status text not null default 'Draft' check (status in ('Draft','Open','Sent','Partially Paid','Paid','Past Due','Cancelled','Archived')),
  issue_date date not null default current_date,
  due_date date,
  line_items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0 check (subtotal >= 0),
  discount numeric not null default 0 check (discount >= 0),
  tax numeric not null default 0 check (tax >= 0),
  total numeric not null default 0 check (total >= 0),
  amount_paid numeric not null default 0 check (amount_paid >= 0),
  balance_due numeric not null default 0 check (balance_due >= 0),
  notes text, terms text, sent_at timestamptz, paid_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  constraint invoices_source_check check ((service_agreement_id is null and contract_billing_type is null and billing_period_start is null) or (job_id is null and service_agreement_id is not null and contract_billing_type is not null)),
  constraint invoices_contract_period_check check ((contract_billing_type = 'Monthly' and billing_period_start is not null and extract(day from billing_period_start) = 1) or (contract_billing_type = 'Flat Contract' and billing_period_start is null) or contract_billing_type is null)
);
create index if not exists invoices_job_id_idx on public.invoices(job_id);
create index if not exists invoices_service_agreement_id_idx on public.invoices(service_agreement_id);
create index if not exists invoices_client_id_idx on public.invoices(client_id);
create index if not exists invoices_property_id_idx on public.invoices(property_id);
create index if not exists invoices_status_idx on public.invoices(status);
create index if not exists invoices_issue_date_idx on public.invoices(issue_date);
create index if not exists invoices_due_date_idx on public.invoices(due_date);
create index if not exists invoices_created_at_idx on public.invoices(created_at desc);
create index if not exists invoices_archived_at_idx on public.invoices(archived_at);
create unique index if not exists invoices_one_active_per_job_idx on public.invoices(job_id) where archived_at is null and status <> 'Cancelled';
create unique index if not exists invoices_one_active_monthly_contract_period_idx on public.invoices(service_agreement_id,billing_period_start) where archived_at is null and status not in ('Cancelled','Archived') and contract_billing_type = 'Monthly';
create or replace function public.validate_contract_invoice_amount() returns trigger language plpgsql security invoker set search_path='' as $$
declare agreement_type text; agreement_division text; contract_amount numeric; prior_total numeric;
begin
  if new.contract_billing_type is null then return new; end if;
  select billing_type,division,billing_amount into agreement_type,agreement_division,contract_amount from public.service_agreements where id=new.service_agreement_id for update;
  if agreement_type is distinct from new.contract_billing_type or agreement_division is distinct from 'Commercial' then raise exception 'Contract invoice source does not match a Commercial agreement'; end if;
  if new.archived_at is not null or new.status in ('Cancelled','Archived') then return new; end if;
  if new.contract_billing_type='Monthly' and round(new.total,2)<>round(contract_amount,2) then raise exception 'Monthly invoice total must equal the agreement monthly contract amount'; end if;
  if new.contract_billing_type='Flat Contract' then
    select coalesce(sum(total),0) into prior_total from public.invoices where service_agreement_id=new.service_agreement_id and contract_billing_type='Flat Contract' and id<>new.id and archived_at is null and status not in ('Cancelled','Archived');
    if round(prior_total+new.total,2)>round(contract_amount,2) then raise exception 'Flat Contract invoices cannot exceed the agreement contract value'; end if;
  end if;
  return new;
end; $$;
revoke all on function public.validate_contract_invoice_amount() from public;
drop trigger if exists invoices_validate_contract_amount on public.invoices;
create trigger invoices_validate_contract_amount before insert or update of service_agreement_id,contract_billing_type,total,status,archived_at on public.invoices for each row execute function public.validate_contract_invoice_amount();
create or replace function public.set_invoices_updated_at() returns trigger language plpgsql security invoker set search_path='' as $$ begin new.updated_at=now(); return new; end; $$;
revoke all on function public.set_invoices_updated_at() from public;
drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at before update on public.invoices for each row execute function public.set_invoices_updated_at();
alter table public.invoices enable row level security;
grant select,insert,update on public.invoices to anon,authenticated;
drop policy if exists "Temporary invoice read" on public.invoices;
drop policy if exists "Temporary invoice create" on public.invoices;
drop policy if exists "Temporary invoice update" on public.invoices;
create policy "Temporary invoice read" on public.invoices for select to anon,authenticated using(true);
create policy "Temporary invoice create" on public.invoices for insert to anon,authenticated with check(true);
create policy "Temporary invoice update" on public.invoices for update to anon,authenticated using(true) with check(true);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete restrict,
  amount numeric not null check (amount > 0), payment_date date not null default current_date,
  payment_method text not null check (payment_method in ('Cash','Check','Credit Card','Debit Card','ACH','Zelle','Venmo','Cash App','Apple Pay','Other')),
  reference_number text, notes text, created_at timestamptz not null default now()
);
create index if not exists payments_invoice_id_idx on public.payments(invoice_id);
create index if not exists payments_client_id_idx on public.payments(client_id);
create index if not exists payments_job_id_idx on public.payments(job_id);
create index if not exists payments_payment_date_idx on public.payments(payment_date);
create index if not exists payments_created_at_idx on public.payments(created_at desc);
alter table public.payments enable row level security;
grant select,insert on public.payments to anon,authenticated;
drop policy if exists "Temporary payment read" on public.payments;
drop policy if exists "Temporary payment create" on public.payments;
create policy "Temporary payment read" on public.payments for select to anon,authenticated using(true);
create policy "Temporary payment create" on public.payments for insert to anon,authenticated with check(true);
