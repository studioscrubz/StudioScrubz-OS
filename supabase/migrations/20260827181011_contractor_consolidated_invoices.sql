-- StudioScrubz OS: Contractor clients and multi-Job consolidated Invoices.
-- Additive to the existing single-Job and Service Agreement invoice models.

begin;

alter table public.clients
  drop constraint if exists clients_client_type_check;

alter table public.clients
  add constraint clients_client_type_check
  check (client_type in ('Residential', 'Commercial', 'Contractor'));

alter table public.invoices
  add column if not exists is_consolidated boolean not null default false;

create table if not exists public.invoice_job_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete restrict,
  property_id uuid references public.properties(id) on delete set null,
  job_number_snapshot text not null,
  property_name_snapshot text,
  property_address_snapshot text not null,
  service_name_snapshot text not null,
  service_date_snapshot date not null,
  amount numeric not null,
  created_at timestamptz not null default now(),
  constraint invoice_job_lines_invoice_job_key unique (invoice_id, job_id),
  constraint invoice_job_lines_amount_check check (
    amount >= 0
    and amount = round(amount, 2)
    and amount::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  constraint invoice_job_lines_job_number_check check (nullif(btrim(job_number_snapshot), '') is not null),
  constraint invoice_job_lines_property_address_check check (nullif(btrim(property_address_snapshot), '') is not null),
  constraint invoice_job_lines_service_name_check check (nullif(btrim(service_name_snapshot), '') is not null)
);

create index if not exists invoice_job_lines_invoice_id_idx
  on public.invoice_job_lines(invoice_id);
create index if not exists invoice_job_lines_job_id_idx
  on public.invoice_job_lines(job_id);
create index if not exists invoice_job_lines_property_id_idx
  on public.invoice_job_lines(property_id);

alter table public.invoice_job_lines enable row level security;

revoke all on table public.invoice_job_lines from public, anon, authenticated;
grant select on table public.invoice_job_lines to authenticated;

drop policy if exists "Consolidated invoice lines read" on public.invoice_job_lines;
create policy "Consolidated invoice lines read"
on public.invoice_job_lines
for select
to authenticated
using (public.has_any_role(array['Master Admin','Administrator','Manager']));

create or replace function public.validate_invoice_job_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  job_row public.jobs;
begin
  select * into invoice_row
  from public.invoices invoice
  where invoice.id = new.invoice_id
  for update;
  if not found or not invoice_row.is_consolidated then
    raise exception using errcode = '23514', message = 'Invoice Job lines require a consolidated Invoice.';
  end if;

  select * into job_row
  from public.jobs job
  where job.id = new.job_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'Invoice Job does not exist.';
  end if;
  if job_row.status <> 'Completed' or job_row.archived_at is not null then
    raise exception using errcode = '23514', message = 'Only active completed Jobs can be added to a consolidated Invoice.';
  end if;
  if job_row.client_id is distinct from invoice_row.client_id then
    raise exception using errcode = '23514', message = 'Every consolidated Invoice Job must belong to the Invoice client.';
  end if;
  if new.property_id is distinct from job_row.property_id then
    raise exception using errcode = '23514', message = 'Invoice Job property must match its Job.';
  end if;
  if exists (
    select 1
    from public.invoices existing
    where existing.job_id = new.job_id
      and ((existing.archived_at is null and existing.status not in ('Cancelled', 'Archived'))
        or (existing.total > 0 and existing.amount_paid >= existing.total))
  ) or exists (
    select 1
    from public.invoice_job_lines existing_line
    join public.invoices existing on existing.id = existing_line.invoice_id
    where existing_line.job_id = new.job_id
      and existing_line.invoice_id <> new.invoice_id
      and ((existing.archived_at is null and existing.status not in ('Cancelled', 'Archived'))
        or (existing.total > 0 and existing.amount_paid >= existing.total))
  ) then
    raise exception using errcode = '23505', message = 'This Job already belongs to an active Invoice.';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_invoice_job_line() from public, anon, authenticated;

drop trigger if exists invoice_job_lines_validate on public.invoice_job_lines;
create trigger invoice_job_lines_validate
before insert or update on public.invoice_job_lines
for each row execute function public.validate_invoice_job_line();

create or replace function public.protect_invoice_job_line_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'Consolidated Invoice Job history is immutable.';
end;
$$;

revoke all on function public.protect_invoice_job_line_history() from public, anon, authenticated;

