-- Preserve deterministic acceptance-time pricing allocations for signed legacy
-- Agreements without changing the Agreement or its client-signed snapshot.
begin;

create table public.legacy_signed_agreement_pricing_allocations (
  id uuid primary key default gen_random_uuid(),
  service_agreement_id uuid not null unique
    references public.service_agreements(id) on delete restrict,
  schema_version smallint not null default 1
    constraint legacy_signed_agreement_pricing_allocations_schema_version_check
    check (schema_version = 1),
  allocation jsonb not null,
  signed_total numeric(12,2) not null
    constraint legacy_signed_agreement_pricing_allocations_signed_total_check
    check (signed_total >= 0),
  evidence_version smallint not null default 1
    constraint legacy_signed_agreement_pricing_allocations_evidence_version_check
    check (evidence_version = 1),
  evidence jsonb not null
    constraint legacy_signed_agreement_pricing_allocations_evidence_check
    check (jsonb_typeof(evidence) = 'object'),
  reason text not null
    constraint legacy_signed_agreement_pricing_allocations_reason_check
    check (nullif(btrim(reason), '') is not null),
  created_at timestamptz not null default now(),
  created_by_type text not null
    constraint legacy_signed_agreement_pricing_allocations_created_by_type_check
    check (created_by_type in ('migration','system')),
  created_by_identifier text not null
    constraint legacy_signed_agreement_pricing_allocations_created_by_identifier_check
    check (nullif(btrim(created_by_identifier), '') is not null),
  constraint legacy_signed_agreement_pricing_allocations_allocation_check
    check (public.is_valid_job_pricing_snapshot(allocation, signed_total))
);

alter table public.legacy_signed_agreement_pricing_allocations enable row level security;
revoke all on table public.legacy_signed_agreement_pricing_allocations
from public, anon, authenticated;
grant select on table public.legacy_signed_agreement_pricing_allocations to service_role;

create or replace function private.validate_legacy_signed_agreement_pricing_allocation_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  agreement_row public.service_agreements;
  native_allocation jsonb;
begin
  select * into agreement_row
  from public.service_agreements
  where id = new.service_agreement_id
  for update;

  if not found then
    raise exception 'The Service Agreement for this legacy pricing allocation does not exist.';
  end if;
  if agreement_row.client_signed_at is null
    or agreement_row.accepted_at is null
    or agreement_row.status not in ('Accepted','Active','Paused','Completed')
    or jsonb_typeof(agreement_row.client_signed_snapshot) is distinct from 'object'
  then
    raise exception 'A legacy pricing allocation requires an accepted, client-signed Service Agreement with a signed snapshot.';
  end if;
  if agreement_row.billing_type is distinct from 'Per Visit' then
    raise exception 'A legacy pricing allocation requires Per Visit billing.';
  end if;
  if round(agreement_row.billing_amount, 2) is distinct from round(new.signed_total, 2)
    or jsonb_typeof(agreement_row.client_signed_snapshot->'billing_amount') is distinct from 'number'
    or round((agreement_row.client_signed_snapshot->>'billing_amount')::numeric, 2)
      is distinct from round(new.signed_total, 2)
    or jsonb_typeof(agreement_row.pricing_snapshot) is distinct from 'object'
    or jsonb_typeof(agreement_row.pricing_snapshot->'final_per_visit_price') is distinct from 'number'
    or round((agreement_row.pricing_snapshot->>'final_per_visit_price')::numeric, 2)
      is distinct from round(new.signed_total, 2)
    or jsonb_typeof(agreement_row.client_signed_snapshot->'pricing_snapshot') is distinct from 'object'
    or jsonb_typeof(agreement_row.client_signed_snapshot->'pricing_snapshot'->'final_per_visit_price') is distinct from 'number'
    or round((agreement_row.client_signed_snapshot->'pricing_snapshot'->>'final_per_visit_price')::numeric, 2)
      is distinct from round(new.signed_total, 2)
  then
    raise exception 'The Agreement acceptance-time totals do not reconcile with the legacy pricing allocation signed total.';
  end if;

  native_allocation := agreement_row.pricing_snapshot->'accepted_pricing_allocation';
  if native_allocation is not null and jsonb_typeof(native_allocation) <> 'null' then
    raise exception 'A native accepted pricing allocation already exists; a legacy supplement is not permitted.';
  end if;
  if not public.is_valid_job_pricing_snapshot(new.allocation, new.signed_total) then
    raise exception 'The legacy pricing allocation is malformed or does not reconcile with its signed total.';
  end if;
  if exists (
    select 1 from public.legacy_signed_agreement_pricing_allocations existing
    where existing.service_agreement_id = new.service_agreement_id
  ) then
    raise exception 'A legacy pricing allocation already exists for this Service Agreement.';
  end if;
  return new;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'The Agreement acceptance-time totals are malformed.';
