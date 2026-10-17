-- Avoid evaluating the SELECT policy against a row that is still invisible to
-- the stable visibility helper's statement snapshot during INSERT RETURNING.
-- RLS remains authoritative: the INSERT is still security invoker and the
-- newly inserted event is selected in a separate statement.
begin;

create or replace function public.save_internal_schedule_event(
  p_event_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_meeting_mode text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_visibility text,
  p_location text,
  p_prospect_id uuid,
  p_client_id uuid,
  p_vendor_name text,
  p_call_contact_name text,
  p_call_phone_number text,
  p_call_phone_extension text,
  p_attendee_employee_ids uuid[]
)
returns public.internal_schedule_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved public.internal_schedule_events;
  actor_profile public.user_profiles;
  new_event_id uuid;
begin
  select * into actor_profile
  from public.user_profiles
  where id = auth.uid();

  if not found or not actor_profile.is_active then
    raise exception 'An active authenticated account is required.' using errcode = '42501';
  end if;

  if p_event_id is null then
    new_event_id := extensions.gen_random_uuid();

    insert into public.internal_schedule_events(
      id, title, description, category, meeting_mode, starts_at, ends_at, timezone,
      organizer_user_id, organizer_employee_id, visibility, location,
      prospect_id, client_id, vendor_name, call_contact_name,
      call_phone_number, call_phone_extension
    ) values (
      new_event_id, p_title, p_description, p_category, p_meeting_mode,
      p_starts_at, p_ends_at, p_timezone, actor_profile.id,
      actor_profile.employee_id, p_visibility, p_location, p_prospect_id,
      p_client_id, p_vendor_name, p_call_contact_name, p_call_phone_number,
      p_call_phone_extension
    );

    select * into saved
    from public.internal_schedule_events
    where id = new_event_id;

    if not found then
      raise exception 'The new internal event is not visible to its organizer.' using errcode = '42501';
    end if;
  else
    update public.internal_schedule_events
    set title = p_title,
        description = p_description,
        category = p_category,
        meeting_mode = p_meeting_mode,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        timezone = p_timezone,
        visibility = p_visibility,
        location = p_location,
        prospect_id = p_prospect_id,
        client_id = p_client_id,
        vendor_name = p_vendor_name,
        call_contact_name = p_call_contact_name,
        call_phone_number = p_call_phone_number,
        call_phone_extension = p_call_phone_extension
    where id = p_event_id
      and status = 'Scheduled'
    returning * into saved;

    if not found then
      raise exception 'The internal event is unavailable for editing.' using errcode = '42501';
    end if;
  end if;

  delete from public.internal_schedule_event_attendees
  where event_id = saved.id
    and not (employee_id = any(coalesce(p_attendee_employee_ids, '{}'::uuid[])));

  insert into public.internal_schedule_event_attendees(event_id, employee_id)
  select saved.id, employee_id
  from unnest(coalesce(p_attendee_employee_ids, '{}'::uuid[])) employee_id
  on conflict (event_id, employee_id) do nothing;

  return saved;
end;
$$;

revoke all on function public.save_internal_schedule_event(
  uuid, text, text, text, text, timestamptz, timestamptz, text, text, text,
  uuid, uuid, text, text, text, text, uuid[]
) from public, anon, authenticated, service_role;
grant execute on function public.save_internal_schedule_event(
  uuid, text, text, text, text, timestamptz, timestamptz, text, text, text,
  uuid, uuid, text, text, text, text, uuid[]
) to authenticated;

notify pgrst, 'reload schema';

commit;
