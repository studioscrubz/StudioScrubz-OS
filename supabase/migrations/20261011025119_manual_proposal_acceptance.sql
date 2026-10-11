begin;

create or replace function public.can_record_manual_proposal_acceptance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles profile
    where profile.id = (select auth.uid())
      and profile.is_active
      and profile.role in ('Master Admin', 'Administrator')
  );
$$;

revoke all on function public.can_record_manual_proposal_acceptance()
from public, anon, authenticated, service_role;
grant execute on function public.can_record_manual_proposal_acceptance()
to authenticated;

create or replace function public.record_manual_proposal_acceptance(
  p_proposal_id uuid,
  p_acceptance_method text,
  p_accepted_at timestamptz,
  p_notes text,
  p_authorization_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal_row public.proposals;
  actor public.user_profiles;
  previous_status text;
  recorded_at timestamptz := clock_timestamp();
  accepted_name text;
  normalized_method text := btrim(coalesce(p_acceptance_method, ''));
  normalized_notes text := btrim(coalesce(p_notes, ''));
  handoff jsonb;
begin
  select * into actor
  from public.user_profiles profile
  where profile.id = (select auth.uid())
    and profile.is_active
    and profile.role in ('Master Admin', 'Administrator');

  if not found then
    raise exception 'Manual Proposal acceptance requires an active Master Admin or Administrator account.'
      using errcode = '42501';
  end if;
  if p_authorization_confirmed is distinct from true then
    raise exception 'Confirm the client explicitly authorized acceptance of this exact Proposal revision.';
  end if;
  if normalized_method not in ('Phone', 'Email', 'Text Message', 'In Person', 'Other') then
    raise exception 'Select a valid acceptance method.';
  end if;
  if length(normalized_notes) < 2 or length(normalized_notes) > 2000 then
    raise exception 'Enter a notes or evidence reference between 2 and 2000 characters.';
  end if;
  if p_accepted_at is null or p_accepted_at > recorded_at then
    raise exception 'The client acceptance time must not be in the future.';
  end if;

  select * into proposal_row
  from public.proposals proposal
  where proposal.id = p_proposal_id
  for update;

  if not found then raise exception 'Proposal not found.'; end if;

  perform 1
  from public.proposals proposal
  where proposal.revision_group_id = proposal_row.revision_group_id
  for update;

  if proposal_row.archived_at is not null
    or not proposal_row.is_current_revision
    or proposal_row.superseded_at is not null
    or proposal_row.approval_status <> 'Approved'
    or proposal_row.expiration_date < current_date
  then
    raise exception 'Only the current, approved, unexpired Sent or Viewed Proposal revision can be accepted.';
  end if;

  if proposal_row.status = 'Accepted' and proposal_row.accepted then
    handoff := private.ensure_post_construction_acceptance_handoff(proposal_row.id);
    return jsonb_build_object(
      'proposal_id', proposal_row.id,
      'status', proposal_row.status,
      'accepted_at', proposal_row.accepted_at,
      'accepted_now', false,
      'handoff', handoff
    );
  end if;

  if proposal_row.status not in ('Sent', 'Viewed')
    or proposal_row.accepted
  then
    raise exception 'Only the current, approved, unexpired Sent or Viewed Proposal revision can be accepted.';
  end if;
  if proposal_row.sent_at is null or p_accepted_at < proposal_row.sent_at then
    raise exception 'The client acceptance time cannot be earlier than Proposal delivery.';
  end if;

  previous_status := proposal_row.status;
  accepted_name := coalesce(nullif(btrim(proposal_row.client_name), ''), 'Client');

  perform set_config('studioscrubz.controlled_manual_proposal_acceptance', 'on', true);

  update public.proposals
  set status = 'Accepted',
      accepted = true,
      accepted_at = p_accepted_at,
      accepted_by_name = accepted_name,
      acceptance_method = 'Manual - ' || normalized_method,
      client_acceptance_consent = null,
      client_acceptance_consent_at = null
  where id = proposal_row.id;

  perform set_config('studioscrubz.controlled_manual_proposal_acceptance', '', true);

  insert into public.proposal_history(
    proposal_id, event_type, previous_status, new_status,
    description, metadata, performed_by
  ) values (
    proposal_row.id,
    'Manual Acceptance',
    previous_status,
    'Accepted',
    'Client acceptance recorded by an authorized administrator.',
    jsonb_build_object(
      'acceptance_source', 'Manual Acceptance',
      'acceptance_method', normalized_method,
      'accepted_at', p_accepted_at,
      'recorded_at', recorded_at,
      'recorded_by_user_id', actor.id,
      'client_authorization_confirmed', true,
      'notes', normalized_notes,
      'revision_number', proposal_row.revision_number
    ),
    coalesce(nullif(btrim(actor.display_name), ''), actor.email, 'Authorized Administrator')
  );

  handoff := private.ensure_post_construction_acceptance_handoff(proposal_row.id);
  if handoff->>'agreement_id' is not null then
    update public.service_agreements
    set pricing_snapshot = coalesce(pricing_snapshot, '{}'::jsonb) || jsonb_build_object(
      'acceptance_source', 'Manual Acceptance',
      'acceptance_method', normalized_method,
      'accepted_at', p_accepted_at,
      'recorded_at', recorded_at,
      'recorded_by_user_id', actor.id
    )
    where id = (handoff->>'agreement_id')::uuid;
  end if;

  return jsonb_build_object(
    'proposal_id', proposal_row.id,
    'status', 'Accepted',
    'accepted_at', p_accepted_at,
    'accepted_now', true,
    'handoff', handoff
  );
end;
$$;

-- Preserve the existing Master Admin and online-client paths while adding an
-- owner-bound allowlist for the exact manual acceptance transition. A caller
-- cannot authorize itself by setting the GUC.
create or replace function public.protect_proposal_approval_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  controlled_acceptance boolean := coalesce(
    current_setting('studioscrubz.controlled_proposal_acceptance', true), ''
  ) = 'on';
  controlled_manual_acceptance boolean := coalesce(
    current_setting('studioscrubz.controlled_manual_proposal_acceptance', true), ''
  ) = 'on';
  manual_acceptance_owner name;
  consent constant text := 'I have reviewed and accept this Proposal.';
begin
  if public.is_master_admin() then return new; end if;

  if controlled_manual_acceptance then
    select pg_catalog.pg_get_userbyid(procedure.proowner)
    into manual_acceptance_owner
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.record_manual_proposal_acceptance(uuid,text,timestamp with time zone,text,boolean)'
    );

    if current_user is not distinct from manual_acceptance_owner
      and tg_op = 'UPDATE'
      and old.status in ('Sent', 'Viewed')
      and new.status = 'Accepted'
      and old.accepted is false and new.accepted
      and old.accepted_at is null and new.accepted_at is not null
      and length(pg_catalog.btrim(coalesce(new.accepted_by_name, ''))) between 2 and 150
      and new.acceptance_method = any(array[
        'Manual - Phone', 'Manual - Email', 'Manual - Text Message',
        'Manual - In Person', 'Manual - Other'
      ])
      and new.client_acceptance_consent is null
      and new.client_acceptance_consent_at is null
      and (pg_catalog.to_jsonb(new) - array[
        'status', 'accepted', 'accepted_at', 'accepted_by_name',
        'acceptance_method', 'updated_at'
      ]::text[]) is not distinct from (pg_catalog.to_jsonb(old) - array[
        'status', 'accepted', 'accepted_at', 'accepted_by_name',
        'acceptance_method', 'updated_at'
      ]::text[])
    then return new; end if;

    raise exception 'Controlled manual Proposal acceptance may change only permitted acceptance fields.';
  end if;

  if controlled_acceptance then
    if tg_op <> 'UPDATE'
      or old.status not in ('Sent', 'Viewed')
      or new.status <> 'Accepted'
      or old.accepted is distinct from false
      or new.accepted is distinct from true
      or old.accepted_at is not null
      or new.accepted_at is null
      or length(pg_catalog.btrim(coalesce(new.accepted_by_name, ''))) < 2
      or new.acceptance_method is distinct from 'Signed Proposal'
      or new.client_acceptance_consent is distinct from consent
      or new.client_acceptance_consent_at is null
      or new.accepted_at is distinct from new.client_acceptance_consent_at
      or (pg_catalog.to_jsonb(new) - array[
        'status', 'accepted', 'accepted_at', 'accepted_by_name',
        'acceptance_method', 'client_acceptance_consent',
        'client_acceptance_consent_at', 'updated_at'
      ]::text[]) is distinct from (pg_catalog.to_jsonb(old) - array[
        'status', 'accepted', 'accepted_at', 'accepted_by_name',
        'acceptance_method', 'client_acceptance_consent',
        'client_acceptance_consent_at', 'updated_at'
      ]::text[])
    then
      raise exception 'Controlled Proposal acceptance may change only the permitted client acceptance fields';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.approval_status = 'Approved'
      or new.approved_at is not null or new.approved_by is not null
      or new.approval_notes is not null or new.status in ('Approved', 'Accepted')
      or new.accepted = true or new.accepted_at is not null
      or new.accepted_by_name is not null or new.acceptance_method is not null
      or new.client_acceptance_consent is not null
      or new.client_acceptance_consent_at is not null
    then raise exception 'Only Master Admin may set proposal approval or acceptance fields'; end if;
  elsif ((new.approval_status = 'Approved' or old.approval_status = 'Approved')
      and new.approval_status is distinct from old.approval_status)
    or new.approved_at is distinct from old.approved_at
    or new.approved_by is distinct from old.approved_by
    or new.approval_notes is distinct from old.approval_notes
    or (new.status in ('Approved', 'Accepted') and new.status is distinct from old.status)
    or (old.status in ('Approved', 'Accepted') and new.status is distinct from old.status)
    or new.accepted is distinct from old.accepted
    or new.accepted_at is distinct from old.accepted_at
    or new.accepted_by_name is distinct from old.accepted_by_name
    or new.acceptance_method is distinct from old.acceptance_method
    or new.client_acceptance_consent is distinct from old.client_acceptance_consent
    or new.client_acceptance_consent_at is distinct from old.client_acceptance_consent_at
  then raise exception 'Only Master Admin may change proposal approval or acceptance fields'; end if;
  return new;
end;
$$;

revoke all on function public.protect_proposal_approval_fields()
from public, anon, authenticated, service_role;

revoke all on function public.record_manual_proposal_acceptance(
  uuid, text, timestamptz, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.record_manual_proposal_acceptance(
  uuid, text, timestamptz, text, boolean
) to authenticated;

notify pgrst, 'reload schema';

commit;
