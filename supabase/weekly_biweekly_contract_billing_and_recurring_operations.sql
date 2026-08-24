-- StudioScrubz OS V2: Weekly/Biweekly contract billing and recurring operations.
-- REVIEW ONLY. Do not execute automatically.

begin;

alter table public.invoices drop constraint if exists invoices_contract_billing_type_check;
alter table public.invoices add constraint invoices_contract_billing_type_check
  check (contract_billing_type in ('Weekly','Biweekly','Monthly','Flat Contract'));

alter table public.invoices drop constraint if exists invoices_source_check;
alter table public.invoices add constraint invoices_source_check check (
  (service_agreement_id is null and contract_billing_type is null and billing_period_start is null)
  or
  (job_id is null and service_agreement_id is not null and contract_billing_type is not null)
);

alter table public.invoices drop constraint if exists invoices_contract_period_check;
alter table public.invoices add constraint invoices_contract_period_check check (
  contract_billing_type is null
  or (contract_billing_type in ('Weekly','Biweekly','Monthly') and billing_period_start is not null)
  or (contract_billing_type = 'Flat Contract' and billing_period_start is null)
);

drop index if exists public.invoices_one_active_monthly_contract_period_idx;
create unique index if not exists invoices_one_active_contract_period_idx
  on public.invoices(service_agreement_id, contract_billing_type, billing_period_start)
  where archived_at is null
    and status not in ('Cancelled','Archived')
    and contract_billing_type in ('Weekly','Biweekly','Monthly');

create or replace function public.validate_contract_invoice_amount()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  agreement_row public.service_agreements;
  prior_total numeric;
  anchor_delta integer;
begin
  if new.contract_billing_type is null then
    return new;
  end if;

  select * into agreement_row
  from public.service_agreements
  where id = new.service_agreement_id
  for update;

  if not found or agreement_row.billing_type is distinct from new.contract_billing_type then
    raise exception 'Contract invoice source does not match the Service Agreement.';
  end if;
  if tg_op = 'INSERT' and (agreement_row.status <> 'Active' or agreement_row.archived_at is not null) then
    raise exception 'Only an Active Service Agreement can create a contract invoice.';
  end if;
  if new.contract_billing_type in ('Monthly','Flat Contract')
    and agreement_row.division <> 'Commercial' then
    raise exception '% contract billing remains limited to Commercial Agreements.', new.contract_billing_type;
  end if;
  if new.archived_at is not null or new.status in ('Cancelled','Archived') then
    return new;
  end if;

  if new.contract_billing_type in ('Weekly','Biweekly','Monthly')
    and round(new.total, 2) <> round(agreement_row.billing_amount, 2) then
    raise exception '% invoice total must equal the Agreement billing amount.', new.contract_billing_type;
  end if;

  if new.contract_billing_type = 'Weekly' then
    anchor_delta := new.billing_period_start - agreement_row.start_date;
    if anchor_delta < 0 or mod(anchor_delta, 7) <> 0 then
      raise exception 'Weekly billing period must be aligned to the Agreement start date.';
    end if;
  elsif new.contract_billing_type = 'Biweekly' then
    anchor_delta := new.billing_period_start - agreement_row.start_date;
    if anchor_delta < 0 or mod(anchor_delta, 14) <> 0 then
      raise exception 'Biweekly billing period must be aligned to the Agreement start date.';
    end if;
  elsif new.contract_billing_type = 'Monthly'
    and extract(day from new.billing_period_start) <> 1 then
    raise exception 'Monthly billing periods must start on the first day of the month.';
  end if;

  if new.contract_billing_type in ('Weekly','Biweekly')
    and agreement_row.end_date is not null
    and new.billing_period_start > agreement_row.end_date then
    raise exception 'Billing period falls after the Agreement term.';
  end if;
  if new.contract_billing_type = 'Monthly'
    and (
      new.billing_period_start < date_trunc('month', agreement_row.start_date)::date
      or (agreement_row.end_date is not null and new.billing_period_start > date_trunc('month', agreement_row.end_date)::date)
    ) then
    raise exception 'Billing month falls outside the Agreement term.';
  end if;

  if new.contract_billing_type = 'Flat Contract' then
    select coalesce(sum(total), 0) into prior_total
    from public.invoices
    where service_agreement_id = new.service_agreement_id
      and contract_billing_type = 'Flat Contract'
      and id <> new.id
      and archived_at is null
      and status not in ('Cancelled','Archived');
    if round(prior_total + new.total, 2) > round(agreement_row.billing_amount, 2) then
      raise exception 'Flat Contract invoices cannot exceed the Agreement contract value.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.validate_contract_invoice_amount() from public, anon, authenticated;
