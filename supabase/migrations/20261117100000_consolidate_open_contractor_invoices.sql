-- The privileged RPCs share one eligibility query. The view is private to database owners.
create or replace view public.contractor_invoice_consolidation_candidates
with (security_invoker = true) as
  select
    job.id,
    source.id as source_invoice_id,
    job.client_id,
    job.job_number,
    job.property_id,
    coalesce(nullif(btrim(property.property_name), ''), nullif(btrim(job.property_name), ''), 'Service location') as property_name,
    concat_ws(', ', nullif(btrim(property.address), ''), nullif(btrim(property.address_line_2), ''), nullif(btrim(property.city), ''), nullif(btrim(property.state), ''), nullif(btrim(property.zip), '')) as property_address,
    coalesce(nullif(btrim(job.service_name), ''), 'StudioScrubz service') as service_name,
    coalesce(job.completed_at::date, job.scheduled_date, current_date) as service_date,
    coalesce(source.total, round(job.price, 2)) as amount
  from public.jobs job
  join public.properties property on property.id = job.property_id
  left join lateral (
    select invoice.id, invoice.total
    from public.invoices invoice
    where invoice.job_id = job.id and invoice.client_id = job.client_id
      and invoice.status = 'Open' and invoice.archived_at is null
      and invoice.sent_at is null and invoice.client_access_token is null
      and invoice.amount_paid = 0 and invoice.paid_at is null
      and invoice.total >= 0 and invoice.total = round(invoice.total, 2)
      and invoice.total::text not in ('NaN', 'Infinity', '-Infinity')
      and invoice.balance_due = invoice.total
      and not invoice.deposit_requested and not invoice.is_consolidated
      and invoice.service_agreement_id is null and invoice.contract_billing_type is null
      and not exists (select 1 from public.payments payment where payment.invoice_id = invoice.id)
    order by invoice.id
    limit 1
  ) source on true
  where property.client_id = job.client_id
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
        and invoice.id is distinct from source.id
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
    );

revoke all on public.contractor_invoice_consolidation_candidates from public, anon, authenticated;

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
  select eligible.id, eligible.job_number, eligible.property_id, eligible.property_name,
    eligible.property_address, eligible.service_name, eligible.service_date, eligible.amount
  from public.contractor_invoice_consolidation_candidates eligible
  where eligible.client_id = p_client_id
  order by eligible.service_date, eligible.job_number;
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
  source_invoice_ids uuid[];
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

  -- Serialize against payment and invoice updates before rechecking eligibility.
  perform 1 from public.invoices invoice
  where invoice.job_id = any(p_job_ids) and invoice.client_id = p_client_id
  order by invoice.id for update;

  select count(*), round(coalesce(sum(eligible.amount), 0), 2),
    array_agg(eligible.source_invoice_id) filter (where eligible.source_invoice_id is not null),
    jsonb_agg(jsonb_build_object(
      'id', gen_random_uuid(),
      'description', eligible.job_number || ' - ' || eligible.property_name || ' - ' || eligible.service_name,
      'quantity', 1, 'rate', eligible.amount, 'amount', eligible.amount
    ) order by eligible.service_date, eligible.job_number)
  into eligible_count, subtotal_amount, source_invoice_ids, invoice_items
  from public.contractor_invoice_consolidation_candidates eligible
  where eligible.client_id = p_client_id and eligible.id = any(p_job_ids);

  if eligible_count <> selected_count then
    raise exception 'Every selected Job must still be eligible for this Contractor. Refresh and try again.';
  end if;

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
        'Consolidated completed services', 'Draft', p_issue_date,
        coalesce(p_due_date, p_issue_date + coalesce(settings_row.default_invoice_due_days, 15)),
        invoice_items, subtotal_amount, 0, 0, subtotal_amount, 0,
        subtotal_amount, coalesce(settings_row.default_invoice_terms, settings_row.default_payment_terms), true
      ) returning id into invoice_id;

      with cancelled as (
        update public.invoices source
        set status = 'Cancelled', client_access_token = null, client_access_token_expires_at = null,
            notes = concat_ws(E'\n', nullif(source.notes, ''), 'Consolidated into ' || generated_invoice_number)
        where source.id = any(source_invoice_ids)
        returning source.id
      )
      select count(*) into eligible_count from cancelled;

      if eligible_count <> coalesce(cardinality(source_invoice_ids), 0) then
        raise exception 'A source Invoice changed. Refresh and try again.';
      end if;

      insert into public.invoice_job_lines (
        invoice_id, job_id, property_id, job_number_snapshot,
        property_name_snapshot, property_address_snapshot,
        service_name_snapshot, service_date_snapshot, amount
      )
      select invoice_id, job.id, job.property_id, job.job_number,
        coalesce(nullif(btrim(property.property_name), ''), nullif(btrim(job.property_name), ''), 'Service location'),
        concat_ws(', ', nullif(btrim(property.address), ''), nullif(btrim(property.address_line_2), ''), nullif(btrim(property.city), ''), nullif(btrim(property.state), ''), nullif(btrim(property.zip), '')),
        coalesce(nullif(btrim(job.service_name), ''), 'StudioScrubz service'),
        coalesce(job.completed_at::date, job.scheduled_date, p_issue_date),
        coalesce(source.total, round(job.price, 2))
      from public.jobs job
      join public.properties property on property.id = job.property_id
      left join public.invoices source on source.job_id = job.id and source.id = any(source_invoice_ids)
      where job.id = any(p_job_ids) and job.client_id = p_client_id;

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
