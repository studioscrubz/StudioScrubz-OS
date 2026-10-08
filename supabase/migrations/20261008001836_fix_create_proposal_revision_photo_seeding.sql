create or replace function public.create_proposal_revision(p_proposal_id uuid)
returns public.proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.proposals;
  created public.proposals;
  next_revision integer;
  actor text;
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin','Administrator','Sales'])
  then
    raise exception 'You do not have permission to create Proposal revisions.'
      using errcode = '42501';
  end if;

  select * into source
  from public.proposals
  where id = p_proposal_id
  for update;

  if not found
    or source.archived_at is not null
    or source.status not in ('Sent','Viewed')
    or source.accepted
    or not source.is_current_revision
  then
    raise exception 'Only the current unaccepted Sent or Viewed Proposal can be revised.';
  end if;

  perform 1
  from public.proposals
  where revision_group_id = source.revision_group_id
  for update;

  if exists(
    select 1
    from public.proposals
    where revision_group_id = source.revision_group_id
      and revision_number > 1
      and archived_at is null
      and status in ('Draft','Ready for Approval','Approved')
  ) then
    raise exception 'This Proposal already has an open draft revision.';
  end if;

  select coalesce(max(revision_number), 0) + 1
  into next_revision
  from public.proposals
  where revision_group_id = source.revision_group_id;

  select coalesce(nullif(display_name,''), email, role, 'StudioScrubz User')
  into actor
  from public.user_profiles
  where id = auth.uid()
    and is_active = true;

  insert into public.proposals(
    proposal_number, client_id, property_id, estimate_id, walkthrough_id,
    division, client_name, property_name, customer_phone, customer_email,
    frequency, requested_date, representative_name, notes, result, photos,
    signature, status, approval_status, approved_at, approved_by,
    approval_notes, sent_at, sent_via, sent_to, sent_by,
    client_access_token, client_access_token_expires_at,
    client_delivery_snapshot, client_acceptance_consent,
    client_acceptance_consent_at, viewed_at, accepted, accepted_at,
    accepted_by_name, acceptance_method, declined_at, decline_reason,
    expiration_date, expired_at, lead_representative_id, revision_group_id,
    revision_number, revised_from_proposal_id, is_current_revision,
    superseded_at
  ) values (
    source.proposal_number || '-R' || next_revision,
    source.client_id, source.property_id, source.estimate_id,
    source.walkthrough_id, source.division, source.client_name,
    source.property_name, source.customer_phone, source.customer_email,
    source.frequency, source.requested_date, source.representative_name,
    source.notes, source.result, '[]'::jsonb, null, 'Draft', 'Not Submitted',
    null, null, null, null, null, null, null, null, null, null, null, null,
    null, false, null, null, null, null, null,
    greatest(source.expiration_date, current_date + 30), null,
    source.lead_representative_id, source.revision_group_id, next_revision,
    source.id, false, null
  )
  returning * into created;

  insert into public.proposal_history(
    proposal_id, event_type, previous_status, new_status, description,
    metadata, performed_by
  ) values (
    created.id, 'Revision Created', source.status, 'Draft',
    'Created from ' || source.proposal_number,
    jsonb_build_object(
      'source_proposal_id', source.id,
      'revision_number', next_revision
    ),
    coalesce(actor, 'StudioScrubz User')
  );

  return created;
end
$$;

revoke all
on function public.create_proposal_revision(uuid)
from public, anon, authenticated;

grant execute
on function public.create_proposal_revision(uuid)
to authenticated;