drop trigger if exists invoices_validate_contract_amount on public.invoices;
create trigger invoices_validate_contract_amount
before insert or update of service_agreement_id, contract_billing_type, billing_period_start, total, status, archived_at
on public.invoices for each row execute function public.validate_contract_invoice_amount();

create or replace function public.create_contract_agreement_invoice(
  p_agreement_id uuid,
  p_billing_period_start date default null,
  p_flat_contract_amount numeric default null
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  agreement_row public.service_agreements;
  client_row public.clients;
  settings_row public.business_settings;
  invoice_row public.invoices;
  invoice_amount numeric;
  issue_date date;
  description text;
  attempt integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_profiles
    where id = auth.uid() and is_active
  ) then
    raise exception 'An active authenticated profile is required.';
  end if;
  caller_role := public.current_user_role();
  if caller_role not in ('Master Admin','Administrator') then
    raise exception 'Invoice creation permission is required.';
  end if;

  select * into agreement_row
  from public.service_agreements
  where id = p_agreement_id
  for update;
  if not found or agreement_row.status <> 'Active' or agreement_row.archived_at is not null then
    raise exception 'Only an Active Service Agreement can create a contract invoice.';
  end if;
  if agreement_row.billing_type not in ('Weekly','Biweekly','Monthly','Flat Contract') then
    raise exception 'This Agreement uses Job-level Per Visit billing.';
  end if;
  if agreement_row.billing_amount <= 0 then
    raise exception 'Agreement contract billing amount must be greater than zero.';
  end if;

  if agreement_row.billing_type = 'Weekly' then
    if p_billing_period_start is null
      or p_billing_period_start < agreement_row.start_date
      or mod(p_billing_period_start - agreement_row.start_date, 7) <> 0 then
      raise exception 'Select a Weekly period aligned to the Agreement start date.';
    end if;
    description := 'Weekly contract service - period starting ' || p_billing_period_start::text;
    invoice_amount := agreement_row.billing_amount;
  elsif agreement_row.billing_type = 'Biweekly' then
    if p_billing_period_start is null
      or p_billing_period_start < agreement_row.start_date
      or mod(p_billing_period_start - agreement_row.start_date, 14) <> 0 then
      raise exception 'Select a Biweekly period aligned to the Agreement start date.';
    end if;
    description := 'Biweekly contract service - period starting ' || p_billing_period_start::text;
    invoice_amount := agreement_row.billing_amount;
  elsif agreement_row.billing_type = 'Monthly' then
    if p_billing_period_start is null or extract(day from p_billing_period_start) <> 1 then
      raise exception 'Select a valid Monthly billing period.';
    end if;
    description := 'Monthly contract service - ' || to_char(p_billing_period_start, 'YYYY-MM');
    invoice_amount := agreement_row.billing_amount;
  else
    if p_billing_period_start is not null then
      raise exception 'Flat Contract progress invoices do not use a billing period.';
    end if;
    invoice_amount := round(coalesce(p_flat_contract_amount, 0), 2);
    if invoice_amount <= 0 then raise exception 'Invoice amount must be greater than zero.'; end if;
    description := 'Flat Contract progress billing';
  end if;

  -- The trigger independently enforces term alignment, amount, and contract cap.
  issue_date := (now() at time zone coalesce((select timezone from public.business_settings limit 1), 'UTC'))::date;
  select * into client_row from public.clients where id = agreement_row.client_id;
  select * into settings_row from public.business_settings limit 1;

  for attempt in 1..5 loop
    begin
      insert into public.invoices (
        invoice_number, job_id, service_agreement_id, contract_billing_type, billing_period_start,
        proposal_id, client_id, property_id, client_name, property_name, customer_phone,
        customer_email, service_name, status, issue_date, due_date, line_items, subtotal,
        discount, tax, total, amount_paid, balance_due, notes, terms
      ) values (
        'INV-' || to_char(issue_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'),
        null, agreement_row.id, agreement_row.billing_type, p_billing_period_start,
        agreement_row.proposal_id, agreement_row.client_id, agreement_row.property_id,
        coalesce(client_row.company_name, nullif(concat_ws(' ', client_row.first_name, client_row.last_name), ''), 'Client'),
        (select coalesce(property_name, address, 'Service location') from public.properties where id = agreement_row.property_id),
        client_row.phone, client_row.email, agreement_row.service_name, 'Open', issue_date,
        issue_date + coalesce(settings_row.default_invoice_due_days, 15),
        jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'description', description, 'quantity', 1, 'rate', invoice_amount, 'amount', invoice_amount)),
        invoice_amount, 0, 0, invoice_amount, 0, invoice_amount, null,
        coalesce(settings_row.default_invoice_terms, settings_row.default_payment_terms)
      ) returning * into invoice_row;
      return invoice_row;
    exception when unique_violation then
      if agreement_row.billing_type in ('Weekly','Biweekly','Monthly') and exists (
        select 1 from public.invoices
        where service_agreement_id = agreement_row.id
          and contract_billing_type = agreement_row.billing_type
          and billing_period_start = p_billing_period_start
          and archived_at is null and status not in ('Cancelled','Archived')
      ) then
        raise exception 'An active % Invoice already exists for this billing period.', agreement_row.billing_type;
      end if;
    end;
  end loop;
  raise exception 'A unique Invoice number could not be generated.';
