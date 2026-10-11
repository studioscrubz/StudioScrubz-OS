begin;

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
      'public.accept_proposal_by_token(text,text,boolean)'
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
      and new.client_acceptance_consent = acceptance_consent
      and new.client_acceptance_consent_at is not null
      and new.accepted_at is not distinct from new.client_acceptance_consent_at
      and old.is_current_revision
      and new.is_current_revision
      and (pg_catalog.to_jsonb(new) - array[
        'status', 'accepted', 'accepted_at', 'accepted_by_name',
        'acceptance_method', 'client_acceptance_consent',
        'client_acceptance_consent_at', 'updated_at'
      ]::text[]) is not distinct from (pg_catalog.to_jsonb(old) - array[
        'status', 'accepted', 'accepted_at', 'accepted_by_name',
        'acceptance_method', 'client_acceptance_consent',
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
