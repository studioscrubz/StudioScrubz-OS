begin;

-- Historical revisions are immutable except for two existing, tightly scoped
-- system transitions. A caller-controlled setting is never sufficient: each
-- exception also requires the exact SECURITY DEFINER RPC owner and an exact
-- row-difference allowlist.
create function private.protect_historical_proposal_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  activation_target text := nullif(
    current_setting('studioscrubz.proposal_revision_activation_target', true),
    ''
  );
  assessment_target text := nullif(
    current_setting('studioscrubz.assessment_detachment_target', true),
    ''
  );
  delivery_owner name;
  assessment_delete_owner name;
  revision_fields_changed boolean :=
    new.is_current_revision is distinct from old.is_current_revision
    or new.superseded_at is distinct from old.superseded_at;
begin
  select pg_catalog.pg_get_userbyid(procedure.proowner)
  into delivery_owner
  from pg_catalog.pg_proc procedure
  where procedure.oid = pg_catalog.to_regprocedure(
    'public.mark_proposal_sent_for_delivery(uuid,text,text,text,text,timestamp with time zone,jsonb)'
  );

  select pg_catalog.pg_get_userbyid(procedure.proowner)
  into assessment_delete_owner
  from pg_catalog.pg_proc procedure
  where procedure.oid = pg_catalog.to_regprocedure(
    'public.master_admin_permanently_delete_assessment(uuid)'
  );

  if revision_fields_changed then
    if activation_target is null
      or current_user is distinct from delivery_owner
      or (
        not (
          old.is_current_revision
          and new.is_current_revision is false
          and new.superseded_at is not null
          and old.id::text is distinct from activation_target
          and exists (
            select 1
            from public.proposals target
            where target.id::text = activation_target
              and target.revision_group_id = old.revision_group_id
              and target.is_current_revision is false
              and target.archived_at is null
              and target.status = 'Approved'
              and target.approval_status = 'Approved'
              and target.accepted is false
              and target.client_delivery_snapshot is not null
              and target.client_access_token is not null
          )
          and (to_jsonb(new) - array['is_current_revision', 'superseded_at']::text[])
            is not distinct from
              (to_jsonb(old) - array['is_current_revision', 'superseded_at']::text[])
        )
        and not (
          old.id::text = activation_target
          and old.is_current_revision is false
          and new.is_current_revision
          and new.superseded_at is null
          and old.archived_at is null
          and old.status = 'Approved'
          and old.approval_status = 'Approved'
          and old.accepted is false
          and old.client_delivery_snapshot is not null
          and old.client_access_token is not null
          and (to_jsonb(new) - array['is_current_revision', 'superseded_at']::text[])
            is not distinct from
              (to_jsonb(old) - array['is_current_revision', 'superseded_at']::text[])
        )
      )
    then
      raise exception 'Proposal revision activation is restricted to the controlled delivery workflow.'
        using errcode = '55000';
    end if;

    return new;
  end if;

  if old.superseded_at is not null
    or old.archived_at is not null
    or old.status = 'Archived'
    or (
      old.is_current_revision is false
      and exists (
        select 1
        from public.proposals newer
        where newer.revision_group_id = old.revision_group_id
          and newer.revision_number > old.revision_number
          and newer.is_current_revision
      )
    )
  then
    if assessment_target is not null
      and current_user is not distinct from assessment_delete_owner
      and old.walkthrough_id::text = assessment_target
      and new.walkthrough_id is null
      and (to_jsonb(new) - 'walkthrough_id')
        is not distinct from (to_jsonb(old) - 'walkthrough_id')
    then
      return new;
    end if;

    raise exception 'Historical Proposal revisions are read-only.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_historical_proposal_revision()
from public, anon, authenticated, service_role;

create trigger proposals_protect_historical_revision
before update on public.proposals
for each row execute function private.protect_historical_proposal_revision();

-- The pre-existing sent-offer guard also sees Assessment detachment. Keep all
-- delivered commercial content immutable while permitting only the same exact
-- Master Admin RPC to clear walkthrough_id. Run as the invoking role so a
-- caller-created setting cannot impersonate the RPC owner.
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
  assessment_delete_owner name;
begin
  if new.accepted is true
    and old.accepted is false
    and old.is_current_revision is not true
  then
    raise exception 'A superseded Proposal cannot be accepted.';
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
      or (to_jsonb(new) - 'walkthrough_id')
        is distinct from (to_jsonb(old) - 'walkthrough_id')
    then
      raise exception 'Sent Proposal revisions are immutable. Create a revision instead.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.protect_sent_proposal_offer()
from public, anon, authenticated, service_role;

-- Preserve the production delivery implementation and authorize only its
-- already-validated, transactionally locked revision-family activation.
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
    perform set_config(
      'studioscrubz.proposal_revision_activation_target',
      row.id::text,
      true
    );

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

    perform set_config(
      'studioscrubz.proposal_revision_activation_target',
      '',
      true
    );
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

revoke all on function public.mark_proposal_sent_for_delivery(
  uuid, text, text, text, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.mark_proposal_sent_for_delivery(
  uuid, text, text, text, text, timestamptz, jsonb
) to authenticated;

-- Preserve the existing retained-record deletion workflow. Historical rows may
-- lose only their Assessment foreign key, and only while this exact Master
-- Admin RPC runs under its owner after performing its existing authorization.
create or replace function public.master_admin_permanently_delete_assessment(
  p_assessment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assessment public.walkthroughs;
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Master Admin authorization is required for permanent Assessment deletion.' using errcode = '42501';
  end if;

  select * into assessment
  from public.walkthroughs
  where id = p_assessment_id
  for update;

  if not found then
    return jsonb_build_object('deleted', false, 'assessment_id', p_assessment_id);
  end if;

  delete from public.assessment_history
  where walkthrough_id = assessment.id;

  perform set_config(
    'studioscrubz.assessment_detachment_target',
    assessment.id::text,
    true
  );

  update public.proposals
  set walkthrough_id = null
  where walkthrough_id = assessment.id;

  perform set_config(
    'studioscrubz.assessment_detachment_target',
    '',
    true
  );

  update public.jobs
  set walkthrough_id = null
  where walkthrough_id = assessment.id;

  delete from public.walkthroughs
  where id = assessment.id;

  delete from public.attention_item_states
  where attention_key = 'walkthrough:' || assessment.id::text || ':requested';

  return jsonb_build_object(
    'deleted', true,
    'assessment_id', assessment.id,
    'photos', coalesce(assessment.photos, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.master_admin_permanently_delete_assessment(uuid)
from public, anon, authenticated;
grant execute on function public.master_admin_permanently_delete_assessment(uuid)
to authenticated;

-- Proposal history is append-only for API roles. Remove the legacy broad table
-- grant (including TRIGGER and REFERENCES), then restore only read and append.
-- Existing SECURITY DEFINER lifecycle and permanent-delete RPCs retain their
-- owner-authorized behavior.
revoke all on table public.proposal_history
from public, anon, authenticated, service_role;
grant select, insert on table public.proposal_history
to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
