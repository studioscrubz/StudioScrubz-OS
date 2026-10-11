-- Disposable RLS regression coverage for internal Schedule Events Phase 1A.
-- Run against a local database after applying the migration; all fixtures roll back.

begin;

insert into auth.users(id, email, role, aud) values
  ('a1000000-0000-0000-0000-000000000001', 'internal-admin@example.test', 'authenticated', 'authenticated'),
  ('a1000000-0000-0000-0000-000000000002', 'internal-sales@example.test', 'authenticated', 'authenticated'),
  ('a1000000-0000-0000-0000-000000000003', 'internal-additive@example.test', 'authenticated', 'authenticated'),
  ('a1000000-0000-0000-0000-000000000004', 'internal-tech@example.test', 'authenticated', 'authenticated'),
  ('a1000000-0000-0000-0000-000000000005', 'internal-master@example.test', 'authenticated', 'authenticated'),
  ('a1000000-0000-0000-0000-000000000006', 'internal-lead@example.test', 'authenticated', 'authenticated'),
  ('a1000000-0000-0000-0000-000000000007', 'internal-master-no-employee@example.test', 'authenticated', 'authenticated');

insert into public.employees(
  id, employee_number, first_name, last_name, email, department, employment_status
) values
  ('a2000000-0000-0000-0000-000000000001', 'ISE-ADMIN', 'Internal', 'Admin', 'internal-admin@example.test', 'Administration', 'Active'),
  ('a2000000-0000-0000-0000-000000000002', 'ISE-SALES', 'Internal', 'Sales', 'internal-sales@example.test', 'Lead Representative', 'Active'),
  ('a2000000-0000-0000-0000-000000000003', 'ISE-ADDITIVE', 'Internal', 'Additive', 'internal-additive@example.test', 'Scrub Technicians', 'Active'),
  ('a2000000-0000-0000-0000-000000000004', 'ISE-TECH', 'Internal', 'Tech', 'internal-tech@example.test', 'Scrub Technicians', 'Active'),
  ('a2000000-0000-0000-0000-000000000005', 'ISE-MASTER', 'Internal', 'Master', 'internal-master@example.test', 'Scrub Technicians', 'Active'),
  ('a2000000-0000-0000-0000-000000000006', 'ISE-LEAD', 'Internal', 'Lead', 'internal-lead@example.test', 'Lead Representative', 'Active');

insert into public.user_profiles(id, email, display_name, role, is_active, employee_id) values
  ('a1000000-0000-0000-0000-000000000001', 'internal-admin@example.test', 'Internal Admin', 'Administrator', true, 'a2000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', 'internal-sales@example.test', 'Internal Sales', 'Sales', true, 'a2000000-0000-0000-0000-000000000002'),
  ('a1000000-0000-0000-0000-000000000003', 'internal-additive@example.test', 'Internal Additive', 'Master Admin', true, 'a2000000-0000-0000-0000-000000000003'),
  ('a1000000-0000-0000-0000-000000000004', 'internal-tech@example.test', 'Internal Tech', 'Scrub Technician', true, 'a2000000-0000-0000-0000-000000000004'),
  ('a1000000-0000-0000-0000-000000000005', 'internal-master@example.test', 'Internal Master', 'Master Admin', true, 'a2000000-0000-0000-0000-000000000005'),
  ('a1000000-0000-0000-0000-000000000006', 'internal-lead@example.test', 'Internal Lead', 'Lead Representative', true, 'a2000000-0000-0000-0000-000000000006'),
  ('a1000000-0000-0000-0000-000000000007', 'internal-master-no-employee@example.test', 'Internal Master No Employee', 'Master Admin', true, null);

insert into public.employee_operational_roles(employee_id, operational_role)
values ('a2000000-0000-0000-0000-000000000003', 'Sales Representative');

insert into public.employee_operational_roles(employee_id, operational_role)
values ('a2000000-0000-0000-0000-000000000005', 'Scrub Technician');

-- Exercise additive Sales with a non-management primary role.
update public.user_profiles
set role = 'Scrub Technician'
where id = 'a1000000-0000-0000-0000-000000000003';

set local role authenticated;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);

do $test$
begin
  if public.get_current_internal_schedule_access_level() <> 'Management' then
    raise exception 'Administrator internal-event authorization failed.';
  end if;
end;
$test$;

