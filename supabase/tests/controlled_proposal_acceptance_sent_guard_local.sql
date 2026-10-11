\set ON_ERROR_STOP on

begin;

set local session_replication_role = replica;

insert into public.proposals(
  id, revision_group_id, proposal_number, division, frequency, result, photos,
  status, approval_status, accepted, expiration_date, is_current_revision,
  sent_at, client_access_token, client_access_token_expires_at,
  client_delivery_snapshot
) values
  (
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'TEST-CONTROLLED-ACCEPTANCE', 'Residential', 'One-Time',
    '{"serviceName":"Standard Cleaning"}'::jsonb, '[]'::jsonb,
    'Sent', 'Approved', false, current_date + 30, true, now(),
    repeat('a', 64), now() + interval '30 days',
    '{"service_name":"standard cleaning"}'::jsonb
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222',
    'TEST-SUPERSEDED-ACCEPTANCE', 'Residential', 'One-Time',
    '{"serviceName":"Standard Cleaning"}'::jsonb, '[]'::jsonb,
    'Sent', 'Approved', false, current_date + 30, false, now(),
    repeat('b', 64), now() + interval '30 days',
    '{"service_name":"standard cleaning"}'::jsonb
  );

set local session_replication_role = origin;

select public.accept_proposal_by_token(repeat('a', 64), 'Test Client', true);
select public.accept_proposal_by_token(repeat('a', 64), 'Test Client', true);

do $$
declare
  proposal_row public.proposals;
  acceptance_events integer;
begin
  select * into strict proposal_row
  from public.proposals
  where proposal_number = 'TEST-CONTROLLED-ACCEPTANCE';

  if proposal_row.status <> 'Accepted' or proposal_row.accepted is not true then
    raise exception 'Sent/current Proposal acceptance did not complete.';
  end if;

  select count(*) into acceptance_events
  from public.proposal_history
  where proposal_id = proposal_row.id and event_type = 'Accepted';

  if acceptance_events <> 1 then
    raise exception 'Repeat acceptance created % acceptance history rows.', acceptance_events;
  end if;
end;
$$;

do $$
begin
  perform set_config('studioscrubz.controlled_proposal_acceptance', '', true);
  begin
    perform public.accept_proposal_by_token(repeat('b', 64), 'Test Client', true);
    raise exception 'Superseded Proposal acceptance unexpectedly succeeded.';
  exception
    when others then
      if sqlerrm not like '%revised and can no longer be accepted%' then
        raise;
      end if;
  end;
end;
$$;

do $$
begin
  begin
    update public.proposals
    set result = result || '{"tampered":true}'::jsonb
    where proposal_number = 'TEST-CONTROLLED-ACCEPTANCE';
    raise exception 'Sent Proposal commercial-content modification unexpectedly succeeded.';
  exception
    when others then
      if sqlerrm not like '%Sent Proposal revisions are immutable%' then
        raise;
      end if;
  end;
end;
$$;

rollback;
