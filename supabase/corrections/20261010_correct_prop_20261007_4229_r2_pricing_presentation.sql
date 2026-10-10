-- ONE-TIME MANUAL CORRECTION. Do not add this file to migration history.
-- Prerequisite: apply 20261010000000_proposal_public_revision_history.sql and
-- verify its preservation rows before running this transaction.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $correction$
declare
  target_proposal_id constant uuid := '38e0e39c-4310-4864-944f-b4ba4ac4d5ef'::uuid;
  target_proposal_number constant text := 'PROP-20261007-4229-R2';
  target_revision_number constant integer := 2;
  expected_bad_base constant numeric := 285.85;
  corrected_base constant numeric := 350.00;
  expected_total constant numeric := 400.00;
  expected_add_on_id constant text := '76a183c7-f02f-4f70-8f7e-a74b0881bc6c';
  expected_add_on_label constant text := 'Interior Refrigerator';
  expected_add_on_amount constant numeric := 50.00;
  proposal_before public.proposals;
  proposal_after public.proposals;
  expected_snapshot jsonb;
  history_count_before bigint;
begin
  -- Serialize this correction with every lifecycle mutation of the target.
  select * into strict proposal_before
  from public.proposals proposal
  where proposal.id = target_proposal_id
    and proposal.proposal_number = target_proposal_number
  for update;

  if proposal_before.revision_number is distinct from target_revision_number
    or proposal_before.status is distinct from 'Sent'
    or proposal_before.is_current_revision is not true
    or proposal_before.archived_at is not null
    or proposal_before.accepted is not false
    or proposal_before.accepted_at is not null
  then
    raise exception 'R2 lifecycle guard failed; no correction was applied.';
  end if;

  if exists (
      select 1 from public.service_agreements agreement
      where agreement.proposal_id = target_proposal_id
    ) or exists (
      select 1 from public.jobs job
      where job.proposal_id = target_proposal_id
    )
  then
    raise exception 'R2 has an Agreement or Job; no correction was applied.';
  end if;

  if (proposal_before.result->>'baseEstimateAmount')::numeric is distinct from corrected_base
    or (proposal_before.result->>'perVisitTotal')::numeric is distinct from expected_total
    or proposal_before.result->'adjustments' is distinct from jsonb_build_array(
      jsonb_build_object(
        'id', expected_add_on_id,
        'label', expected_add_on_label,
        'amount', expected_add_on_amount
      )
    )
  then
    raise exception 'R2 authoritative pricing guard failed; no correction was applied.';
  end if;

  if (proposal_before.client_delivery_snapshot->>'base_price')::numeric is distinct from expected_bad_base
    or (proposal_before.client_delivery_snapshot->>'per_visit_total')::numeric is distinct from expected_total
    or proposal_before.client_delivery_snapshot->'adjustments' is distinct from jsonb_build_array(
      jsonb_build_object(
        'id', expected_add_on_id,
        'label', expected_add_on_label,
        'amount', expected_add_on_amount
      )
    )
  then
    raise exception 'R2 active delivery snapshot guard failed; correction may already be applied.';
  end if;

  -- Both originally delivered payloads must already be preserved verbatim.
  if not exists (
    select 1
    from public.proposals r1
    join public.proposal_delivery_snapshots snapshot on snapshot.proposal_id = r1.id
    where r1.revision_group_id = proposal_before.revision_group_id
      and r1.revision_number = 1
      and r1.proposal_number = 'PROP-20261007-4229'
      and snapshot.capture_reason = 'Existing delivered snapshot preserved'
      and (snapshot.proposal_result->>'baseEstimateAmount')::numeric = 350.00
      and (snapshot.proposal_result->>'perVisitTotal')::numeric = 350.00
      and (snapshot.client_snapshot->>'base_price')::numeric = 285.85
      and (snapshot.client_snapshot->>'per_visit_total')::numeric = 350.00
  ) then
    raise exception 'The original R1 delivery snapshot is not preserved; no correction was applied.';
  end if;

  if not exists (
    select 1
    from public.proposal_delivery_snapshots snapshot
    where snapshot.proposal_id = target_proposal_id
      and snapshot.revision_group_id = proposal_before.revision_group_id
      and snapshot.revision_number = target_revision_number
      and snapshot.capture_reason = 'Existing delivered snapshot preserved'
      and snapshot.proposal_result = proposal_before.result
      and snapshot.client_snapshot = proposal_before.client_delivery_snapshot
  ) then
    raise exception 'The original R2 delivery snapshot is not preserved; no correction was applied.';
  end if;

  select count(*) into history_count_before
  from public.proposal_history history
  where history.proposal_id = target_proposal_id
    and history.event_type = 'Pricing Presentation Corrected';

  if history_count_before <> 0 then
    raise exception 'The R2 pricing presentation correction audit event already exists.';
  end if;

  expected_snapshot := jsonb_set(
    proposal_before.client_delivery_snapshot,
    '{base_price}',
    to_jsonb(corrected_base),
    false
  );

  -- This is the established, transaction-local authorization switch used by
  -- the delivery snapshot protection trigger. The history capture trigger will
  -- append the corrected payload automatically.
  perform set_config('studioscrubz.controlled_delivery_snapshot', 'on', true);

  update public.proposals proposal
  set client_delivery_snapshot = expected_snapshot
  where proposal.id = target_proposal_id
    and proposal.proposal_number = target_proposal_number
    and proposal.status = 'Sent'
    and proposal.is_current_revision
    and proposal.archived_at is null
    and proposal.accepted is false
    and proposal.accepted_at is null
  returning proposal.* into strict proposal_after;

  -- The normal proposals updated_at trigger is expected to change updated_at.
  -- Every other column except the intended snapshot field must remain equal.
  if (to_jsonb(proposal_after) - array['client_delivery_snapshot', 'updated_at']::text[])
      is distinct from
     (to_jsonb(proposal_before) - array['client_delivery_snapshot', 'updated_at']::text[])
    or proposal_after.client_delivery_snapshot is distinct from expected_snapshot
    or proposal_after.updated_at is not distinct from proposal_before.updated_at
  then
    raise exception 'R2 post-update proposal invariant failed; transaction will roll back.';
  end if;

  if not exists (
    select 1
    from public.proposal_delivery_snapshots snapshot
    where snapshot.proposal_id = target_proposal_id
      and snapshot.proposal_result = proposal_before.result
      and snapshot.client_snapshot = expected_snapshot
  ) then
    raise exception 'The corrected immutable R2 snapshot was not captured.';
  end if;

  insert into public.proposal_history(
    proposal_id,
    event_type,
    previous_status,
    new_status,
    description,
    metadata,
    performed_by
  ) values (
    target_proposal_id,
    'Pricing Presentation Corrected',
    proposal_before.status,
    proposal_after.status,
    'Corrected the customer-facing base-price presentation from $285.85 to the authoritative $350.00; the $50.00 Interior Refrigerator add-on and $400.00 total were preserved.',
    jsonb_build_object(
      'proposal_number', target_proposal_number,
      'revision_number', target_revision_number,
      'previous_base_price', expected_bad_base,
      'corrected_base_price', corrected_base,
      'preserved_add_on', jsonb_build_object(
        'id', expected_add_on_id,
        'label', expected_add_on_label,
        'amount', expected_add_on_amount
      ),
      'preserved_total', expected_total,
      'original_delivery_snapshot_preserved', true
    ),
    'Master Admin (one-time pricing correction)'
  );

  if (select count(*) from public.proposal_history history
      where history.proposal_id = target_proposal_id
        and history.event_type = 'Pricing Presentation Corrected') <> 1
  then
    raise exception 'The correction audit event was not recorded exactly once.';
  end if;
end;
$correction$;

commit;
