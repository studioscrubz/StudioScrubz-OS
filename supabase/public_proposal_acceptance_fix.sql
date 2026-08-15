-- StudioScrubz OS: controlled public Proposal acceptance trigger fix.
-- REVIEW ONLY. Do not execute automatically.
-- Run after role_permissions.sql and estimate_proposal_delivery.sql.

create or replace function public.protect_proposal_approval_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_controlled_acceptance boolean := coalesce(current_setting('studioscrubz.controlled_proposal_acceptance', true), '') = 'on';
  v_consent constant text := 'I have reviewed and accept this Proposal.';
begin
  if public.is_master_admin() then
    return new;
  end if;

  if v_controlled_acceptance then
    if TG_OP <> 'UPDATE'
      or old.status not in ('Sent', 'Viewed')
      or new.status <> 'Accepted'
      or old.accepted is distinct from false
      or new.accepted is distinct from true
      or old.accepted_at is not null
      or new.accepted_at is null
      or length(btrim(coalesce(new.accepted_by_name, ''))) < 2
      or new.acceptance_method is distinct from 'Signed Proposal'
      or new.client_acceptance_consent is distinct from v_consent
      or new.client_acceptance_consent_at is null
      or new.accepted_at is distinct from new.client_acceptance_consent_at
      or (to_jsonb(new) - array[
        'status', 'accepted', 'accepted_at', 'accepted_by_name',
        'acceptance_method', 'client_acceptance_consent',
        'client_acceptance_consent_at', 'updated_at'
      ]::text[]) is distinct from (to_jsonb(old) - array[
        'status', 'accepted', 'accepted_at', 'accepted_by_name',
        'acceptance_method', 'client_acceptance_consent',
        'client_acceptance_consent_at', 'updated_at'
      ]::text[])
    then
      raise exception 'Controlled Proposal acceptance may change only the permitted client acceptance fields';
    end if;
    return new;
  end if;

  if TG_OP = 'INSERT' then
    if new.approval_status = 'Approved'
      or new.approved_at is not null
      or new.approved_by is not null
      or new.approval_notes is not null
      or new.status in ('Approved', 'Accepted')
      or new.accepted = true
      or new.accepted_at is not null
      or new.accepted_by_name is not null
      or new.acceptance_method is not null
      or new.client_acceptance_consent is not null
      or new.client_acceptance_consent_at is not null
    then
      raise exception 'Only Master Admin may set proposal approval or acceptance fields';
    end if;
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
  then
    raise exception 'Only Master Admin may change proposal approval or acceptance fields';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_proposal_approval_fields() from public, anon, authenticated;

create or replace function public.accept_proposal_by_token(
  p_token text,
  p_accepted_by_name text,
  p_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_accepted_by_name, ''));
  v_consent constant text := 'I have reviewed and accept this Proposal.';
  v_id uuid;
  v_previous_status text;
  v_accepted_at timestamptz := now();
  v_updated_count integer;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This proposal link is invalid, expired, or no longer available.';
  end if;
  if p_consent is distinct from true then
    raise exception 'Explicit consent is required to accept this Proposal.';
  end if;
  if length(v_name) < 2 or length(v_name) > 150 then
    raise exception 'Enter a valid full name.';
  end if;

  select p.id, p.status into v_id, v_previous_status
  from public.proposals p
  where p.client_access_token = p_token
    and p.archived_at is null
    and p.status in ('Sent', 'Viewed')
    and p.approval_status = 'Approved'
    and p.accepted = false
    and p.expiration_date >= current_date
    and (p.client_access_token_expires_at is null or p.client_access_token_expires_at > now())
  limit 1
  for update;

  if v_id is null then
    raise exception 'This Proposal cannot be accepted because it is invalid, expired, archived, or already accepted.';
  end if;

  perform set_config('studioscrubz.controlled_proposal_acceptance', 'on', true);

  update public.proposals
  set status = 'Accepted',
      accepted = true,
      accepted_at = v_accepted_at,
      accepted_by_name = v_name,
      acceptance_method = 'Signed Proposal',
      client_acceptance_consent = v_consent,
      client_acceptance_consent_at = v_accepted_at
  where id = v_id
    and client_access_token = p_token
    and archived_at is null
    and status in ('Sent', 'Viewed')
    and approval_status = 'Approved'
    and accepted = false
    and expiration_date >= current_date
    and (client_access_token_expires_at is null or client_access_token_expires_at > now());

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'This Proposal changed before acceptance could be completed. Refresh and try again.';
  end if;

  insert into public.proposal_history (
    proposal_id, event_type, previous_status, new_status,
    description, metadata, performed_by
  ) values (
    v_id, 'Accepted', v_previous_status, 'Accepted',
    'Proposal accepted through the secure client review page.',
    jsonb_build_object('accepted_by_name', v_name, 'accepted_at', v_accepted_at),
    'Client'
  );

  return public.get_proposal_by_token(p_token);
end;
$$;

revoke all on function public.accept_proposal_by_token(text, text, boolean) from public, anon, authenticated;
grant execute on function public.accept_proposal_by_token(text, text, boolean) to anon, authenticated;

-- The proposals table receives no anon privileges or policies here. Public
-- acceptance remains available only through the validated token-scoped RPC.