end;
$$;

revoke all on function public.create_contract_agreement_invoice(uuid,date,numeric) from public, anon, authenticated;
grant execute on function public.create_contract_agreement_invoice(uuid,date,numeric) to authenticated;

create or replace function public.create_job_from_service_occurrence(p_occurrence_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  occurrence_row public.service_occurrences;
  agreement_row public.service_agreements;
  client_row public.clients;
  property_row public.properties;
  crew_row public.crews;
  proposal_row public.proposals;
  job_row public.jobs;
  team jsonb := '[]'::jsonb;
  job_amount numeric;
  job_date date;
  attempt integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_profiles where id = auth.uid() and is_active
  ) then raise exception 'An active authenticated profile is required.'; end if;
  caller_role := public.current_user_role();
  if caller_role not in ('Master Admin','Administrator','Manager') then
    raise exception 'Job creation permission is required.';
  end if;

  select * into occurrence_row from public.service_occurrences
  where id = p_occurrence_id for update;
  if not found then raise exception 'Service occurrence not found.'; end if;

  select * into agreement_row from public.service_agreements
  where id = occurrence_row.agreement_id for update;
  if not found or agreement_row.status <> 'Active' or agreement_row.archived_at is not null then
    raise exception 'Jobs can only be created for an Active Service Agreement.';
  end if;

  if occurrence_row.job_id is not null then
    select * into job_row from public.jobs where id = occurrence_row.job_id and archived_at is null;
    if found then return job_row; end if;
  end if;
  select * into job_row from public.jobs
  where service_occurrence_id = occurrence_row.id and archived_at is null limit 1;
  if found then
    update public.service_occurrences set job_id = job_row.id, status = 'Job Created'
    where id = occurrence_row.id;
    return job_row;
  end if;
  if occurrence_row.status <> 'Scheduled' then
    raise exception 'Only a Scheduled occurrence can create a Job.';
  end if;
  if occurrence_row.scheduled_date < agreement_row.start_date
    or (agreement_row.end_date is not null and not agreement_row.auto_renew and occurrence_row.scheduled_date > agreement_row.end_date) then
    raise exception 'Service occurrence falls outside the active Agreement term.';
  end if;

  select * into client_row from public.clients where id = agreement_row.client_id and archived_at is null;
  select * into property_row from public.properties where id = agreement_row.property_id and archived_at is null;
  if client_row.id is null or property_row.id is null then
    raise exception 'The Agreement requires active Client and Property relationships.';
  end if;
  if agreement_row.proposal_id is not null then
    select * into proposal_row from public.proposals where id = agreement_row.proposal_id;
  end if;
  if occurrence_row.assigned_crew_id is not null then
    select * into crew_row from public.crews
    where id = occurrence_row.assigned_crew_id
      and status = 'Active'
      and archived_at is null;
    if not found then
      raise exception 'The occurrence assigned crew is no longer active. Update the occurrence crew before creating the Job.';
    end if;
    select coalesce(jsonb_agg(coalesce(e.preferred_name, nullif(trim(e.first_name || ' ' || e.last_name), '')) order by e.last_name), '[]'::jsonb)
    into team from public.crew_members cm join public.employees e on e.id = cm.employee_id
    where cm.crew_id = crew_row.id;
  end if;
  job_amount := case when agreement_row.billing_type = 'Per Visit' then agreement_row.billing_amount else 0 end;
  job_date := (now() at time zone coalesce((select timezone from public.business_settings limit 1), 'UTC'))::date;

  for attempt in 1..5 loop
    begin
      insert into public.jobs (
        job_number, proposal_id, estimate_id, walkthrough_id, service_occurrence_id,
        client_id, property_id, division, client_name, property_name, service_name,
        frequency, status, scheduled_date, start_time, estimated_duration,
        assigned_crew_id, assigned_crew_name, crew_lead_name, assigned_team,
        price, deposit, balance, labor_hours, recommended_crew_size, scope,
        checklist, photos, access_instructions, internal_notes, completed_at
      ) values (
        'JOB-' || to_char(job_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'),
        agreement_row.proposal_id, proposal_row.estimate_id, proposal_row.walkthrough_id, occurrence_row.id,
        agreement_row.client_id, agreement_row.property_id, agreement_row.division,
        coalesce(client_row.company_name, nullif(concat_ws(' ', client_row.first_name, client_row.last_name), ''), 'Client'),
        coalesce(property_row.property_name, property_row.address), agreement_row.service_name,
        agreement_row.frequency, case when occurrence_row.assigned_crew_id is null then 'Scheduled' else 'Crew Assigned' end,
        occurrence_row.scheduled_date, occurrence_row.scheduled_start_time, agreement_row.estimated_duration,
        occurrence_row.assigned_crew_id, crew_row.crew_name,
        (select coalesce(e.preferred_name, nullif(trim(e.first_name || ' ' || e.last_name), '')) from public.employees e where e.id = crew_row.crew_lead_id),
        team, job_amount, 0, job_amount, 0, greatest(jsonb_array_length(team), 1), agreement_row.scope,
        '[]'::jsonb, '[]'::jsonb, agreement_row.special_instructions, agreement_row.notes, null
      ) returning * into job_row;

      update public.service_occurrences set job_id = job_row.id, status = 'Job Created'
      where id = occurrence_row.id;
      return job_row;
    exception when unique_violation then
      select * into job_row from public.jobs
      where service_occurrence_id = occurrence_row.id and archived_at is null limit 1;
      if found then
        update public.service_occurrences set job_id = job_row.id, status = 'Job Created'
        where id = occurrence_row.id;
        return job_row;
      end if;
    end;
  end loop;
  raise exception 'A unique Job number could not be generated.';
end;
$$;

revoke all on function public.create_job_from_service_occurrence(uuid) from public, anon, authenticated;
grant execute on function public.create_job_from_service_occurrence(uuid) to authenticated;

create or replace function public.sync_service_occurrence_job_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.service_occurrence_id is not null and new.status is distinct from old.status then
    update public.service_occurrences
    set status = case
      when new.status = 'Completed' then 'Completed'
      when new.status = 'Cancelled' then 'Cancelled'
      else 'Job Created'
    end,
    job_id = new.id
    where id = new.service_occurrence_id
      and (job_id is null or job_id = new.id);
    if not found then
      raise exception 'The linked Service occurrence could not be synchronized with this Job.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_service_occurrence_job_status() from public, anon, authenticated;
drop trigger if exists jobs_sync_service_occurrence_status on public.jobs;
create trigger jobs_sync_service_occurrence_status
after update of status on public.jobs for each row
execute function public.sync_service_occurrence_job_status();

create or replace function public.create_completed_job_invoice(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  caller_role text; job_row public.jobs; client_row public.clients; proposal_row public.proposals;
  settings_row public.business_settings; amount numeric; issue_date date := current_date;
  invoice_id uuid; invoice_number text; line_item_id uuid; attempt integer;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  caller_role := public.current_user_role();
  if caller_role not in ('Master Admin','Administrator','Manager','Crew Lead') then raise exception 'Job completion invoicing is not permitted.'; end if;
  select * into job_row from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if job_row.archived_at is not null or job_row.status = 'Archived' then raise exception 'Archived Jobs cannot be invoiced.'; end if;
  if caller_role = 'Crew Lead' and not public.is_assigned_to_crew(job_row.assigned_crew_id) then raise exception 'Job is not assigned to your crew.'; end if;
  if job_row.status <> 'Completed' then raise exception 'Only completed Jobs can be invoiced.'; end if;
  if job_row.service_occurrence_id is not null and exists (
    select 1 from public.service_occurrences o join public.service_agreements a on a.id = o.agreement_id
    where o.id = job_row.service_occurrence_id and a.billing_type in ('Weekly','Biweekly','Monthly','Flat Contract')
  ) then return jsonb_build_object('invoice_id',null,'invoice_number',null,'created',false,'skipped',true); end if;
  select id,i.invoice_number into invoice_id,invoice_number from public.invoices i
  where i.job_id=job_row.id and i.archived_at is null and i.status<>'Cancelled' limit 1;
  if found then return jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'created',false,'skipped',false); end if;
  select * into client_row from public.clients where id=job_row.client_id;
  select * into proposal_row from public.proposals where id=job_row.proposal_id;
  select * into settings_row from public.business_settings limit 1;
  amount:=greatest(job_row.price,0);
  for attempt in 1..5 loop
    invoice_number:='INV-'||to_char(issue_date,'YYYYMMDD')||'-'||lpad(floor(random()*10000)::text,4,'0'); line_item_id:=gen_random_uuid();
    begin
      insert into public.invoices(invoice_number,job_id,service_agreement_id,contract_billing_type,billing_period_start,proposal_id,client_id,property_id,client_name,property_name,customer_phone,customer_email,service_name,status,issue_date,due_date,line_items,subtotal,discount,tax,total,amount_paid,balance_due,notes,terms)
      values(invoice_number,job_row.id,null,null,null,job_row.proposal_id,job_row.client_id,job_row.property_id,job_row.client_name,job_row.property_name,coalesce(nullif(btrim(client_row.phone),''),nullif(btrim(proposal_row.customer_phone),'')),coalesce(nullif(btrim(client_row.email),''),nullif(btrim(proposal_row.customer_email),'')),job_row.service_name,'Open',issue_date,issue_date+coalesce(settings_row.default_invoice_due_days,15),jsonb_build_array(jsonb_build_object('id',line_item_id,'description',coalesce(nullif(job_row.service_name,''),'StudioScrubz service'),'quantity',1,'rate',amount,'amount',amount)),amount,0,0,amount,0,amount,job_row.internal_notes,coalesce(settings_row.default_invoice_terms,settings_row.default_payment_terms)) returning id into invoice_id;
      return jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'created',true,'skipped',false);
    exception when unique_violation then
      select id,i.invoice_number into invoice_id,invoice_number from public.invoices i where i.job_id=job_row.id and i.archived_at is null and i.status<>'Cancelled' limit 1;
      if found then return jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'created',false,'skipped',false); end if;
    end;
  end loop;
  raise exception 'A unique Invoice number could not be generated.';
end;
$$;
revoke all on function public.create_completed_job_invoice(uuid) from public, anon, authenticated;
grant execute on function public.create_completed_job_invoice(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