drop trigger if exists invoice_job_lines_protect_history on public.invoice_job_lines;
create trigger invoice_job_lines_protect_history
before update or delete on public.invoice_job_lines
for each row execute function public.protect_invoice_job_line_history();

create or replace function public.validate_consolidated_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_invoice_id uuid;
  invoice_row public.invoices;
  line_count bigint;
  line_total numeric;
begin
  if tg_table_name = 'invoice_job_lines' then
    target_invoice_id := new.invoice_id;
  else
    target_invoice_id := new.id;
  end if;
  select * into invoice_row from public.invoices where id = target_invoice_id;
  if not found or not invoice_row.is_consolidated then return null; end if;

  select count(*), round(coalesce(sum(line.amount), 0), 2)
  into line_count, line_total
  from public.invoice_job_lines line
  where line.invoice_id = target_invoice_id;

  if invoice_row.job_id is not null
    or invoice_row.service_agreement_id is not null
    or invoice_row.property_id is not null
  then
    raise exception using errcode = '23514', message = 'A consolidated Invoice must use its Job lines for Job and location identity.';
  end if;
  if line_count = 0 then
    raise exception using errcode = '23514', message = 'A consolidated Invoice requires at least one Job line.';
  end if;
  if invoice_row.subtotal is distinct from line_total then
    raise exception using errcode = '23514', message = 'Consolidated Invoice subtotal must equal its Job line total.';
  end if;
  return null;
end;
$$;

revoke all on function public.validate_consolidated_invoice() from public, anon, authenticated;

drop trigger if exists invoices_validate_consolidated on public.invoices;
create constraint trigger invoices_validate_consolidated
after insert or update of is_consolidated, job_id, service_agreement_id, property_id, subtotal
on public.invoices
deferrable initially deferred
for each row execute function public.validate_consolidated_invoice();

drop trigger if exists invoice_job_lines_validate_invoice on public.invoice_job_lines;
create constraint trigger invoice_job_lines_validate_invoice
after insert on public.invoice_job_lines
deferrable initially deferred
for each row execute function public.validate_consolidated_invoice();

create or replace function public.prevent_legacy_job_invoice_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_id is not null
    and new.archived_at is null
    and new.status not in ('Cancelled', 'Archived')
    and exists (
      select 1
      from public.invoice_job_lines line
      join public.invoices invoice on invoice.id = line.invoice_id
      where line.job_id = new.job_id
        and invoice.id <> new.id
        and ((invoice.archived_at is null and invoice.status not in ('Cancelled', 'Archived'))
          or (invoice.total > 0 and invoice.amount_paid >= invoice.total))
    )
  then
    raise exception using errcode = '23505', message = 'This Job already belongs to an active consolidated Invoice.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_legacy_job_invoice_overlap() from public, anon, authenticated;

drop trigger if exists invoices_prevent_job_line_overlap on public.invoices;
create trigger invoices_prevent_job_line_overlap
before insert or update of job_id, status, archived_at on public.invoices
for each row execute function public.prevent_legacy_job_invoice_overlap();

