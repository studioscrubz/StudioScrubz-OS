begin;

-- Securely record a validated drawn signature with proposal acceptance.
-- Do not expose a direct caller path that bypasses server-side PNG/ink verification.
create or replace function public.accept_proposal_by_token(
  p_token text, p_accepted_by_name text, p_consent boolean, p_signature text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text := pg_catalog.btrim(coalesce(p_accepted_by_name, ''));
  v_consent constant text := 'I have reviewed and accept this Proposal.';
  v_id uuid;
  v_group uuid;
  v_previous_status text;
  v_current boolean;
  v_accepted_at timestamptz := now();
  v_updated_count integer;
begin
  if p_token is null or pg_catalog.length(p_token) < 32 then
    raise exception 'This proposal link is invalid, expired, or no longer available.';
  end if;
  if p_consent is distinct from true then
    raise exception 'Explicit consent is required to accept this Proposal.';
  end if;
  if pg_catalog.length(v_name) < 2 or pg_catalog.length(v_name) > 150 then
    raise exception 'Enter a valid full name.';
  end if;
  -- This RPC is granted only to service_role, and the server validates actual PNG ink.
  if p_signature is null or pg_catalog.length(p_signature) > 700000
     or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'Draw your signature before accepting this Proposal.';
  end if;
  select p.id, p.revision_group_id into v_id, v_group
  from public.proposals p where p.client_access_token = p_token limit 1;
  if v_id is null then
    raise exception 'This Proposal cannot be accepted because it is invalid, expired, archived, or unavailable.';
  end if;
  perform 1 from public.proposals p where p.revision_group_id = v_group for update;
  select p.status, p.is_current_revision into v_previous_status, v_current
  from public.proposals p
  where p.id = v_id and p.archived_at is null
    and p.status in ('Sent','Viewed','Accepted')
    and p.approval_status = 'Approved'
    and p.expiration_date >= current_date
    and (p.client_access_token_expires_at is null or p.client_access_token_expires_at > now());
  if v_previous_status is null then
    raise exception 'This Proposal cannot be accepted because it is invalid, expired, archived, or unavailable.';
  end if;
  if not v_current then
    raise exception 'This Proposal has been revised and can no longer be accepted. Please review the current Proposal.';
  end if;
  if v_previous_status = 'Accepted' then
    perform private.ensure_post_construction_acceptance_handoff(v_id);
    return public.get_proposal_by_token(p_token);
  end if;
  perform pg_catalog.set_config('studioscrubz.controlled_proposal_acceptance','on',true);
  update public.proposals set
    status = 'Accepted',
    accepted = true,
    accepted_at = v_accepted_at,
    accepted_by_name = v_name,
    acceptance_method = 'Signed Proposal',
    signature = p_signature,
    client_acceptance_consent = v_consent,
    client_acceptance_consent_at = v_accepted_at
  where id = v_id and status in ('Sent','Viewed')
    and accepted = false and is_current_revision = true;
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'This Proposal changed before acceptance could be completed. Refresh and try again.';
  end if;
  insert into public.proposal_history(
    proposal_id, event_type, previous_status, new_status,
    description, metadata, performed_by
  ) values (
    v_id, 'Accepted', v_previous_status, 'Accepted',
    'Proposal digitally signed and accepted through the secure client review page.',
    pg_catalog.jsonb_build_object('accepted_by_name',v_name,'accepted_at',v_accepted_at,'signature_recorded',true),
    'Client'
  );
  perform private.ensure_post_construction_acceptance_handoff(v_id);
  return public.get_proposal_by_token(p_token);
end;
$$;

revoke all on function public.accept_proposal_by_token(text,text,boolean) from public, anon, authenticated, service_role;
revoke all on function public.accept_proposal_by_token(text,text,boolean,text) from public, anon, authenticated;
grant execute on function public.accept_proposal_by_token(text,text,boolean,text) to service_role;

-- Sent commercial content remains immutable. The only additional transition
-- allowed here is the exact acceptance update already validated and performed
-- by accept_proposal_by_token. A session setting alone is insufficient: the
-- invoking database role must also be that SECURITY DEFINER function's owner,
-- and every non-acceptance field must remain byte-for-byte equivalent.
create or replace function private.protect_sent_proposal_offer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  assessment_target text := nullif(
    current_setting('studioscrubz.assessment_detachment_target', true),
    ''
  );
  controlled_acceptance boolean := coalesce(
    current_setting('studioscrubz.controlled_proposal_acceptance', true),
    ''
  ) = 'on';
  assessment_delete_owner name;
  acceptance_owner name;
  acceptance_consent constant text := 'I have reviewed and accept this Proposal.';
begin
  if new.accepted is true
    and old.accepted is false
    and old.is_current_revision is not true
  then
    raise exception 'A superseded Proposal cannot be accepted.';
  end if;

  if controlled_acceptance then
    select pg_catalog.pg_get_userbyid(procedure.proowner)
    into acceptance_owner
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.accept_proposal_by_token(text,text,boolean,text)'
    );

    if current_user is not distinct from acceptance_owner
      and old.sent_at is not null
      and old.status in ('Sent', 'Viewed')
      and new.status = 'Accepted'
      and old.accepted is false
      and new.accepted
      and old.accepted_at is null
      and new.accepted_at is not null
      and length(pg_catalog.btrim(coalesce(new.accepted_by_name, ''))) between 2 and 150
      and new.acceptance_method = 'Signed Proposal'
      and new.signature is not null
      and new.signature is distinct from old.signature
      and new.client_acceptance_consent = acceptance_consent
      and new.client_acceptance_consent_at is not null
      and new.accepted_at is not distinct from new.client_acceptance_consent_at
      and old.is_current_revision
      and new.is_current_revision
      and (pg_catalog.to_jsonb(new) - array[
        'status', 'accepted', 'accepted_at', 'accepted_by_name',
        'acceptance_method', 'signature', 'client_acceptance_consent',
        'client_acceptance_consent_at', 'updated_at'
      ]::text[]) is not distinct from (pg_catalog.to_jsonb(old) - array[
        'status', 'accepted', 'accepted_at', 'accepted_by_name',
        'acceptance_method', 'signature', 'client_acceptance_consent',
        'client_acceptance_consent_at', 'updated_at'
      ]::text[])
    then
      return new;
    end if;
  end if;

  if old.sent_at is not null and (
    new.client_id is distinct from old.client_id
    or new.property_id is distinct from old.property_id
    or new.estimate_id is distinct from old.estimate_id
    or new.walkthrough_id is distinct from old.walkthrough_id
    or new.division is distinct from old.division
    or new.client_name is distinct from old.client_name
    or new.property_name is distinct from old.property_name
    or new.frequency is distinct from old.frequency
    or new.requested_date is distinct from old.requested_date
    or new.notes is distinct from old.notes
    or new.result is distinct from old.result
    or new.photos is distinct from old.photos
    or new.signature is distinct from old.signature
    or new.expiration_date is distinct from old.expiration_date
  ) then
    select pg_catalog.pg_get_userbyid(procedure.proowner)
    into assessment_delete_owner
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.master_admin_permanently_delete_assessment(uuid)'
    );

    if assessment_target is null
      or current_user is distinct from assessment_delete_owner
      or old.walkthrough_id::text is distinct from assessment_target
      or new.walkthrough_id is not null
      or (pg_catalog.to_jsonb(new) - 'walkthrough_id')
        is distinct from (pg_catalog.to_jsonb(old) - 'walkthrough_id')
    then
      raise exception 'Sent Proposal revisions are immutable. Create a revision instead.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.protect_sent_proposal_offer()
from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
