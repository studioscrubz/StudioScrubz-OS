begin;

-- Preserve every customer-facing payload together with the authoritative
-- Proposal result that produced it. Direct table access remains closed; public
-- readers receive a token-scoped projection from the RPC below.
create table public.proposal_delivery_snapshots (
  id bigint generated always as identity primary key,
  proposal_id uuid not null references public.proposals(id) on delete restrict,
  revision_group_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  proposal_result jsonb not null check (jsonb_typeof(proposal_result) = 'object'),
  client_snapshot jsonb not null check (jsonb_typeof(client_snapshot) = 'object'),
  captured_at timestamptz not null default transaction_timestamp(),
  capture_reason text not null default 'Delivery prepared'
);

create index proposal_delivery_snapshots_family_idx
  on public.proposal_delivery_snapshots(revision_group_id, revision_number, captured_at desc);

create unique index proposal_delivery_snapshots_content_uidx
  on public.proposal_delivery_snapshots(
    proposal_id,
    md5(proposal_result::text),
    md5(client_snapshot::text)
  );

alter table public.proposal_delivery_snapshots enable row level security;
revoke all on table public.proposal_delivery_snapshots
from public, anon, authenticated;
-- Snapshot writes are owned by the migration and the privileged capture
-- trigger. The service role does not need a direct insert surface.
grant select on table public.proposal_delivery_snapshots to service_role;

create function private.reject_proposal_delivery_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Proposal delivery snapshots are immutable.' using errcode = '55000';
end;
$$;

revoke all on function private.reject_proposal_delivery_snapshot_mutation()
from public, anon, authenticated;

create trigger reject_proposal_delivery_snapshot_mutation
before update or delete on public.proposal_delivery_snapshots
for each row execute function private.reject_proposal_delivery_snapshot_mutation();

create function private.capture_proposal_delivery_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_delivery_snapshot is null
    or new.client_delivery_snapshot is not distinct from old.client_delivery_snapshot
  then
    return new;
  end if;

  insert into public.proposal_delivery_snapshots(
    proposal_id,
    revision_group_id,
    revision_number,
    proposal_result,
    client_snapshot,
    captured_at,
    capture_reason
  ) values (
    new.id,
    new.revision_group_id,
    new.revision_number,
    new.result,
    new.client_delivery_snapshot,
    transaction_timestamp(),
    'Delivery prepared'
  ) on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.capture_proposal_delivery_snapshot()
from public, anon, authenticated;

create trigger capture_proposal_delivery_snapshot
after update of client_delivery_snapshot on public.proposals
for each row execute function private.capture_proposal_delivery_snapshot();

-- Capture the exact payload and Proposal result that exist before any future
-- correction or resend. This does not change Proposal lifecycle state.
insert into public.proposal_delivery_snapshots(
  proposal_id,
  revision_group_id,
  revision_number,
  proposal_result,
  client_snapshot,
  captured_at,
  capture_reason
)
select proposal.id,
  proposal.revision_group_id,
  proposal.revision_number,
  proposal.result,
  proposal.client_delivery_snapshot,
  coalesce(proposal.sent_at, proposal.updated_at, proposal.created_at),
  'Existing delivered snapshot preserved'
from public.proposals proposal
where proposal.client_delivery_snapshot is not null
on conflict do nothing;

create function public.get_proposal_revision_history_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  anchor public.proposals;
  revisions jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This proposal link is invalid, expired, or no longer available.';
  end if;

  select * into anchor
  from public.proposals proposal
  where proposal.client_access_token = p_token
    and proposal.archived_at is null
    and proposal.is_current_revision
    and proposal.status in ('Sent', 'Viewed', 'Accepted', 'Declined')
    and proposal.client_delivery_snapshot is not null
    and (proposal.status in ('Accepted', 'Declined') or proposal.expiration_date >= current_date)
    and (proposal.client_access_token_expires_at is null or proposal.client_access_token_expires_at > now())
  limit 1;

  if not found then
    raise exception 'This proposal link is invalid, expired, or no longer available.';
  end if;

  select jsonb_agg(
    delivery.client_snapshot || jsonb_build_object(
      'proposal_number', proposal.proposal_number,
      'revision_number', proposal.revision_number,
      'is_current_revision', proposal.id = anchor.id,
      'superseded', proposal.id <> anchor.id,
      'status', case when proposal.id = anchor.id then proposal.status else 'Archived' end,
      'service_name', delivery.proposal_result->>'serviceName',
      'service_description', delivery.proposal_result->'serviceDescription',
      'frequency', proposal.frequency,
      'scope', coalesce(delivery.proposal_result->'scope', '[]'::jsonb),
      'adjustments', coalesce(delivery.proposal_result->'adjustments', '[]'::jsonb),
      'base_price', delivery.proposal_result->'baseEstimateAmount',
      'recurring_discount_percent', coalesce(delivery.proposal_result->'frequencyDiscountPercent', '0'::jsonb),
      'recurring_discount_amount', coalesce(delivery.proposal_result->'frequencyDiscount', '0'::jsonb),
      'manual_discount', to_jsonb(
        coalesce((delivery.proposal_result->>'inheritedManualDiscount')::numeric, 0)
        + coalesce((delivery.proposal_result->>'manualDiscount')::numeric, 0)
      ),
      'discount', coalesce(delivery.proposal_result->'manualDiscount', '0'::jsonb),
      'taxes', coalesce(delivery.proposal_result->'taxes', '0'::jsonb),
      'per_visit_total', delivery.proposal_result->'perVisitTotal',
      'monthly_total', delivery.proposal_result->'monthlyTotal',
      'accepted_at', proposal.accepted_at,
      'accepted_by_name', proposal.accepted_by_name,
      'client_acceptance_consent', proposal.client_acceptance_consent,
      'declined_at', proposal.declined_at,
      'delivered_snapshot_captured_at', delivery.captured_at
    ) order by proposal.revision_number
  ) into revisions
  from public.proposals proposal
  join lateral (
    select snapshot.proposal_result,
      snapshot.client_snapshot,
      snapshot.captured_at
    from public.proposal_delivery_snapshots snapshot
    where snapshot.proposal_id = proposal.id
    order by snapshot.captured_at desc, snapshot.id desc
    limit 1
  ) delivery on true
  where proposal.revision_group_id = anchor.revision_group_id
    and proposal.revision_number <= anchor.revision_number
    and proposal.sent_at is not null;

  return jsonb_build_object(
    'current_revision_number', anchor.revision_number,
    'revisions', coalesce(revisions, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_proposal_revision_history_by_token(text)
from public, anon, authenticated;
grant execute on function public.get_proposal_revision_history_by_token(text)
to anon, authenticated;

notify pgrst, 'reload schema';

commit;