end;
$$;

revoke all on function private.validate_legacy_signed_agreement_pricing_allocation_insert()
from public, anon, authenticated;

create trigger legacy_signed_agreement_pricing_allocations_validate_insert
before insert on public.legacy_signed_agreement_pricing_allocations
for each row execute function private.validate_legacy_signed_agreement_pricing_allocation_insert();

create or replace function private.reject_legacy_signed_agreement_pricing_allocation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'Legacy signed Agreement pricing allocations are immutable.';
end;
$$;

revoke all on function private.reject_legacy_signed_agreement_pricing_allocation_mutation()
from public, anon, authenticated;

create trigger legacy_signed_agreement_pricing_allocations_reject_mutation
before update or delete on public.legacy_signed_agreement_pricing_allocations
for each row execute function private.reject_legacy_signed_agreement_pricing_allocation_mutation();

do $$
declare
  target_agreement constant uuid := '42a2f12c-0637-4ac6-bdd8-b3d2343779ee';
  target_proposal constant uuid := '462c4943-d166-41b3-8db4-21c367e412b3';
  target_addon constant text := '40703776-eda0-4068-a936-06b85f2b6e7d';
  expected_allocation constant jsonb := jsonb_build_object(
    'version', 1,
    'baseServiceAmount', 232.00,
    'addons', jsonb_build_array(jsonb_build_object(
      'id', target_addon,
      'label', 'Change Bed Linens',
      'pricingType', 'Flat Price',
      'quantity', 1,
      'unitName', null,
      'unitPrice', 18.00,
      'lineTotal', 18.00
    )),
    'totalAmount', 250.00
  );
  agreement_row public.service_agreements;
  proposal_row public.proposals;
  supplement_id uuid;
