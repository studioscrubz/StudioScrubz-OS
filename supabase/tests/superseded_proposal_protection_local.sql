-- Disposable/local executable regression coverage for
-- 20261010010000_protect_superseded_proposals.sql.
-- The script rolls back every fixture and assertion-side change.

begin;

insert into auth.users(id, email, role, aud)
values (
  '10000000-0000-0000-0000-000000000001'::uuid,
  'proposal-protection@example.test',
  'authenticated',
  'authenticated'
);

insert into public.user_profiles(id, email, display_name, role, is_active)
values (
  '10000000-0000-0000-0000-000000000001'::uuid,
  'proposal-protection@example.test',
  'Proposal Protection Test',
  'Master Admin',
  true
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.clients(id, client_type, company_name, status)
values (
  '20000000-0000-0000-0000-000000000001'::uuid,
  'Commercial',
  'Proposal Protection Test Client',
  'Active'
);

insert into public.properties(id, client_id, property_name, property_type, address)
values (
  '30000000-0000-0000-0000-000000000001'::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  'Proposal Protection Test Property',
  'Commercial',
  '1 Test Way'
);

insert into public.walkthroughs(
  id, client_id, property_id, division, status, contact_name
) values (
  '40000000-0000-0000-0000-000000000001'::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  '30000000-0000-0000-0000-000000000001'::uuid,
  'Commercial',
  'Completed',
  'Test Contact'
);

select set_config('studioscrubz.controlled_delivery_snapshot', 'on', true);
insert into public.proposals(
  id, proposal_number, client_id, property_id, walkthrough_id, division,
  client_name, property_name, customer_email, frequency, result, status,
  approval_status, approved_at, approved_by, sent_at, sent_via, sent_to,
  client_access_token, client_access_token_expires_at,
  client_delivery_snapshot, accepted, expiration_date,
  revision_group_id, revision_number, revised_from_proposal_id,
  is_current_revision, superseded_at
) values (
  '50000000-0000-0000-0000-000000000002'::uuid,
  'PROP-LOCAL-PROTECT-R2',
  '20000000-0000-0000-0000-000000000001'::uuid,
  '30000000-0000-0000-0000-000000000001'::uuid,
  '40000000-0000-0000-0000-000000000001'::uuid,
  'Commercial',
  'Proposal Protection Test Client',
  'Proposal Protection Test Property',
  'client@example.test',
  'One-Time',
  jsonb_build_object('baseEstimateAmount', 350, 'perVisitTotal', 400),
  'Sent',
  'Approved',
  now(),
  'Proposal Protection Test',
  now(),
  'Email',
  'client@example.test',
  repeat('2', 40),
  now() + interval '30 days',
  jsonb_build_object('base_price', 350, 'per_visit_total', 400),
  false,
  current_date + 30,
  '60000000-0000-0000-0000-000000000001'::uuid,
  2,
  null,
  true,
  null
);
select set_config('studioscrubz.controlled_delivery_snapshot', '', true);

set local role authenticated;

-- R2 -> R3 creation remains valid. The new draft is non-current but is not
-- historical until delivery supersedes the prior active revision.
select public.create_proposal_revision(
  '50000000-0000-0000-0000-000000000002'::uuid
);

do $test$
declare
  revision public.proposals;
begin
  select * into strict revision
  from public.proposals
  where revised_from_proposal_id = '50000000-0000-0000-0000-000000000002'::uuid;

  if revision.revision_number <> 3
    or revision.status <> 'Draft'
    or revision.is_current_revision
    or revision.superseded_at is not null
  then
    raise exception 'R3 creation did not preserve the pending-revision state.';
  end if;

  perform set_config('test.proposal_r3_id', revision.id::text, true);
end;
$test$;

-- Pending R3 can follow the ordinary edit / approval / delivery-preparation
-- path while R2 remains the active public proposal.
update public.proposals
set status = 'Approved',
    approval_status = 'Approved',
    approved_at = now(),
    approved_by = 'Proposal Protection Test'
where id = current_setting('test.proposal_r3_id')::uuid;

select public.prepare_proposal_delivery(
  current_setting('test.proposal_r3_id')::uuid,
  repeat('3', 40),
  now() + interval '30 days',
  jsonb_build_object('base_price', 350, 'per_visit_total', 400)
);

reset role;

-- Force a post-activation audit insert failure. The delivery RPC must roll
-- the R2/R3 activation back atomically.
create function pg_temp.reject_sent_history()
returns trigger
language plpgsql
as $$
begin
  if new.event_type like 'Sent by %' then
    raise exception 'Injected proposal history failure.';
  end if;
  return new;
end;
$$;

create trigger proposal_history_injected_failure
before insert on public.proposal_history
for each row execute function pg_temp.reject_sent_history();

set local role authenticated;
do $test$
begin
  begin
    perform public.mark_proposal_sent_for_delivery(
      current_setting('test.proposal_r3_id')::uuid,
      'Email',
      'client@example.test',
      'Proposal Protection Test',
      repeat('3', 40),
      (select client_access_token_expires_at
       from public.proposals
       where id = current_setting('test.proposal_r3_id')::uuid),
      (select client_delivery_snapshot
       from public.proposals
       where id = current_setting('test.proposal_r3_id')::uuid)
    );
    raise exception 'Expected the injected delivery failure.';
  exception
    when others then
      if sqlerrm = 'Expected the injected delivery failure.' then
        raise;
      end if;
  end;

  if not (select is_current_revision from public.proposals
          where id = '50000000-0000-0000-0000-000000000002'::uuid)
    or (select is_current_revision from public.proposals
        where id = current_setting('test.proposal_r3_id')::uuid)
  then
    raise exception 'Failed delivery did not roll revision activation back.';
  end if;
end;
$test$;

reset role;
drop trigger proposal_history_injected_failure on public.proposal_history;
drop function pg_temp.reject_sent_history();

set local role authenticated;
select public.mark_proposal_sent_for_delivery(
  current_setting('test.proposal_r3_id')::uuid,
  'Email',
  'client@example.test',
  'Proposal Protection Test',
  repeat('3', 40),
  (select client_access_token_expires_at
   from public.proposals
   where id = current_setting('test.proposal_r3_id')::uuid),
  (select client_delivery_snapshot
   from public.proposals
   where id = current_setting('test.proposal_r3_id')::uuid)
);

do $test$
begin
  if (select is_current_revision from public.proposals
      where id = '50000000-0000-0000-0000-000000000002'::uuid)
    or (select superseded_at is null from public.proposals
        where id = '50000000-0000-0000-0000-000000000002'::uuid)
    or not (select is_current_revision from public.proposals
            where id = current_setting('test.proposal_r3_id')::uuid)
    or (select status <> 'Sent' from public.proposals
        where id = current_setting('test.proposal_r3_id')::uuid)
  then
    raise exception 'Controlled R3 activation produced an invalid state.';
  end if;
end;
$test$;

-- A caller-set GUC is insufficient: direct API mutation still fails because
-- current_user is not the trusted RPC owner.
do $test$
begin
  perform set_config(
    'studioscrubz.proposal_revision_activation_target',
    current_setting('test.proposal_r3_id'),
    true
  );
  begin
    update public.proposals
    set is_current_revision = true,
        superseded_at = null
    where id = '50000000-0000-0000-0000-000000000002'::uuid;
    raise exception 'Expected direct historical activation rejection.';
  exception
    when sqlstate '55000' then null;
  end;
  perform set_config('studioscrubz.proposal_revision_activation_target', '', true);
end;
$test$;

do $test$
begin
  begin
    update public.proposals
    set notes = 'unauthorized historical edit'
    where id = '50000000-0000-0000-0000-000000000002'::uuid;
    raise exception 'Expected historical edit rejection.';
  exception
    when sqlstate '55000' then null;
  end;
end;
$test$;

-- Fail closed for legacy rows whose superseded_at marker is missing: a newer
-- current revision still makes the older row historical.
reset role;
insert into public.proposals(
  id, proposal_number, division, frequency, result, status, approval_status,
  accepted, expiration_date, revision_group_id, revision_number,
  is_current_revision, superseded_at
) values
(
  '50000000-0000-0000-0000-000000000020'::uuid,
  'PROP-LOCAL-STALE-R1', 'Commercial', 'One-Time', '{}'::jsonb,
  'Draft', 'Not Submitted', false, current_date + 30,
  '60000000-0000-0000-0000-000000000020'::uuid, 1, false, null
),
(
  '50000000-0000-0000-0000-000000000021'::uuid,
  'PROP-LOCAL-STALE-R2', 'Commercial', 'One-Time', '{}'::jsonb,
  'Sent', 'Approved', false, current_date + 30,
  '60000000-0000-0000-0000-000000000020'::uuid, 2, true, null
);
set local role authenticated;

do $test$
begin
  begin
    update public.proposals
    set notes = 'forbidden stale historical edit'
    where id = '50000000-0000-0000-0000-000000000020'::uuid;
    raise exception 'Expected stale historical edit rejection.';
  exception
    when sqlstate '55000' then null;
  end;
end;
$test$;

-- Authorized audit inserts and reads remain available to application roles.
insert into public.proposal_history(
  proposal_id, event_type, previous_status, new_status,
  description, metadata, performed_by
) values (
  current_setting('test.proposal_r3_id')::uuid,
  'Local Protection Test',
  'Sent',
  'Sent',
  'Authorized append-only test event.',
  '{}'::jsonb,
  'Proposal Protection Test'
);

do $test$
begin
  if not exists (
    select 1 from public.proposal_history
    where proposal_id = current_setting('test.proposal_r3_id')::uuid
      and event_type = 'Local Protection Test'
  ) then
    raise exception 'Authorized proposal history retrieval failed.';
  end if;

  begin
    update public.proposal_history
    set description = 'forbidden'
    where event_type = 'Local Protection Test';
    raise exception 'Expected proposal history update rejection.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    delete from public.proposal_history
    where event_type = 'Local Protection Test';
    raise exception 'Expected proposal history delete rejection.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    truncate public.proposal_history;
    raise exception 'Expected proposal history truncate rejection.';
  exception
    when insufficient_privilege then null;
  end;
end;
$test$;

-- Public revision history is family-bound and cannot return unrelated rows or
-- revisions newer than the token anchor.
select set_config('studioscrubz.controlled_delivery_snapshot', 'on', true);
insert into public.proposals(
  id, proposal_number, division, frequency, result, status, approval_status,
  client_access_token, client_access_token_expires_at, client_delivery_snapshot,
  accepted, expiration_date, revision_group_id, revision_number,
  is_current_revision, superseded_at
) values (
  '50000000-0000-0000-0000-000000000099'::uuid,
  'PROP-LOCAL-UNRELATED',
  'Commercial',
  'One-Time',
  '{}'::jsonb,
  'Sent',
  'Approved',
  repeat('9', 40),
  now() + interval '30 days',
  '{}'::jsonb,
  false,
  current_date + 30,
  '60000000-0000-0000-0000-000000000099'::uuid,
  1,
  true,
  null
);
select set_config('studioscrubz.controlled_delivery_snapshot', '', true);

do $test$
declare
  history jsonb;
begin
  history := public.get_proposal_revision_history_by_token(repeat('3', 40));
  if history::text like '%PROP-LOCAL-UNRELATED%'
    or history::text not like '%PROP-LOCAL-PROTECT-R2%'
  then
    raise exception 'Public revision history escaped its authorized family.';
  end if;
end;
$test$;

reset role;

-- Master Admin Assessment deletion may detach only walkthrough_id, including
-- on superseded R2, while the protection trigger guards every other field.
set local role authenticated;
select public.master_admin_permanently_delete_assessment(
  '40000000-0000-0000-0000-000000000001'::uuid
);

do $test$
begin
  if exists (
    select 1 from public.proposals
    where revision_group_id = '60000000-0000-0000-0000-000000000001'::uuid
      and walkthrough_id is not null
  ) or exists (
    select 1 from public.walkthroughs
    where id = '40000000-0000-0000-0000-000000000001'::uuid
  ) then
    raise exception 'Assessment deletion did not safely detach Proposal history.';
  end if;
end;
$test$;

reset role;

-- Independent current rows exercise current acceptance, decline, and archive
-- mutations without weakening historical protections.
select set_config('studioscrubz.controlled_delivery_snapshot', 'on', true);
insert into public.proposals(
  id, proposal_number, division, frequency, result, status, approval_status,
  client_access_token, client_access_token_expires_at, client_delivery_snapshot,
  accepted, expiration_date, revision_group_id, revision_number,
  is_current_revision, superseded_at
) values
(
  '50000000-0000-0000-0000-000000000010'::uuid,
  'PROP-LOCAL-ACCEPT', 'Commercial', 'One-Time', '{}'::jsonb,
  'Sent', 'Approved', repeat('a', 40), now() + interval '30 days', '{}'::jsonb,
  false, current_date + 30,
  '60000000-0000-0000-0000-000000000010'::uuid, 1, true, null
),
(
  '50000000-0000-0000-0000-000000000011'::uuid,
  'PROP-LOCAL-DECLINE', 'Commercial', 'One-Time', '{}'::jsonb,
  'Sent', 'Approved', repeat('b', 40), now() + interval '30 days', '{}'::jsonb,
  false, current_date + 30,
  '60000000-0000-0000-0000-000000000011'::uuid, 1, true, null
),
(
  '50000000-0000-0000-0000-000000000012'::uuid,
  'PROP-LOCAL-ARCHIVE', 'Commercial', 'One-Time', '{}'::jsonb,
  'Draft', 'Not Submitted', null, null, null,
  false, current_date + 30,
  '60000000-0000-0000-0000-000000000012'::uuid, 1, true, null
);
select set_config('studioscrubz.controlled_delivery_snapshot', '', true);

select public.accept_proposal_by_token(
  repeat('a', 40),
  'Acceptance Test Client',
  true
);
select public.decline_proposal_by_token(repeat('b', 40), 'Decline test');

update public.proposals
set status = 'Archived', archived_at = now()
where id = '50000000-0000-0000-0000-000000000012'::uuid;

do $test$
begin
  if not exists (
    select 1 from public.proposals
    where id = '50000000-0000-0000-0000-000000000010'::uuid
      and status = 'Accepted' and accepted and accepted_at is not null
  ) or not exists (
    select 1 from public.proposals
    where id = '50000000-0000-0000-0000-000000000011'::uuid
      and status = 'Declined' and declined_at is not null
  ) or not exists (
    select 1 from public.proposals
    where id = '50000000-0000-0000-0000-000000000012'::uuid
      and status = 'Archived' and archived_at is not null
  ) then
    raise exception 'A legitimate current lifecycle transition was blocked.';
  end if;

  begin
    update public.proposals
    set notes = 'forbidden after archive'
    where id = '50000000-0000-0000-0000-000000000012'::uuid;
    raise exception 'Expected archived Proposal mutation rejection.';
  exception
    when sqlstate '55000' then null;
  end;
end;
$test$;

rollback;
