begin;

alter table public.estimates
  drop constraint if exists estimates_status_check;

alter table public.estimates
  add constraint estimates_status_check
  check (status in ('Open', 'Converted', 'Superseded', 'Declined', 'Archived'));

alter table public.estimates
  add column if not exists superseded_by_estimate_id uuid,
  add column if not exists superseded_reason text;

alter table public.estimates
  add constraint estimates_superseded_by_estimate_id_fkey
  foreign key (superseded_by_estimate_id)
  references public.estimates(id)
  on delete restrict;

create index if not exists estimates_superseded_by_estimate_id_idx
  on public.estimates(superseded_by_estimate_id)
  where superseded_by_estimate_id is not null;

alter table public.estimates
  add constraint estimates_superseded_relationship_check
  check (
    (status = 'Superseded'
      and archived_at is not null
      and superseded_by_estimate_id is not null
      and nullif(btrim(superseded_reason), '') is not null)
    or
    (status <> 'Superseded'
      and superseded_by_estimate_id is null
      and superseded_reason is null)
  );

create or replace function public.mark_proposal_sent_for_delivery(
  p_proposal_id uuid,
  p_via text,
  p_recipient text,
  p_sender text,
  p_token text,
  p_token_expires_at timestamptz,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.proposals;
  previous_status text;
  sent_time timestamptz := now();
  direct_estimate_id uuid;
  walkthrough_estimate_id uuid;
  source_estimate_id uuid;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then
    raise exception 'You do not have permission to send Proposals.' using errcode = '42501';
  end if;
  if p_via not in ('Email','Text') or length(btrim(coalesce(p_recipient,''))) < 3 then
    raise exception 'A valid Proposal delivery recipient is required.';
  end if;

  select * into row
  from public.proposals
  where id = p_proposal_id
  for update;

  if not found
    or row.archived_at is not null
    or row.status not in ('Approved','Sent','Viewed')
    or row.approval_status <> 'Approved'
    or row.accepted
    or row.expiration_date < current_date
  then
    raise exception 'This Proposal is unavailable for delivery.';
  end if;
  if (row.status in ('Sent','Viewed') and not row.is_current_revision)
    or (
      row.status = 'Approved'
      and (
        row.sent_at is not null
        or exists (
          select 1
          from public.proposals newer
          where newer.revision_group_id = row.revision_group_id
            and newer.revision_number > row.revision_number
            and newer.archived_at is null
        )
      )
    )
  then
    raise exception 'Only the current offer or newest approved revision can be delivered.';
  end if;
  if row.client_access_token is distinct from p_token
    or row.client_access_token_expires_at is distinct from p_token_expires_at
    or row.client_delivery_snapshot is null
    or p_snapshot is null
  then
    raise exception 'Proposal delivery was not prepared with this secure snapshot.';
  end if;

  direct_estimate_id := row.estimate_id;
  if row.walkthrough_id is not null then
    select walkthrough.estimate_id into walkthrough_estimate_id
    from public.walkthroughs walkthrough
    where walkthrough.id = row.walkthrough_id;
  end if;

  if direct_estimate_id is not null
    and walkthrough_estimate_id is not null
    and direct_estimate_id is distinct from walkthrough_estimate_id
  then
    raise exception 'Proposal source Estimate references do not agree.' using errcode = '23514';
  end if;
  source_estimate_id := coalesce(direct_estimate_id, walkthrough_estimate_id);

  perform 1
  from public.proposals proposal
  where proposal.revision_group_id = row.revision_group_id
  for update;

  if row.revision_number > 1
    and exists (
      select 1
      from public.proposals proposal
      where proposal.revision_group_id = row.revision_group_id
        and proposal.is_current_revision
        and proposal.id <> row.id
        and proposal.status = 'Accepted'
    )
  then
    raise exception 'The prior Proposal was accepted before this revision could be activated.';
  end if;

  if source_estimate_id is not null then
    perform 1
    from public.estimates estimate
    where estimate.id = source_estimate_id
    for update;
  end if;

  previous_status := row.status;
  if not row.is_current_revision then
    update public.proposals
    set is_current_revision = false,
        superseded_at = sent_time
    where revision_group_id = row.revision_group_id
      and is_current_revision = true
      and id <> row.id;

    update public.proposals
    set is_current_revision = true,
        superseded_at = null
    where id = row.id;
  end if;

  update public.proposals
  set status = 'Sent',
      sent_at = coalesce(sent_at, sent_time),
      sent_via = p_via,
      sent_to = btrim(p_recipient),
      sent_by = nullif(btrim(coalesce(p_sender,'')),'')
  where id = row.id
  returning * into row;

  if source_estimate_id is not null then
    update public.estimates
    set status = 'Converted',
        updated_at = sent_time
    where id = source_estimate_id
      and status = 'Open'
      and archived_at is null;
  end if;

  if previous_status = 'Approved' then
    insert into public.proposal_history(
      proposal_id,
      event_type,
      previous_status,
      new_status,
      description,
      metadata,
      performed_by
    ) values (
      row.id,
      'Sent by ' || p_via,
      previous_status,
      'Sent',
      null,
      jsonb_build_object('revision_number', row.revision_number),
      coalesce(nullif(btrim(p_sender),''),'StudioScrubz User')
    );
  end if;

  return jsonb_build_object('sent_at', row.sent_at, 'revision_number', row.revision_number);
end;
$$;

revoke all on function public.mark_proposal_sent_for_delivery(uuid,text,text,text,text,timestamptz,jsonb)
from public, anon, authenticated;
grant execute on function public.mark_proposal_sent_for_delivery(uuid,text,text,text,text,timestamptz,jsonb)
to authenticated;

-- Fail closed if any successfully sent proposal contains contradictory source
-- references. Such a record must be repaired deliberately rather than allowing
-- the backfill to choose one Estimate silently.
do $$
begin
  if exists (
    select 1
    from public.proposals proposal
    join public.walkthroughs walkthrough on walkthrough.id = proposal.walkthrough_id
    where proposal.sent_at is not null
      and proposal.estimate_id is not null
      and walkthrough.estimate_id is not null
      and proposal.estimate_id is distinct from walkthrough.estimate_id
  ) then
    raise exception 'Estimate lifecycle backfill found conflicting Proposal source references.' using errcode = '23514';
  end if;
end;
$$;

with sent_proposal_sources as (
  select distinct coalesce(proposal.estimate_id, walkthrough.estimate_id) as estimate_id
  from public.proposals proposal
  left join public.walkthroughs walkthrough on walkthrough.id = proposal.walkthrough_id
  where proposal.sent_at is not null
    and coalesce(proposal.estimate_id, walkthrough.estimate_id) is not null
)
update public.estimates estimate
set status = 'Converted',
    updated_at = now()
from sent_proposal_sources source
where estimate.id = source.estimate_id
  and estimate.status = 'Open'
  and estimate.archived_at is null
  and estimate.id <> 'cfbf7106-33ee-48e6-a548-6f8f1985d3ec'::uuid;

-- Explicitly preserve and retire the confirmed superseded Estimate. This is
-- intentionally UUID-targeted; no client/property similarity is used.
do $$
declare
  original public.estimates;
  replacement public.estimates;
  replacement_id constant uuid := 'f2cebd49-dfcf-4f91-9d20-cfcd58ff10a6'::uuid;
  reason constant text := 'Replaced with a new estimate to correctly attach project photographs.';
begin
  select * into original
  from public.estimates
  where id = 'cfbf7106-33ee-48e6-a548-6f8f1985d3ec'::uuid
  for update;

  if not found or original.estimate_number <> 'EST-20261005-4400' then
    raise exception 'The confirmed superseded Estimate was not found with its expected identity.';
  end if;

  select * into replacement
  from public.estimates
  where id = replacement_id
  for key share;

  if not found or replacement.estimate_number <> 'EST-20261007-2315' then
    raise exception 'The confirmed replacement Estimate was not found with its expected identity.';
  end if;

  if original.status = 'Superseded'
    and original.archived_at is not null
    and original.superseded_by_estimate_id = replacement_id
    and original.superseded_reason = reason
  then
    return;
  end if;

  if original.status <> 'Open'
    or original.archived_at is not null
    or original.superseded_by_estimate_id is not null
    or original.superseded_reason is not null
  then
    raise exception 'The confirmed superseded Estimate is not in the expected Open lifecycle state.';
  end if;

  update public.estimates
  set status = 'Superseded',
      archived_at = now(),
      superseded_by_estimate_id = replacement_id,
      superseded_reason = reason,
      updated_at = now()
  where id = original.id;
end;
$$;

notify pgrst, 'reload schema';

commit;
