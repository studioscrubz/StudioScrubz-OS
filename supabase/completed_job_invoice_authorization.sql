-- StudioScrubz OS Backlog V2-002: authorized automatic Job invoicing.
-- REVIEW ONLY. Run manually in the Supabase SQL editor after review.

create or replace function public.create_completed_job_invoice(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role text;
  job_row public.jobs;
  client_row public.clients;
  proposal_row public.proposals;
  settings_row public.business_settings;
  amount numeric;
  issue_date date := current_date;
  invoice_id uuid;
  invoice_number text;
  line_item_id uuid;
  attempt integer;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  caller_role := public.current_user_role();
  if caller_role not in ('Master Admin', 'Administrator', 'Manager', 'Crew Lead') then
    raise exception 'Job completion invoicing is not permitted.';
  end if;

  select * into job_row
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Job not found.';
  end if;
  if job_row.archived_at is not null or job_row.status = 'Archived' then
    raise exception 'Archived Jobs cannot be invoiced.';
  end if;
  if caller_role = 'Crew Lead' and not public.is_assigned_to_crew(job_row.assigned_crew_id) then
    raise exception 'Job is not assigned to your crew.';
  end if;
  if job_row.status <> 'Completed' then
    raise exception 'Only completed Jobs can be invoiced.';
  end if;

  if job_row.service_occurrence_id is not null and exists (
    select 1
    from public.service_occurrences occurrence
    join public.service_agreements agreement on agreement.id = occurrence.agreement_id
    where occurrence.id = job_row.service_occurrence_id
      and agreement.billing_type in ('Monthly', 'Flat Contract')
  ) then
    return jsonb_build_object(
      'invoice_id', null,
      'invoice_number', null,
      'created', false,
      'skipped', true
    );
  end if;

  select id, i.invoice_number into invoice_id, invoice_number
  from public.invoices i
  where i.job_id = job_row.id
    and i.archived_at is null
    and i.status <> 'Cancelled'
  limit 1;

  if found then
    return jsonb_build_object(
      'invoice_id', invoice_id,
      'invoice_number', invoice_number,
      'created', false,
      'skipped', false
    );
  end if;

  select * into client_row from public.clients where id = job_row.client_id;
  select * into proposal_row from public.proposals where id = job_row.proposal_id;
  select * into settings_row from public.business_settings limit 1;

  amount := greatest(job_row.price, 0);

  for attempt in 1..5 loop
    invoice_number := 'INV-' || to_char(issue_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0');
    line_item_id := gen_random_uuid();
    begin
      insert into public.invoices (
        invoice_number, job_id, service_agreement_id, contract_billing_type,
        billing_period_start, proposal_id, client_id, property_id, client_name,
        property_name, customer_phone, customer_email, service_name, status,
        issue_date, due_date, line_items, subtotal, discount, tax, total,
        amount_paid, balance_due, notes, terms
      ) values (
        invoice_number, job_row.id, null, null,
        null, job_row.proposal_id, job_row.client_id, job_row.property_id,
        job_row.client_name, job_row.property_name,
        coalesce(nullif(btrim(client_row.phone), ''), nullif(btrim(proposal_row.customer_phone), '')),
        coalesce(nullif(btrim(client_row.email), ''), nullif(btrim(proposal_row.customer_email), '')),
        job_row.service_name, 'Open', issue_date,
        issue_date + coalesce(settings_row.default_invoice_due_days, 15),
        jsonb_build_array(jsonb_build_object(
          'id', line_item_id,
          'description', coalesce(nullif(job_row.service_name, ''), 'StudioScrubz service'),
          'quantity', 1,
          'rate', amount,
          'amount', amount
        )),
        amount, 0, 0, amount, 0, amount, job_row.internal_notes,
        coalesce(settings_row.default_invoice_terms, settings_row.default_payment_terms)
      ) returning id into invoice_id;

      return jsonb_build_object(
        'invoice_id', invoice_id,
        'invoice_number', invoice_number,
        'created', true,
        'skipped', false
      );
    exception when unique_violation then
      select id, i.invoice_number into invoice_id, invoice_number
      from public.invoices i
      where i.job_id = job_row.id
        and i.archived_at is null
        and i.status <> 'Cancelled'
      limit 1;

      if found then
        return jsonb_build_object(
          'invoice_id', invoice_id,
          'invoice_number', invoice_number,
          'created', false,
          'skipped', false
        );
      end if;
    end;
  end loop;

  raise exception 'A unique invoice number could not be generated.';
end;
$$;

revoke all on function public.create_completed_job_invoice(uuid) from public, anon, authenticated;
grant execute on function public.create_completed_job_invoice(uuid) to authenticated;
