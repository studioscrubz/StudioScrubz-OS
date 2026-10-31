-- Reconcile the approval trigger with digitally signed proposal acceptance.
-- The sent-offer guard independently verifies this exact transition and all immutable fields.
CREATE OR REPLACE FUNCTION public.protect_proposal_approval_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  controlled_acceptance boolean := coalesce(
    current_setting('studioscrubz.controlled_proposal_acceptance', true), ''
  ) = 'on';
  controlled_manual_acceptance boolean := coalesce(
    current_setting('studioscrubz.controlled_manual_proposal_acceptance', true), ''
  ) = 'on';
  manual_acceptance_owner name;
  digital_acceptance_owner name;
  consent constant text := 'I have reviewed and accept this Proposal.';
begin
  -- Manager decisions may modify approval columns only inside the audited SECURITY DEFINER review RPC.
  if coalesce(current_setting('studioscrubz.proposal_review_rpc', true),'')='on'
    and current_user = (
      select pg_catalog.pg_get_userbyid(procedure.proowner)
      from pg_catalog.pg_proc procedure
      where procedure.oid=pg_catalog.to_regprocedure('public.review_proposal_approval(uuid,text,text)')
    ) then return new; end if;

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
    select pg_catalog.pg_get_userbyid(procedure.proowner)
      into digital_acceptance_owner
      from pg_catalog.pg_proc procedure
      where procedure.oid = pg_catalog.to_regprocedure(
        'public.accept_proposal_by_token(text,text,boolean,text)'
      );
    if current_user is distinct from digital_acceptance_owner
      or tg_op <> 'UPDATE'
      or old.status not in ('Sent', 'Viewed')
      or new.status <> 'Accepted'
      or old.accepted is distinct from false
      or new.accepted is distinct from true
      or old.accepted_at is not null
      or new.accepted_at is null
      or length(pg_catalog.btrim(coalesce(new.accepted_by_name, ''))) < 2
      or new.acceptance_method is distinct from 'Signed Proposal'
      or old.signature is not null
      or new.signature is null
      or new.signature is not distinct from old.signature
      or new.client_acceptance_consent is distinct from consent
      or new.client_acceptance_consent_at is null
      or new.accepted_at is distinct from new.client_acceptance_consent_at
      or (pg_catalog.to_jsonb(new) - array[
        'status', 'accepted', 'accepted_at', 'accepted_by_name',
        'acceptance_method', 'signature', 'client_acceptance_consent',
        'client_acceptance_consent_at', 'updated_at'
      ]::text[]) is distinct from (pg_catalog.to_jsonb(old) - array[
        'status', 'accepted', 'accepted_at', 'accepted_by_name',
        'acceptance_method', 'signature', 'client_acceptance_consent',
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
$function$
;

revoke all on function public.protect_proposal_approval_fields() from public, anon, authenticated, service_role;
