-- READ-ONLY verification for the one-time R2 pricing presentation correction.
-- Run once after the ledger migration and again after the correction. Before
-- correction, expect the active $285.85 base and no correction audit event;
-- afterward, expect the active $350.00 base, both immutable R2 snapshots, and
-- exactly one correction audit event. This script makes no changes.

begin transaction read only;

select
  proposal.id,
  proposal.proposal_number,
  proposal.status,
  proposal.is_current_revision,
  proposal.archived_at,
  proposal.accepted,
  proposal.accepted_at,
  proposal.sent_at,
  proposal.client_access_token_expires_at,
  proposal.updated_at,
  proposal.result->>'baseEstimateAmount' as authoritative_base,
  proposal.result->'adjustments' as authoritative_adjustments,
  proposal.result->>'perVisitTotal' as authoritative_total,
  proposal.client_delivery_snapshot->>'base_price' as active_snapshot_base,
  proposal.client_delivery_snapshot->'adjustments' as active_snapshot_adjustments,
  proposal.client_delivery_snapshot->>'per_visit_total' as active_snapshot_total,
  (select count(*) from public.service_agreements agreement where agreement.proposal_id = proposal.id) as agreement_count,
  (select count(*) from public.jobs job where job.proposal_id = proposal.id) as job_count
from public.proposals proposal
where proposal.id = '38e0e39c-4310-4864-944f-b4ba4ac4d5ef'::uuid
  and proposal.proposal_number = 'PROP-20261007-4229-R2';

select
  proposal.proposal_number,
  snapshot.revision_number,
  snapshot.capture_reason,
  snapshot.captured_at,
  snapshot.proposal_result->>'baseEstimateAmount' as authoritative_base,
  snapshot.client_snapshot->>'base_price' as delivered_base,
  snapshot.client_snapshot->'adjustments' as delivered_adjustments,
  snapshot.client_snapshot->>'per_visit_total' as delivered_total
from public.proposal_delivery_snapshots snapshot
join public.proposals proposal on proposal.id = snapshot.proposal_id
where proposal.revision_group_id = (
  select revision_group_id
  from public.proposals
  where id = '38e0e39c-4310-4864-944f-b4ba4ac4d5ef'::uuid
)
order by snapshot.revision_number, snapshot.captured_at, snapshot.id;

select
  history.event_type,
  history.previous_status,
  history.new_status,
  history.description,
  history.metadata,
  history.performed_by,
  history.created_at
from public.proposal_history history
where history.proposal_id = '38e0e39c-4310-4864-944f-b4ba4ac4d5ef'::uuid
  and history.event_type = 'Pricing Presentation Corrected'
order by history.created_at;

select
  communication.communication_number,
  communication.status,
  communication.provider_message_id,
  communication.sent_at,
  communication.created_at
from public.client_communications communication
where communication.proposal_id = '38e0e39c-4310-4864-944f-b4ba4ac4d5ef'::uuid
order by communication.created_at;

commit;
