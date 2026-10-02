-- Lead Representative Portal Phase 2: authoritative, append-only commission ledger.
-- This migration intentionally performs no historical backfill.
begin;

create table public.lead_commission_policies (
  policy_key text primary key,
  version smallint not null check (version = 1),
  effective_at timestamptz not null,
  new_customer_amount numeric(12,2) not null check (new_customer_amount = 25.00),
  personally_close_amount numeric(12,2) not null check (personally_close_amount = 40.00),
  recurring_conversion_amount numeric(12,2) not null check (recurring_conversion_amount = 25.00),
  created_at timestamptz not null default now()
);

insert into public.lead_commission_policies(
  policy_key, version, effective_at, new_customer_amount,
  personally_close_amount, recurring_conversion_amount
) values ('LEAD_REP_2026_10_02', 1, transaction_timestamp(), 25.00, 40.00, 25.00);

create table public.lead_commission_customer_origins (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null references public.lead_commission_policies(policy_key) on delete restrict,
  estimate_id uuid not null unique references public.estimates(id) on delete restrict,
  client_id uuid not null unique references public.clients(id) on delete restrict,
  lead_representative_id uuid not null references public.employees(id) on delete restrict,
  attributed_at_snapshot timestamptz not null,
  customer_name_snapshot text not null,
  service_name_snapshot text not null,
  established_at timestamptz not null default now(),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object')
);

create table public.lead_personally_close_events (
  id uuid primary key default gen_random_uuid(),
  customer_origin_id uuid not null references public.lead_commission_customer_origins(id) on delete restrict,
  event_type text not null check (event_type in (
    'AUTHORIZED','AUTHORIZATION_REVOKED','BOOKING_QUALIFIED','BOOKING_QUALIFICATION_REVOKED'
  )),
  lead_representative_id uuid not null references public.employees(id) on delete restrict,
  proposal_id uuid references public.proposals(id) on delete restrict,
  actor_user_id uuid not null references public.user_profiles(id) on delete restrict,
  reason text not null check (nullif(btrim(reason), '') is not null),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now()
);

create index lead_personally_close_events_origin_created_idx
on public.lead_personally_close_events(customer_origin_id, created_at, id);

create table public.lead_commission_cleaning_qualifications (
  id uuid primary key default gen_random_uuid(),
  customer_origin_id uuid not null references public.lead_commission_customer_origins(id) on delete restrict,
  cleaning_ordinal smallint not null check (cleaning_ordinal in (1,2)),
  job_id uuid not null unique references public.jobs(id) on delete restrict,
  proposal_id uuid references public.proposals(id) on delete restrict,
  service_agreement_id uuid references public.service_agreements(id) on delete restrict,
  eligible_service_amount numeric(12,2) not null check (
    eligible_service_amount > 0 and eligible_service_amount = round(eligible_service_amount, 2)
  ),
  job_price_snapshot numeric(12,2) not null check (
    job_price_snapshot > 0 and job_price_snapshot = round(job_price_snapshot, 2)
  ),
  completed_at_snapshot timestamptz not null,
  job_number_snapshot text not null,
  service_name_snapshot text not null,
  qualified_at timestamptz not null default now(),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  unique(customer_origin_id, cleaning_ordinal),
  check ((cleaning_ordinal = 1) or service_agreement_id is not null)
);

create table public.lead_commission_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  cleaning_qualification_id uuid not null references public.lead_commission_cleaning_qualifications(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete restrict,
  source_type text not null check (source_type in ('INVOICE_PAYMENT','DEPOSIT')),
  gross_service_collection numeric(12,2) not null check (gross_service_collection >= 0),
  eligible_service_collection numeric(12,2) not null check (eligible_service_collection >= 0),
  allocation_method text not null,
  allocation_evidence jsonb not null check (jsonb_typeof(allocation_evidence) = 'object'),
  allocated_at timestamptz not null default now(),
  unique(cleaning_qualification_id, payment_id, source_type)
);