begin
  select * into agreement_row
  from public.service_agreements
  where id = target_agreement
  for update;

  if not found then
    raise exception 'Legacy Agreement % is unavailable; no supplemental pricing allocation was created.', target_agreement;
  end if;
  if agreement_row.agreement_number is distinct from 'AGR-20260831-4970'
    or agreement_row.proposal_id is distinct from target_proposal
    or agreement_row.billing_type is distinct from 'Per Visit'
    or round(agreement_row.billing_amount, 2) is distinct from 250.00
    or agreement_row.client_signed_at is null
    or agreement_row.accepted_at is null
    or agreement_row.status not in ('Accepted','Active','Paused','Completed')
  then
    raise exception 'Legacy Agreement identity, signature, acceptance, or billing evidence changed; no supplement was created.';
  end if;
  if agreement_row.pricing_snapshot->'accepted_pricing_allocation' is not null
    and jsonb_typeof(agreement_row.pricing_snapshot->'accepted_pricing_allocation') <> 'null'
  then
    raise exception 'The legacy Agreement already has a native accepted pricing allocation; no supplement was created.';
  end if;

  select * into proposal_row
  from public.proposals
  where id = target_proposal;

  if not found
    or proposal_row.status is distinct from 'Accepted'
    or proposal_row.accepted is distinct from true
    or proposal_row.accepted_at is null
    or jsonb_typeof(proposal_row.result->'perVisitTotal') is distinct from 'number'
    or round((proposal_row.result->>'perVisitTotal')::numeric, 2) is distinct from 250.00
  then
    raise exception 'Accepted Proposal evidence no longer establishes the expected 250.00 total; no supplement was created.';
  end if;

  if jsonb_typeof(agreement_row.pricing_snapshot) is distinct from 'object'
    or jsonb_typeof(agreement_row.pricing_snapshot->'final_per_visit_price') is distinct from 'number'
    or round((agreement_row.pricing_snapshot->>'final_per_visit_price')::numeric, 2) is distinct from 250.00
    or jsonb_typeof(agreement_row.client_signed_snapshot) is distinct from 'object'
    or jsonb_typeof(agreement_row.client_signed_snapshot->'billing_amount') is distinct from 'number'
    or round((agreement_row.client_signed_snapshot->>'billing_amount')::numeric, 2) is distinct from 250.00
    or jsonb_typeof(agreement_row.client_signed_snapshot->'pricing_snapshot') is distinct from 'object'
    or jsonb_typeof(agreement_row.client_signed_snapshot->'pricing_snapshot'->'final_per_visit_price') is distinct from 'number'
    or round((agreement_row.client_signed_snapshot->'pricing_snapshot'->>'final_per_visit_price')::numeric, 2) is distinct from 250.00
  then
    raise exception 'Agreement acceptance snapshots no longer establish the expected 250.00 total; no supplement was created.';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(coalesce(proposal_row.result->'adjustments', '[]'::jsonb)) addon
    where addon->>'catalogAddonId' = target_addon
      and addon->>'label' = 'Change Bed Linens'
      and jsonb_typeof(addon->'amount') = 'number'
      and round((addon->>'amount')::numeric, 2) = 18.00
  ) <> 1 or (
    select count(*)
    from jsonb_array_elements(coalesce(agreement_row.pricing_snapshot->'catalog_addons', '[]'::jsonb)) addon
    where addon->>'catalogAddonId' = target_addon
      and addon->>'label' = 'Change Bed Linens'
      and jsonb_typeof(addon->'amount') = 'number'
      and round((addon->>'amount')::numeric, 2) = 18.00
  ) <> 1 or (
    select count(*)
    from jsonb_array_elements(coalesce(agreement_row.client_signed_snapshot->'pricing_snapshot'->'catalog_addons', '[]'::jsonb)) addon
    where addon->>'catalogAddonId' = target_addon
      and addon->>'label' = 'Change Bed Linens'
      and jsonb_typeof(addon->'amount') = 'number'
      and round((addon->>'amount')::numeric, 2) = 18.00
  ) <> 1 then
    raise exception 'Acceptance-time evidence no longer establishes Change Bed Linens at 18.00; no supplement was created.';
  end if;

  if not public.is_valid_job_pricing_snapshot(expected_allocation, 250.00)
    or 232.00 + 18.00 <> 250.00
  then
    raise exception 'The approved supplemental allocation does not reconcile; no supplement was created.';
  end if;
  if exists (
    select 1 from public.legacy_signed_agreement_pricing_allocations
    where service_agreement_id = target_agreement
  ) then
    raise exception 'A supplemental pricing allocation already exists for AGR-20260831-4970; no change was made.';
  end if;

  insert into public.legacy_signed_agreement_pricing_allocations (
    service_agreement_id, allocation, signed_total, evidence, reason,
    created_by_type, created_by_identifier
  ) values (
    target_agreement,
    expected_allocation,
    250.00,
    jsonb_build_object(
      'agreement', jsonb_build_object(
        'id', target_agreement,
        'agreementNumber', 'AGR-20260831-4970',
        'billingTypePath', 'service_agreements.billing_type',
        'billingTypeValue', 'Per Visit',
        'billingAmountPath', 'service_agreements.billing_amount',
        'billingAmountValue', 250.00,
        'pricingTotalPath', 'service_agreements.pricing_snapshot.final_per_visit_price',
        'pricingTotalValue', 250.00,
        'signedBillingAmountPath', 'service_agreements.client_signed_snapshot.billing_amount',
        'signedBillingAmountValue', 250.00,
        'signedPricingTotalPath', 'service_agreements.client_signed_snapshot.pricing_snapshot.final_per_visit_price',
        'signedPricingTotalValue', 250.00,
        'clientSignedAt', agreement_row.client_signed_at,
        'acceptedAt', agreement_row.accepted_at
      ),
      'proposal', jsonb_build_object(
        'id', target_proposal,
        'statusPath', 'proposals.status',
        'statusValue', 'Accepted',
        'acceptedPath', 'proposals.accepted',
        'acceptedValue', true,
        'acceptedAt', proposal_row.accepted_at,
        'totalPath', 'proposals.result.perVisitTotal',
        'totalValue', 250.00
      ),
      'addon', jsonb_build_object(
        'id', target_addon,
        'label', 'Change Bed Linens',
        'amount', 18.00,
        'persistedPaths', jsonb_build_array(
          'proposals.result.adjustments',
          'service_agreements.pricing_snapshot.catalog_addons',
          'service_agreements.client_signed_snapshot.pricing_snapshot.catalog_addons'
        )
      ),
      'reconciliation', jsonb_build_object(
        'baseServiceAmount', 232.00,
        'addonTotal', 18.00,
        'signedTotal', 250.00,
        'formula', '232.00 + 18.00 = 250.00'
      ),
      'currentPricingTablesConsulted', false,
      'purpose', 'Normalize persisted acceptance-time evidence for operational handoff; this supplement does not amend the signed Service Agreement.'
    ),
    'Normalize deterministic acceptance-time pricing evidence for future operational handoff without amending the signed Service Agreement.',
    'migration',
    'migration:20261002133151_legacy_signed_agreement_pricing_allocations'
  ) returning id into supplement_id;

  if supplement_id is null then
    raise exception 'The legacy supplemental pricing allocation was not created.';
  end if;
