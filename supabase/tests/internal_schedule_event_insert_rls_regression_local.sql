-- Transactional regression coverage for the INSERT/RETURNING RLS repair.
-- Run only against a disposable database with all migrations applied.
begin;

insert into auth.users(id, email, role, aud) values
  ('b1000000-0000-0000-0000-000000000001', 'schedule-master-no-employee@example.test', 'authenticated', 'authenticated'),
  ('b1000000-0000-0000-0000-000000000002', 'schedule-unauthorized-tech@example.test', 'authenticated', 'authenticated');

insert into public.employees(
  id, employee_number, first_name, last_name, email, department, employment_status
) values (
  'b2000000-0000-0000-0000-000000000002', 'ISE-RLS-TECH', 'Schedule', 'Technician',
  'schedule-unauthorized-tech@example.test', 'Scrub Technicians', 'Active'
);

insert into public.user_profiles(id, email, display_name, role, is_active, employee_id) values
  ('b1000000-0000-0000-0000-000000000001', 'schedule-master-no-employee@example.test', 'Schedule Master', 'Master Admin', true, null),
  ('b1000000-0000-0000-0000-000000000002', 'schedule-unauthorized-tech@example.test', 'Schedule Technician', 'Scrub Technician', true, 'b2000000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);

do $test$
declare
  created public.internal_schedule_events;
begin
  select * into created
  from public.save_internal_schedule_event(
    p_event_id => null,
    p_title => 'Master Admin RLS regression',
    p_description => 'Verifies employee-less Master Admin event creation.',
    p_category => 'Administrative',
    p_meeting_mode => 'Video Meeting',
    p_starts_at => now() + interval '1 day',
    p_ends_at => now() + interval '1 day 1 hour',
    p_timezone => 'America/Los_Angeles',
    p_visibility => 'Company-wide',
    p_location => null,
    p_prospect_id => null,
    p_client_id => null,
    p_vendor_name => null,
    p_call_contact_name => null,
    p_call_phone_number => null,
    p_call_phone_extension => null,
    p_attendee_employee_ids => '{}'::uuid[]
  );

  if created.organizer_user_id <> 'b1000000-0000-0000-0000-000000000001'
    or created.organizer_employee_id is not null then
    raise exception 'Master Admin organizer identity was not preserved.';
  end if;
end;
$test$;

select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000002', true);

do $test$
begin
  begin
    perform public.save_internal_schedule_event(
      p_event_id => null,
      p_title => 'Unauthorized event',
      p_description => null,
      p_category => 'Other',
      p_meeting_mode => 'Video Meeting',
      p_starts_at => now() + interval '2 days',
      p_ends_at => now() + interval '2 days 1 hour',
      p_timezone => 'America/Los_Angeles',
      p_visibility => 'Company-wide',
      p_location => null,
      p_prospect_id => null,
      p_client_id => null,
      p_vendor_name => null,
      p_call_contact_name => null,
      p_call_phone_number => null,
      p_call_phone_extension => null,
      p_attendee_employee_ids => '{}'::uuid[]
    );
    raise exception 'Unauthorized employee created an internal event.';
  exception
    when insufficient_privilege or check_violation then null;
  end;
end;
$test$;

reset role;
rollback;