create table public.lead_commission_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_origin_id uuid not null references public.lead_commission_customer_origins(id) on delete restrict,
  cleaning_qualification_id uuid not null references public.lead_commission_cleaning_qualifications(id) on delete restrict,
  lead_representative_id uuid not null references public.employees(id) on delete restrict,
  estimate_id uuid not null references public.estimates(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete restrict,
  proposal_id uuid references public.proposals(id) on delete restrict,
  service_agreement_id uuid references public.service_agreements(id) on delete restrict,
  event_type text not null check (event_type in (
    'NEW_CUSTOMER_LEAD','GENERATE_PERSONALLY_CLOSE','RECURRING_CONVERSION_BONUS','REVERSAL'
  )),
  policy_key text not null references public.lead_commission_policies(policy_key) on delete restrict,
  policy_version smallint not null,
  commission_amount numeric(12,2) not null check (
    commission_amount <> 0 and commission_amount = round(commission_amount, 2)
  ),
  eligible_service_amount_snapshot numeric(12,2) not null,
  collected_amount_snapshot numeric(12,2) not null,
  customer_name_snapshot text not null,
  service_name_snapshot text not null,
  job_number_snapshot text not null,
  cleaning_ordinal smallint not null check (cleaning_ordinal in (1,2)),
  earned_at timestamptz not null,
  payout_status text not null default 'EARNED_UNPAID' check (payout_status = 'EARNED_UNPAID'),
  reversal_of_id uuid references public.lead_commission_ledger(id) on delete restrict,
  source_event jsonb not null check (jsonb_typeof(source_event) = 'object'),
  created_by_type text not null check (created_by_type = 'SYSTEM_RECONCILIATION'),
  created_at timestamptz not null default now(),
  check (
    (event_type = 'REVERSAL' and commission_amount < 0 and reversal_of_id is not null)
    or (event_type <> 'REVERSAL' and commission_amount > 0 and reversal_of_id is null)
  ),
  check (
    (event_type = 'NEW_CUSTOMER_LEAD' and commission_amount = 25.00 and cleaning_ordinal = 1)
    or (event_type = 'GENERATE_PERSONALLY_CLOSE' and commission_amount = 40.00 and cleaning_ordinal = 1)
    or (event_type = 'RECURRING_CONVERSION_BONUS' and commission_amount = 25.00 and cleaning_ordinal = 2)
    or event_type = 'REVERSAL'
  )
);

create unique index lead_commission_one_initial_per_origin
on public.lead_commission_ledger(customer_origin_id)
where event_type in ('NEW_CUSTOMER_LEAD','GENERATE_PERSONALLY_CLOSE');
create unique index lead_commission_one_recurring_bonus_per_origin
on public.lead_commission_ledger(customer_origin_id)
where event_type = 'RECURRING_CONVERSION_BONUS';
create unique index lead_commission_one_reversal_per_entry
on public.lead_commission_ledger(reversal_of_id)
where event_type = 'REVERSAL';

alter table public.lead_commission_policies enable row level security;
alter table public.lead_commission_customer_origins enable row level security;
alter table public.lead_personally_close_events enable row level security;
alter table public.lead_commission_cleaning_qualifications enable row level security;
alter table public.lead_commission_payment_allocations enable row level security;
alter table public.lead_commission_ledger enable row level security;

revoke all on table public.lead_commission_policies,
  public.lead_commission_customer_origins,
  public.lead_personally_close_events,
  public.lead_commission_cleaning_qualifications,
  public.lead_commission_payment_allocations,
  public.lead_commission_ledger
from public, anon, authenticated;
grant select on table public.lead_commission_policies,
  public.lead_commission_customer_origins,
  public.lead_personally_close_events,
  public.lead_commission_cleaning_qualifications,
  public.lead_commission_payment_allocations,
  public.lead_commission_ledger
to service_role;

create function private.reject_lead_commission_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'Lead commission financial history is append-only.';
end;
$$;
revoke all on function private.reject_lead_commission_mutation() from public, anon, authenticated;