end;
$$;

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
  supplement_row public.legacy_signed_agreement_pricing_allocations;
  job_row public.jobs;
  team jsonb := '[]'::jsonb;
  job_amount numeric;
  native_pricing_allocation jsonb;
  job_pricing_snapshot jsonb;
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

  if occurrence_row.status = 'Job Created' then
    if exists (
      select 1 from public.jobs retained_job
      where retained_job.id = occurrence_row.job_id
         or retained_job.service_occurrence_id = occurrence_row.id
    ) then
      raise exception 'This service occurrence has retained Job history and cannot create another Job.';
    end if;
    update public.service_occurrences
    set status = 'Scheduled'
    where id = occurrence_row.id and job_id is null and status = 'Job Created';
  elsif occurrence_row.status <> 'Scheduled' then
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
  job_pricing_snapshot := null;
  if agreement_row.billing_type = 'Per Visit' then
    native_pricing_allocation := agreement_row.pricing_snapshot->'accepted_pricing_allocation';
    if native_pricing_allocation is not null and jsonb_typeof(native_pricing_allocation) <> 'null' then
      if not public.is_valid_job_pricing_snapshot(native_pricing_allocation, agreement_row.billing_amount) then
        raise exception 'The Agreement native accepted pricing allocation is invalid or does not match its Per Visit billing amount.';
      end if;
      job_pricing_snapshot := native_pricing_allocation;
    else
      select * into supplement_row
      from public.legacy_signed_agreement_pricing_allocations
      where service_agreement_id = agreement_row.id;
      if found then
        if not public.is_valid_job_pricing_snapshot(supplement_row.allocation, agreement_row.billing_amount)
          or round(supplement_row.signed_total, 2) is distinct from round(agreement_row.billing_amount, 2)
        then
          raise exception 'The legacy supplemental pricing allocation is invalid or does not match the Agreement Per Visit billing amount.';
        end if;
        job_pricing_snapshot := supplement_row.allocation || jsonb_build_object(
          'provenance', jsonb_build_object(
            'source', 'legacy_signed_agreement_supplement',
            'supplementId', supplement_row.id,
            'serviceAgreementId', agreement_row.id,
            'capturedAt', supplement_row.created_at
          )
        );
      end if;
    end if;
  end if;
  job_date := (now() at time zone coalesce((select timezone from public.business_settings limit 1), 'UTC'))::date;

  for attempt in 1..5 loop
    begin
      insert into public.jobs (
        job_number, proposal_id, estimate_id, walkthrough_id, service_occurrence_id,
        client_id, property_id, division, client_name, property_name, service_name,
        frequency, status, scheduled_date, start_time, estimated_duration,
        assigned_crew_id, assigned_crew_name, crew_lead_name, assigned_team,
        price, pricing_snapshot, deposit, balance, labor_hours, recommended_crew_size, scope,
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
        team, job_amount, job_pricing_snapshot, 0, job_amount, 0, greatest(jsonb_array_length(team), 1), agreement_row.scope,
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

revoke all on function public.create_job_from_service_occurrence(uuid)
from public, anon, authenticated;
grant execute on function public.create_job_from_service_occurrence(uuid)
to authenticated;

notify pgrst, 'reload schema';
commit;