create or replace function public.get_contractor_invoice_eligible_jobs(p_client_id uuid)
returns table (
  id uuid,
  job_number text,
  property_id uuid,
  property_name text,
  property_address text,
  service_name text,
  service_date date,
  amount numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin','Administrator','Manager'])
  then
    raise exception 'Invoice creation is not permitted.';
  end if;
  if not exists (
    select 1 from public.clients client
    where client.id = p_client_id
      and client.client_type = 'Contractor'
      and client.archived_at is null
  ) then
    raise exception 'Select an active Contractor client.';
  end if;

  return query
  select
    job.id,
    job.job_number,
    job.property_id,
    coalesce(nullif(btrim(property.property_name), ''), nullif(btrim(job.property_name), ''), 'Service location'),
    concat_ws(', ', nullif(btrim(property.address), ''), nullif(btrim(property.address_line_2), ''), nullif(btrim(property.city), ''), nullif(btrim(property.state), ''), nullif(btrim(property.zip), '')),
    coalesce(nullif(btrim(job.service_name), ''), 'StudioScrubz service'),
    coalesce(job.completed_at::date, job.scheduled_date, current_date),
    round(job.price, 2)
  from public.jobs job
  join public.properties property on property.id = job.property_id
  where job.client_id = p_client_id
    and job.status = 'Completed'
    and job.archived_at is null
    and property.archived_at is null
    and job.price is not null
    and job.price >= 0
    and job.price = round(job.price, 2)
    and job.price::text not in ('NaN', 'Infinity', '-Infinity')
    and not exists (
      select 1 from public.invoices invoice
      where invoice.job_id = job.id
        and ((invoice.archived_at is null and invoice.status not in ('Cancelled', 'Archived'))
          or (invoice.total > 0 and invoice.amount_paid >= invoice.total))
    )
    and not exists (
      select 1
      from public.invoice_job_lines line
      join public.invoices invoice on invoice.id = line.invoice_id
      where line.job_id = job.id
        and ((invoice.archived_at is null and invoice.status not in ('Cancelled', 'Archived'))
          or (invoice.total > 0 and invoice.amount_paid >= invoice.total))
    )
    and not exists (
      select 1
      from public.service_occurrences occurrence
      join public.service_agreements agreement on agreement.id = occurrence.agreement_id
      where occurrence.id = job.service_occurrence_id
        and agreement.billing_type in ('Weekly','Biweekly','Monthly','Flat Contract')
    )
  order by coalesce(job.completed_at::date, job.scheduled_date, current_date), job.job_number;
end;
$$;

revoke all on function public.get_contractor_invoice_eligible_jobs(uuid) from public, anon, authenticated;
grant execute on function public.get_contractor_invoice_eligible_jobs(uuid) to authenticated;

create or replace function public.create_contractor_consolidated_invoice(
  p_client_id uuid,
  p_job_ids uuid[],
  p_issue_date date default current_date,
  p_due_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_row public.clients;
  settings_row public.business_settings;
  selected_count integer;
  eligible_count integer;
  subtotal_amount numeric;
  invoice_id uuid;
  generated_invoice_number text;
  invoice_items jsonb;
  attempt integer;
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin','Administrator','Manager'])
  then
    raise exception 'Invoice creation is not permitted.';
  end if;
  if p_issue_date is null then raise exception 'Issue date is required.'; end if;
  if p_due_date is not null and p_due_date < p_issue_date then
    raise exception 'Due date cannot be before the issue date.';
  end if;

  select * into client_row
  from public.clients client
  where client.id = p_client_id
  for update;
  if not found or client_row.client_type <> 'Contractor' or client_row.archived_at is not null then
    raise exception 'Select an active Contractor client.';
  end if;

  select count(*) into selected_count
  from (select distinct value from unnest(coalesce(p_job_ids, array[]::uuid[])) value) selected;
  if selected_count = 0 then raise exception 'Select at least one completed Job.'; end if;

  perform 1
  from public.jobs job
  where job.id in (select distinct value from unnest(p_job_ids) value)
  order by job.id
  for update;

  select count(*), round(coalesce(sum(job.price), 0), 2)
  into eligible_count, subtotal_amount
  from public.jobs job
  where job.id in (select distinct value from unnest(p_job_ids) value)
    and job.client_id = p_client_id
    and job.status = 'Completed'
    and job.archived_at is null
    and job.property_id is not null
    and job.price is not null
    and job.price >= 0
    and job.price = round(job.price, 2)
    and job.price::text not in ('NaN', 'Infinity', '-Infinity')
    and not exists (
      select 1 from public.invoices existing
      where existing.job_id = job.id
        and ((existing.archived_at is null and existing.status not in ('Cancelled', 'Archived'))
          or (existing.total > 0 and existing.amount_paid >= existing.total))
    )
    and not exists (
      select 1
      from public.invoice_job_lines line
      join public.invoices existing on existing.id = line.invoice_id
      where line.job_id = job.id
        and ((existing.archived_at is null and existing.status not in ('Cancelled', 'Archived'))
          or (existing.total > 0 and existing.amount_paid >= existing.total))
    )
    and not exists (
      select 1
      from public.service_occurrences occurrence
      join public.service_agreements agreement on agreement.id = occurrence.agreement_id
      where occurrence.id = job.service_occurrence_id
        and agreement.billing_type in ('Weekly','Biweekly','Monthly','Flat Contract')
    );
  if eligible_count <> selected_count then
    raise exception 'Every selected Job must be an eligible completed, uninvoiced Job for this Contractor.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', gen_random_uuid(),
    'description', job.job_number || ' - ' || coalesce(nullif(btrim(property.property_name), ''), property.address) || ' - ' || coalesce(nullif(btrim(job.service_name), ''), 'StudioScrubz service'),
    'quantity', 1,
    'rate', round(job.price, 2),
    'amount', round(job.price, 2)
  ) order by coalesce(job.completed_at::date, job.scheduled_date, current_date), job.job_number), '[]'::jsonb)
  into invoice_items
  from public.jobs job
  join public.properties property on property.id = job.property_id
  where job.id in (select distinct value from unnest(p_job_ids) value);

  select * into settings_row from public.business_settings limit 1;
  for attempt in 1..5 loop
    generated_invoice_number := 'INV-' || to_char(p_issue_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0');
    begin
      insert into public.invoices (
        invoice_number, job_id, service_agreement_id, contract_billing_type,
        billing_period_start, proposal_id, client_id, property_id, client_name,
        property_name, customer_phone, customer_email, service_name, status,
        issue_date, due_date, line_items, subtotal, discount, tax, total,
        amount_paid, balance_due, terms, is_consolidated
      ) values (
        generated_invoice_number, null, null, null, null, null, client_row.id, null,
        coalesce(nullif(btrim(client_row.company_name), ''), concat_ws(' ', client_row.first_name, client_row.last_name)),
        'Multiple service locations', client_row.phone, client_row.email,
        'Consolidated completed services', 'Open', p_issue_date,
        coalesce(p_due_date, p_issue_date + coalesce(settings_row.default_invoice_due_days, 15)),
        invoice_items, subtotal_amount, 0, 0, subtotal_amount, 0,
        subtotal_amount, coalesce(settings_row.default_invoice_terms, settings_row.default_payment_terms), true
      ) returning id into invoice_id;

      insert into public.invoice_job_lines (
        invoice_id, job_id, property_id, job_number_snapshot,
        property_name_snapshot, property_address_snapshot,
        service_name_snapshot, service_date_snapshot, amount
      )
      select
        invoice_id, job.id, job.property_id, job.job_number,
        coalesce(nullif(btrim(property.property_name), ''), nullif(btrim(job.property_name), ''), 'Service location'),
        concat_ws(', ', nullif(btrim(property.address), ''), nullif(btrim(property.address_line_2), ''), nullif(btrim(property.city), ''), nullif(btrim(property.state), ''), nullif(btrim(property.zip), '')),
        coalesce(nullif(btrim(job.service_name), ''), 'StudioScrubz service'),
        coalesce(job.completed_at::date, job.scheduled_date, p_issue_date),
        round(job.price, 2)
      from public.jobs job
      join public.properties property on property.id = job.property_id
      where job.id in (select distinct value from unnest(p_job_ids) value);

      return jsonb_build_object('invoice_id', invoice_id, 'invoice_number', generated_invoice_number, 'created', true);
    exception when unique_violation then
      if exists (select 1 from public.invoices invoice where invoice.invoice_number = generated_invoice_number) then
        null;
      else
        raise;
      end if;
    end;
  end loop;
  raise exception 'A unique Invoice number could not be generated.';
end;
$$;

revoke all on function public.create_contractor_consolidated_invoice(uuid,uuid[],date,date)
from public, anon, authenticated;
grant execute on function public.create_contractor_consolidated_invoice(uuid,uuid[],date,date)
to authenticated;

create or replace function public.is_job_financially_handed_off(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.invoices invoice
    where invoice.job_id = p_job_id
      and invoice.archived_at is null
      and invoice.status not in ('Cancelled', 'Archived')
  ) or exists (
    select 1
    from public.invoice_job_lines line
    join public.invoices invoice on invoice.id = line.invoice_id
    where line.job_id = p_job_id
      and invoice.archived_at is null
      and invoice.status not in ('Cancelled', 'Archived')
  ) or exists (
    select 1
    from public.invoice_job_lines line
    join public.invoices invoice on invoice.id = line.invoice_id
    where line.job_id = p_job_id
      and invoice.total > 0
      and invoice.amount_paid >= invoice.total
  ) or exists (
    select 1 from public.invoices invoice
    where invoice.job_id = p_job_id
      and (coalesce(invoice.amount_paid, 0) >= invoice.total and invoice.total > 0)
  );
$$;

revoke all on function public.is_job_financially_handed_off(uuid)
from public, anon, authenticated;

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
      'amount', p.amount, 'payment_date', p.payment_date, 'payment_method', p.payment_method
    ) order by p.payment_date, p.created_at) from public.payments p where p.invoice_id = i.id), '[]'::jsonb),
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

revoke all on function public.get_invoice_by_token(text) from public, authenticated;
grant execute on function public.get_invoice_by_token(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