create trigger lead_commission_policies_immutable before update or delete on public.lead_commission_policies
for each row execute function private.reject_lead_commission_mutation();
create trigger lead_commission_origins_immutable before update or delete on public.lead_commission_customer_origins
for each row execute function private.reject_lead_commission_mutation();
create trigger lead_personally_close_events_immutable before update or delete on public.lead_personally_close_events
for each row execute function private.reject_lead_commission_mutation();
create trigger lead_commission_cleanings_immutable before update or delete on public.lead_commission_cleaning_qualifications
for each row execute function private.reject_lead_commission_mutation();
create trigger lead_commission_allocations_immutable before update or delete on public.lead_commission_payment_allocations
for each row execute function private.reject_lead_commission_mutation();
create trigger lead_commission_ledger_immutable before update or delete on public.lead_commission_ledger
for each row execute function private.reject_lead_commission_mutation();

create function private.lead_commission_eligible_service_amount(p_job public.jobs)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare tax_amount numeric := 0;
begin
  if p_job.price is null or p_job.price <= 0 or p_job.price <> round(p_job.price, 2) then return null; end if;
  if p_job.proposal_id is not null then
    select greatest(coalesce((proposal.result->>'taxes')::numeric, 0), 0)
    into tax_amount from public.proposals proposal where proposal.id = p_job.proposal_id;
  end if;
  return round(greatest(p_job.price - coalesce(tax_amount, 0), 0), 2);
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end;
$$;
revoke all on function private.lead_commission_eligible_service_amount(public.jobs) from public, anon, authenticated;