insert into public.internal_schedule_events(
  id, title, description, category, meeting_mode, starts_at, ends_at,
  timezone, organizer_user_id, organizer_employee_id, visibility, video_link
) values
  ('a3000000-0000-0000-0000-000000000001', 'Management private', 'private management description', 'Administrative', 'Video', now() + interval '1 day', now() + interval '2 hours 1 day', 'America/Los_Angeles', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Management Only', 'https://example.test/private'),
  ('a3000000-0000-0000-0000-000000000002', 'Sales visible', 'sales description', 'Sales', 'Phone', now() + interval '2 days', now() + interval '2 days 1 hour', 'America/Los_Angeles', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Sales Visible', null),
  ('a3000000-0000-0000-0000-000000000005', 'Management uninvited', 'never exposed to Sales', 'Administrative', 'In Person', now() + interval '5 days', now() + interval '5 days 1 hour', 'America/Los_Angeles', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Management Only', null);

insert into public.internal_schedule_event_attendees(event_id, employee_id)
values ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002');

do $test$
begin
  if (select count(*) from public.internal_schedule_events) <> 3 then
    raise exception 'Administrator must see every internal event.';
  end if;
end;
$test$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);

do $test$
begin
  if public.get_current_internal_schedule_access_level() <> 'Sales' then
    raise exception 'Sales internal-event authorization failed.';
  end if;
end;
$test$;

do $test$
begin
  if (select count(*) from public.internal_schedule_events) <> 2 then
    raise exception 'Invited Sales user must see the private invitation and Sales-visible event.';
  end if;
  if not exists (
    select 1 from public.internal_schedule_events
    where id = 'a3000000-0000-0000-0000-000000000001'
      and description = 'private management description'
      and video_link = 'https://example.test/private'
  ) then
    raise exception 'Authorized invitee did not receive the complete event row.';
  end if;

  update public.internal_schedule_events
  set title = 'Forbidden edit'
  where id = 'a3000000-0000-0000-0000-000000000005';
  if found then
    raise exception 'Sales user updated an uninvited Management-only event.';
  end if;
end;
$test$;

insert into public.internal_schedule_events(
  id, title, category, meeting_mode, starts_at, ends_at, timezone,
  organizer_user_id, organizer_employee_id, visibility
) values (
  'a3000000-0000-0000-0000-000000000003', 'Sales owned', 'Other', 'In Person',
  now() + interval '3 days', now() + interval '3 days 1 hour', 'America/Los_Angeles',
  'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 'Sales Visible'
);

do $test$
begin
  begin
    insert into public.internal_schedule_events(
      title, category, meeting_mode, starts_at, ends_at, timezone,
      organizer_user_id, organizer_employee_id, visibility
    ) values (
      'Forbidden private Sales event', 'Sales', 'Phone', now(), now() + interval '1 hour', 'UTC',
      'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 'Management Only'
    );
    raise exception 'Sales user created a Management-only event.';
  exception when insufficient_privilege or check_violation then null;
  end;
end;
$test$;

update public.internal_schedule_event_attendees
set invitation_status = 'Accepted'
where event_id = 'a3000000-0000-0000-0000-000000000001'
  and employee_id = 'a2000000-0000-0000-0000-000000000002';

do $test$
begin
  begin
    update public.internal_schedule_event_attendees
    set employee_id = 'a2000000-0000-0000-0000-000000000003'
    where event_id = 'a3000000-0000-0000-0000-000000000001'
      and employee_id = 'a2000000-0000-0000-0000-000000000002';
    raise exception 'Invitee changed attendee identity.';
  exception when insufficient_privilege then null;
  end;
end;
$test$;

do $test$
begin
  if not exists (
    select 1 from public.internal_schedule_event_attendees
    where event_id = 'a3000000-0000-0000-0000-000000000001'
      and employee_id = 'a2000000-0000-0000-0000-000000000002'
      and invitation_status = 'Accepted'
      and responded_at is not null
  ) then
    raise exception 'Invitee RSVP update failed.';
  end if;
end;
$test$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);

do $test$
begin
  if (select count(*) from public.internal_schedule_events) <> 2 then
    raise exception 'Additive Sales user must see Sales-visible events.';
  end if;
end;
$test$;

insert into public.internal_schedule_events(
  id, title, category, meeting_mode, starts_at, ends_at, timezone,
  organizer_user_id, organizer_employee_id, visibility
) values (
  'a3000000-0000-0000-0000-000000000004', 'Additive Sales owned', 'Sales', 'Video',
  now() + interval '4 days', now() + interval '4 days 1 hour', 'America/Los_Angeles',
  'a1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000003', 'Sales Visible'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000004', true);

do $test$
begin
  if public.get_current_internal_schedule_access_level() <> 'None' then
    raise exception 'Ordinary technician received internal-event authorization.';
  end if;
  if exists (select 1 from public.internal_schedule_events) then
    raise exception 'Technician read internal event data.';
  end if;
  if exists (select 1 from public.internal_schedule_event_attendees) then
    raise exception 'Technician read internal attendee data.';
  end if;

  begin
    insert into public.internal_schedule_event_attendees(event_id, employee_id)
    values ('a3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000004');
    raise exception 'Technician self-invited to an internal event.';
  exception when insufficient_privilege or check_violation then null;
  end;
end;
$test$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000005', true);

do $test$
begin
  if public.get_current_internal_schedule_access_level() <> 'Management' then
    raise exception 'Master Admin with Scrub Technician operational role was not authorized.';
  end if;
end;
$test$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000006', true);

do $test$
begin
  if public.get_current_internal_schedule_access_level() <> 'Sales' then
    raise exception 'Lead Representative internal-event authorization failed.';
  end if;
end;
$test$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000007', true);

do $test$
begin
  if public.get_current_internal_schedule_access_level() <> 'Management' then
    raise exception 'Employee-less Master Admin was not authorized.';
  end if;
end;
$test$;

insert into public.internal_schedule_events(
  id, title, category, meeting_mode, starts_at, ends_at, timezone,
  organizer_user_id, organizer_employee_id, visibility
) values (
  'a3000000-0000-0000-0000-000000000007', 'Master Admin user organized',
  'Administrative', 'Video', now() + interval '7 days',
  now() + interval '7 days 1 hour', 'America/Los_Angeles',
  'a1000000-0000-0000-0000-000000000007', null, 'Management Only'
);

update public.internal_schedule_events
set title = 'Master Admin user organized updated'
where id = 'a3000000-0000-0000-0000-000000000007';

reset role;
rollback;
