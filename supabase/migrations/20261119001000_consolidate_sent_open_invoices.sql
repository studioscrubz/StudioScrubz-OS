-- Sent, unpaid single-job invoices may be replaced by a consolidated draft.
-- Retain payment and checkout safeguards. Existing creation RPC locks and rechecks this view.
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
      and invoice.amount_paid = 0 and invoice.paid_at is null
      and invoice.total >= 0 and invoice.total = round(invoice.total, 2)
      and invoice.total::text not in ('NaN', 'Infinity', '-Infinity')
      and invoice.balance_due = invoice.total
      and not invoice.deposit_requested and not invoice.is_consolidated
      and invoice.service_agreement_id is null and invoice.contract_billing_type is null
      and not exists (select 1 from public.payments payment where payment.invoice_id = invoice.id)
      and not exists (select 1 from public.square_checkout_attempts checkout
        where checkout.invoice_id = invoice.id
          and (checkout.status in ('Created', 'Pending') or checkout.square_order_id is not null))
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