create function private.ensure_lead_commission_payment_allocations(p_qualification_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.lead_commission_cleaning_qualifications; payment_row public.payments;
  invoice_row public.invoices; gross_alloc numeric; eligible_alloc numeric; total_weight numeric;
  line_weight numeric; deposit_payment public.payments;
begin
  select * into q from public.lead_commission_cleaning_qualifications where id = p_qualification_id;
  if not found then return; end if;

  for payment_row in
    select payment.* from public.payments payment
    join public.invoices invoice on invoice.id = payment.invoice_id
    where payment.voided_at is null and (
      invoice.job_id = q.job_id or exists (
        select 1 from public.invoice_job_lines line
        where line.invoice_id = invoice.id and line.job_id = q.job_id
      )
    ) order by payment.created_at, payment.id
  loop
    select * into invoice_row from public.invoices where id = payment_row.invoice_id;
    if invoice_row.job_id = q.job_id then
      gross_alloc := least(payment_row.amount, q.job_price_snapshot);
      line_weight := q.job_price_snapshot;
      total_weight := greatest(invoice_row.total, q.job_price_snapshot);
    else
      with weights as (
        select line.job_id, line.amount,
          sum(line.amount) over () as total_amount
        from public.invoice_job_lines line where line.invoice_id = invoice_row.id
      ), bases as (
        select weights.*,
          trunc(payment_row.amount * amount / nullif(total_amount, 0), 2) as base_amount
        from weights
      ), distributed as (
        select bases.*,
          row_number() over (order by job_id) as remainder_rank,
          round((payment_row.amount - sum(base_amount) over ()) * 100)::integer as remainder_cents
        from bases
      )
      select amount, total_amount,
        least(amount, base_amount + case when remainder_rank <= remainder_cents then 0.01 else 0 end)
      into line_weight, total_weight, gross_alloc
      from distributed where job_id = q.job_id;
    end if;
    eligible_alloc := least(q.eligible_service_amount,
      round(gross_alloc * q.eligible_service_amount / q.job_price_snapshot, 2));
    insert into public.lead_commission_payment_allocations(
      cleaning_qualification_id, payment_id, invoice_id, source_type,
      gross_service_collection, eligible_service_collection, allocation_method, allocation_evidence
    ) values (
      q.id, payment_row.id, payment_row.invoice_id, 'INVOICE_PAYMENT', gross_alloc,
      eligible_alloc, case when invoice_row.job_id = q.job_id then 'DIRECT_JOB'
        else 'CONSOLIDATED_PROPORTIONAL_TRUNCATED_CENTS' end,
      jsonb_build_object('paymentAmount', payment_row.amount, 'jobWeight', line_weight,
        'invoiceWeight', total_weight, 'tipsExcluded', true, 'taxExcluded', true)
    ) on conflict (cleaning_qualification_id, payment_id, source_type) do nothing;
  end loop;

  if q.cleaning_ordinal = 1 and q.proposal_id is not null then
    select payment.* into deposit_payment
    from public.payments payment
    join public.proposal_deposit_requirements requirement
      on requirement.id = payment.deposit_requirement_id
    where requirement.proposal_id = q.proposal_id and payment.voided_at is null
    order by payment.created_at, payment.id limit 1;
    if found then
      insert into public.lead_commission_payment_allocations(
        cleaning_qualification_id, payment_id, invoice_id, source_type,
        gross_service_collection, eligible_service_collection, allocation_method, allocation_evidence
      ) values (
        q.id, deposit_payment.id, deposit_payment.invoice_id, 'DEPOSIT',
        least(deposit_payment.amount, q.job_price_snapshot),
        least(round(deposit_payment.amount * q.eligible_service_amount / q.job_price_snapshot, 2), q.eligible_service_amount),
        'PROPOSAL_DEPOSIT_TO_CLEANING_1',
        jsonb_build_object('proposalId', q.proposal_id, 'paymentAmount', deposit_payment.amount,
          'permanentCleaningOrdinal', 1)
      ) on conflict (cleaning_qualification_id, payment_id, source_type) do nothing;
    end if;
  end if;
end;
$$;
revoke all on function private.ensure_lead_commission_payment_allocations(uuid) from public, anon, authenticated;

create function private.lead_commission_collected_amount(p_qualification_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select least(qualification.eligible_service_amount, round(
    coalesce(sum(allocation.gross_service_collection) filter (where
      payment.voided_at is null
      and not (allocation.source_type = 'DEPOSIT' and payment.invoice_id is not null)
    ), 0)
      * qualification.eligible_service_amount / qualification.job_price_snapshot,
    2
  ))
  from public.lead_commission_cleaning_qualifications qualification
  left join public.lead_commission_payment_allocations allocation
    on allocation.cleaning_qualification_id = qualification.id
  left join public.payments payment on payment.id = allocation.payment_id
  where qualification.id = p_qualification_id
  group by qualification.eligible_service_amount, qualification.job_price_snapshot
$$;
revoke all on function private.lead_commission_collected_amount(uuid) from public, anon, authenticated;

create function private.reconcile_lead_commission_qualification(p_qualification_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.lead_commission_cleaning_qualifications; origin public.lead_commission_customer_origins;
  policy public.lead_commission_policies; collected numeric; commission_type text; commission_value numeric;
  authorization_event public.lead_personally_close_events; booking_event public.lead_personally_close_events;
  prior public.lead_commission_ledger;
begin
  perform pg_advisory_xact_lock(hashtext('lead-commission:' || p_qualification_id::text));
  select * into q from public.lead_commission_cleaning_qualifications where id = p_qualification_id;
  if not found then return; end if;
  select * into origin from public.lead_commission_customer_origins where id = q.customer_origin_id;
  select * into policy from public.lead_commission_policies where policy_key = origin.policy_key;
  perform private.ensure_lead_commission_payment_allocations(q.id);
  collected := private.lead_commission_collected_amount(q.id);

  if q.cleaning_ordinal = 1 then
    select * into authorization_event from public.lead_personally_close_events event
    where event.customer_origin_id = origin.id and event.event_type in ('AUTHORIZED','AUTHORIZATION_REVOKED')
    order by event.created_at desc, event.id desc limit 1;
    select * into booking_event from public.lead_personally_close_events event
    where event.customer_origin_id = origin.id and event.event_type in ('BOOKING_QUALIFIED','BOOKING_QUALIFICATION_REVOKED')
    order by event.created_at desc, event.id desc limit 1;
    if authorization_event.event_type = 'AUTHORIZED'
      and booking_event.event_type = 'BOOKING_QUALIFIED'
      and booking_event.created_at >= authorization_event.created_at
      and authorization_event.lead_representative_id = origin.lead_representative_id
      and booking_event.lead_representative_id = origin.lead_representative_id
    then commission_type := 'GENERATE_PERSONALLY_CLOSE'; commission_value := policy.personally_close_amount;
    else commission_type := 'NEW_CUSTOMER_LEAD'; commission_value := policy.new_customer_amount; end if;
  else
    commission_type := 'RECURRING_CONVERSION_BONUS'; commission_value := policy.recurring_conversion_amount;
  end if;

  if collected >= q.eligible_service_amount then
    insert into public.lead_commission_ledger(
      customer_origin_id, cleaning_qualification_id, lead_representative_id,
      estimate_id, client_id, job_id, proposal_id, service_agreement_id,
      event_type, policy_key, policy_version, commission_amount,
      eligible_service_amount_snapshot, collected_amount_snapshot,
      customer_name_snapshot, service_name_snapshot, job_number_snapshot,
      cleaning_ordinal, earned_at, source_event, created_by_type
    ) values (
      origin.id, q.id, origin.lead_representative_id, origin.estimate_id, origin.client_id,
      q.job_id, q.proposal_id, q.service_agreement_id, commission_type,
      policy.policy_key, policy.version, commission_value, q.eligible_service_amount,
      collected, origin.customer_name_snapshot, q.service_name_snapshot, q.job_number_snapshot,
      q.cleaning_ordinal, now(), jsonb_build_object(
        'qualificationId', q.id, 'collectionAllocationIds', coalesce((select jsonb_agg(a.id order by a.allocated_at, a.id)
          from public.lead_commission_payment_allocations a join public.payments p on p.id = a.payment_id
          where a.cleaning_qualification_id = q.id and p.voided_at is null
            and not (a.source_type = 'DEPOSIT' and p.invoice_id is not null)), '[]'::jsonb),
        'authorizationEventId', authorization_event.id, 'bookingQualificationEventId', booking_event.id,
        'fullCollectionRequired', true, 'employeeCommissionRateConsulted', false
      ), 'SYSTEM_RECONCILIATION'
    ) on conflict do nothing;
  else
    select * into prior from public.lead_commission_ledger entry
    where entry.cleaning_qualification_id = q.id and entry.event_type <> 'REVERSAL'
    order by entry.created_at limit 1;
    if found then
      insert into public.lead_commission_ledger(
        customer_origin_id, cleaning_qualification_id, lead_representative_id,
        estimate_id, client_id, job_id, proposal_id, service_agreement_id,
        event_type, policy_key, policy_version, commission_amount,
        eligible_service_amount_snapshot, collected_amount_snapshot,
        customer_name_snapshot, service_name_snapshot, job_number_snapshot,
        cleaning_ordinal, earned_at, reversal_of_id, source_event, created_by_type
      ) values (
        prior.customer_origin_id, prior.cleaning_qualification_id, prior.lead_representative_id,
        prior.estimate_id, prior.client_id, prior.job_id, prior.proposal_id, prior.service_agreement_id,
        'REVERSAL', prior.policy_key, prior.policy_version, -prior.commission_amount,
        prior.eligible_service_amount_snapshot, collected, prior.customer_name_snapshot,
        prior.service_name_snapshot, prior.job_number_snapshot, prior.cleaning_ordinal,
        now(), prior.id, jsonb_build_object('reason', 'Authoritative payment void reduced collection below 100%',
          'collectedAfterVoid', collected), 'SYSTEM_RECONCILIATION'
      ) on conflict do nothing;
    end if;
  end if;
end;
$$;
revoke all on function private.reconcile_lead_commission_qualification(uuid) from public, anon, authenticated;

create function private.qualify_completed_lead_commission_job(p_job_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare job_row public.jobs; estimate_row public.estimates; proposal_row public.proposals;
  origin public.lead_commission_customer_origins; q public.lead_commission_cleaning_qualifications;
  policy public.lead_commission_policies; agreement_row public.service_agreements;
  ordinal smallint; eligible numeric; customer_name text;
begin
  select * into job_row from public.jobs where id = p_job_id for update;
  if not found or job_row.status <> 'Completed' or job_row.completed_at is null or job_row.archived_at is not null then return; end if;
  select * into policy from public.lead_commission_policies order by effective_at desc limit 1;
  if job_row.completed_at < policy.effective_at then return; end if;
  if job_row.proposal_id is not null then select * into proposal_row from public.proposals where id = job_row.proposal_id; end if;
  select * into estimate_row from public.estimates
  where id = coalesce(job_row.estimate_id, proposal_row.estimate_id);
  if not found or estimate_row.lead_representative_id is null or estimate_row.client_id is null
    or estimate_row.client_id is distinct from job_row.client_id then return; end if;
  eligible := private.lead_commission_eligible_service_amount(job_row);
  if eligible is null or eligible <= 0 then return; end if;
  select coalesce(nullif(btrim(client.company_name), ''),
    nullif(btrim(concat_ws(' ', client.first_name, client.last_name)), ''), 'Customer')
  into customer_name from public.clients client where client.id = job_row.client_id;
  insert into public.lead_commission_customer_origins(
    policy_key, estimate_id, client_id, lead_representative_id, attributed_at_snapshot,
    customer_name_snapshot, service_name_snapshot, evidence
  ) values (
    policy.policy_key, estimate_row.id, estimate_row.client_id, estimate_row.lead_representative_id,
    estimate_row.created_at, customer_name, coalesce(nullif(btrim(estimate_row.service_name), ''), job_row.service_name),
    jsonb_build_object('source', 'estimates.lead_representative_id', 'estimateId', estimate_row.id,
      'clientId', estimate_row.client_id, 'leadRepresentativeId', estimate_row.lead_representative_id)
  ) on conflict (client_id) do nothing;
  select * into origin from public.lead_commission_customer_origins where client_id = job_row.client_id for update;
  if origin.estimate_id is distinct from estimate_row.id then return; end if;
  if job_row.service_occurrence_id is not null then
    select agreement.* into agreement_row
    from public.service_occurrences occurrence
    join public.service_agreements agreement on agreement.id = occurrence.agreement_id
    join public.proposals proposal on proposal.id = agreement.proposal_id
    where occurrence.id = job_row.service_occurrence_id
      and agreement.client_id = origin.client_id
      and proposal.estimate_id = origin.estimate_id;
  end if;
  if not exists (select 1 from public.lead_commission_cleaning_qualifications existing where existing.customer_origin_id = origin.id and existing.cleaning_ordinal = 1) then
    ordinal := 1;
  elsif not exists (select 1 from public.lead_commission_cleaning_qualifications existing where existing.customer_origin_id = origin.id and existing.cleaning_ordinal = 2) then
    if agreement_row.id is null
      or agreement_row.status not in ('Accepted','Active')
      or agreement_row.frequency = 'One-Time'
      or agreement_row.client_signed_at is null
      or agreement_row.accepted_at is null
    then return; end if;
    ordinal := 2;
  else return; end if;
  insert into public.lead_commission_cleaning_qualifications(
    customer_origin_id, cleaning_ordinal, job_id, proposal_id, service_agreement_id,
    eligible_service_amount, job_price_snapshot, completed_at_snapshot,
    job_number_snapshot, service_name_snapshot, evidence
  ) values (
    origin.id, ordinal, job_row.id, job_row.proposal_id,
    agreement_row.id,
    eligible, round(job_row.price, 2), job_row.completed_at, job_row.job_number,
    coalesce(nullif(btrim(job_row.service_name), ''), origin.service_name_snapshot),
    jsonb_build_object('status', 'Completed', 'completedAt', job_row.completed_at,
      'immutableOrdinal', ordinal, 'eligibleAmountSource', 'jobs.price less proposal.result.taxes',
      'serviceAgreementId', agreement_row.id,
      'recurringAgreementId', case when ordinal = 2 then agreement_row.id else null end)
  ) on conflict do nothing returning * into q;
  if not found then select * into q from public.lead_commission_cleaning_qualifications where job_id = job_row.id; end if;
  if q.id is not null then perform private.reconcile_lead_commission_qualification(q.id); end if;
end;
$$;
revoke all on function private.qualify_completed_lead_commission_job(uuid) from public, anon, authenticated;

create function private.process_lead_commission_job_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'Completed' and new.completed_at is not null
    and (tg_op = 'INSERT' or old.status is distinct from 'Completed') then
    perform private.qualify_completed_lead_commission_job(new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.process_lead_commission_job_event() from public, anon, authenticated;
create trigger jobs_process_lead_commission_completion
after insert or update of status on public.jobs
for each row execute function private.process_lead_commission_job_event();

create function private.process_lead_commission_payment_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare q record;
begin
  for q in
    select qualification.id from public.lead_commission_cleaning_qualifications qualification
    where qualification.job_id = coalesce(new.job_id, old.job_id)
      or exists (
        select 1 from public.invoices invoice
        left join public.invoice_job_lines line on line.invoice_id = invoice.id
        where invoice.id = coalesce(new.invoice_id, old.invoice_id)
          and (invoice.job_id = qualification.job_id or line.job_id = qualification.job_id)
      )
      or exists (
        select 1 from public.proposal_deposit_requirements requirement
        where requirement.id = coalesce(new.deposit_requirement_id, old.deposit_requirement_id)
          and qualification.cleaning_ordinal = 1 and qualification.proposal_id = requirement.proposal_id
      )
  loop perform private.reconcile_lead_commission_qualification(q.id); end loop;
  return new;
end;
$$;
revoke all on function private.process_lead_commission_payment_event() from public, anon, authenticated;
create trigger payments_process_lead_commission
after insert or update of invoice_id, job_id, voided_at on public.payments
for each row execute function private.process_lead_commission_payment_event();

create function public.authorize_lead_personally_close(p_estimate_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare origin public.lead_commission_customer_origins; estimate_row public.estimates;
  policy public.lead_commission_policies; customer_name text; event_id uuid;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Personally-close authorization permission denied.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'An authorization reason is required.'; end if;
  select * into origin from public.lead_commission_customer_origins where estimate_id = p_estimate_id;
  if not found then
    select * into estimate_row from public.estimates where id = p_estimate_id for update;
    if not found or estimate_row.client_id is null or estimate_row.lead_representative_id is null
      or estimate_row.archived_at is not null then
      raise exception 'An active attributed originating Estimate is required.';
    end if;
    select * into policy from public.lead_commission_policies order by effective_at desc limit 1;
    if estimate_row.created_at < policy.effective_at then
      raise exception 'The originating lead predates this commission policy.';
    end if;
    select coalesce(nullif(btrim(client.company_name), ''),
      nullif(btrim(concat_ws(' ', client.first_name, client.last_name)), ''), 'Customer')
    into customer_name from public.clients client where client.id = estimate_row.client_id;
    insert into public.lead_commission_customer_origins(
      policy_key, estimate_id, client_id, lead_representative_id, attributed_at_snapshot,
      customer_name_snapshot, service_name_snapshot, evidence
    ) values (
      policy.policy_key, estimate_row.id, estimate_row.client_id, estimate_row.lead_representative_id,
      estimate_row.created_at, customer_name, coalesce(nullif(btrim(estimate_row.service_name), ''), 'Cleaning'),
      jsonb_build_object('source', 'estimates.lead_representative_id', 'estimateId', estimate_row.id,
        'clientId', estimate_row.client_id, 'leadRepresentativeId', estimate_row.lead_representative_id,
        'establishedFor', 'personally-close authorization')
    ) returning * into origin;
  end if;
  if exists (select 1 from public.lead_commission_ledger entry where entry.customer_origin_id = origin.id and entry.cleaning_ordinal = 1) then
    raise exception 'Initial commission history is already established.';
  end if;
  insert into public.lead_personally_close_events(
    customer_origin_id, event_type, lead_representative_id, actor_user_id, reason, evidence
  ) values (origin.id, 'AUTHORIZED', origin.lead_representative_id, auth.uid(), btrim(p_reason),
    jsonb_build_object('authorizedBeforeBookingQualification', true)) returning id into event_id;
  return event_id;
end;
$$;

create function public.confirm_lead_personally_closed(p_estimate_id uuid, p_proposal_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare origin public.lead_commission_customer_origins; proposal_row public.proposals;
  authorization_record public.lead_personally_close_events; event_id uuid;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Personally-close booking qualification permission denied.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'A booking qualification reason is required.'; end if;
  select * into origin from public.lead_commission_customer_origins where estimate_id = p_estimate_id;
  if not found then raise exception 'The originated customer has not established a commission lifecycle.'; end if;
  if exists (select 1 from public.lead_commission_ledger entry where entry.customer_origin_id = origin.id and entry.cleaning_ordinal = 1) then
    raise exception 'Initial commission history is already established.';
  end if;
  select * into authorization_record from public.lead_personally_close_events event
  where event.customer_origin_id = origin.id and event.event_type in ('AUTHORIZED','AUTHORIZATION_REVOKED')
  order by event.created_at desc, event.id desc limit 1;
  if authorization_record.event_type is distinct from 'AUTHORIZED' then raise exception 'Active management authorization is required.'; end if;
  select * into proposal_row from public.proposals where id = p_proposal_id and estimate_id = origin.estimate_id
    and client_id = origin.client_id and accepted and accepted_at is not null and status = 'Accepted';
  if not found then raise exception 'An accepted booking for this originated customer is required.'; end if;
  insert into public.lead_personally_close_events(
    customer_origin_id, event_type, lead_representative_id, proposal_id,
    actor_user_id, reason, evidence
  ) values (origin.id, 'BOOKING_QUALIFIED', origin.lead_representative_id, proposal_row.id,
    auth.uid(), btrim(p_reason), jsonb_build_object('acceptedAt', proposal_row.accepted_at,
      'managementAttestation', 'Authorized representative personally handled customer through booking'))
  returning id into event_id;
  return event_id;
end;
$$;

revoke all on function public.authorize_lead_personally_close(uuid,text),
  public.confirm_lead_personally_closed(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.authorize_lead_personally_close(uuid,text),
  public.confirm_lead_personally_closed(uuid,uuid,text) to authenticated;

create function public.get_my_lead_representative_commissions()
returns table(
  commission_id uuid, customer_name text, commission_type text, cleaning_ordinal smallint,
  job_number text, service_name text, earned_at timestamptz, amount numeric,
  status text, is_reversal boolean
) language plpgsql stable security definer set search_path = '' as $$
declare representative_id uuid;
begin
  if auth.uid() is null or not public.is_current_lead_representative_eligible() then
    raise exception 'Lead Representative commission access denied.' using errcode = '42501';
  end if;
  representative_id := public.current_employee_id();
  return query select entry.id, entry.customer_name_snapshot, entry.event_type,
    entry.cleaning_ordinal, entry.job_number_snapshot, entry.service_name_snapshot,
    entry.earned_at, entry.commission_amount, entry.payout_status,
    entry.event_type = 'REVERSAL'
  from public.lead_commission_ledger entry
  where entry.lead_representative_id = representative_id
  order by entry.earned_at desc, entry.id desc;
end;
$$;

create function public.get_lead_commission_oversight()
returns table(
  commission_id uuid, lead_representative_id uuid, estimate_id uuid, client_id uuid,
  customer_name text, commission_type text, cleaning_ordinal smallint, job_id uuid,
  job_number text, earned_at timestamptz, amount numeric, status text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Commission oversight permission denied.' using errcode = '42501';
  end if;
  return query select entry.id, entry.lead_representative_id, entry.estimate_id,
    entry.client_id, entry.customer_name_snapshot, entry.event_type,
    entry.cleaning_ordinal, entry.job_id, entry.job_number_snapshot,
    entry.earned_at, entry.commission_amount, entry.payout_status
  from public.lead_commission_ledger entry order by entry.earned_at desc, entry.id desc;
end;
$$;

revoke all on function public.get_my_lead_representative_commissions(),
  public.get_lead_commission_oversight() from public, anon, authenticated;
grant execute on function public.get_my_lead_representative_commissions(),
  public.get_lead_commission_oversight() to authenticated;

notify pgrst, 'reload schema';
commit;
