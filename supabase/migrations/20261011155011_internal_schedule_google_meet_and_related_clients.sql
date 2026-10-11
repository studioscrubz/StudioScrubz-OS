begin;

alter table public.internal_schedule_events
  add column client_id uuid references public.clients(id) on delete set null,
  add column call_contact_name text,
  add column call_phone_number text,
  add column call_phone_extension text;

alter table public.internal_schedule_events
  drop constraint internal_schedule_events_meeting_mode_check,
  add constraint internal_schedule_events_meeting_mode_check check (
    meeting_mode in ('Phone', 'Video', 'In Person', 'Video Meeting', 'Phone Call')
  ),
  add constraint internal_schedule_events_mode_details_check check (
    (meeting_mode <> 'In Person' or nullif(btrim(location), '') is not null)
    and (
      meeting_mode <> 'Phone Call'
      or (
        nullif(btrim(call_contact_name), '') is not null
        and nullif(btrim(call_phone_number), '') is not null
      )
    )
  ),
  add constraint internal_schedule_events_call_contact_name_check check (
    call_contact_name is null or char_length(btrim(call_contact_name)) between 1 and 300
  ),
  add constraint internal_schedule_events_call_phone_number_check check (
    call_phone_number is null or char_length(btrim(call_phone_number)) between 1 and 50
  ),
  add constraint internal_schedule_events_call_phone_extension_check check (
    call_phone_extension is null or char_length(btrim(call_phone_extension)) between 1 and 20
  );

create index internal_schedule_events_client_idx
  on public.internal_schedule_events(client_id)
  where client_id is not null;

create table public.internal_schedule_event_google_syncs (
  event_id uuid primary key references public.internal_schedule_events(id) on delete cascade,
  connection_id uuid references public.google_calendar_connections(id) on delete set null,
  calendar_id text,
  google_event_id text,
  google_meet_url text,
  sync_status text not null default 'Pending'
    check (sync_status in ('Pending', 'Synced', 'Failed', 'Canceled', 'Not Required')),
  last_sync_error text,
  last_attempted_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  check (calendar_id is null or char_length(calendar_id) between 1 and 1000),
  check (google_event_id is null or char_length(google_event_id) between 1 and 1024),
  check (google_meet_url is null or char_length(google_meet_url) between 1 and 2000)
);

alter table public.internal_schedule_event_google_syncs enable row level security;
revoke all on table public.internal_schedule_event_google_syncs
from public, anon, authenticated, service_role;
grant select on table public.internal_schedule_event_google_syncs to authenticated;
grant select, insert, update, delete on table public.internal_schedule_event_google_syncs to service_role;

create policy "Authorized users read internal event Google sync"
on public.internal_schedule_event_google_syncs
for select to authenticated
using (private.can_view_internal_schedule_event(event_id));

create function public.save_internal_schedule_event(
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
begin
  select * into actor_profile
  from public.user_profiles
  where id = auth.uid();

  if not found or not actor_profile.is_active then
    raise exception 'An active authenticated account is required.' using errcode = '42501';
  end if;

  if p_event_id is null then
    insert into public.internal_schedule_events(
      title, description, category, meeting_mode, starts_at, ends_at, timezone,
      organizer_user_id, organizer_employee_id, visibility, location,
      prospect_id, client_id, vendor_name, call_contact_name,
      call_phone_number, call_phone_extension
    ) values (
      p_title, p_description, p_category, p_meeting_mode, p_starts_at, p_ends_at,
      p_timezone, actor_profile.id, actor_profile.employee_id, p_visibility,
      p_location, p_prospect_id, p_client_id, p_vendor_name,
      p_call_contact_name, p_call_phone_number, p_call_phone_extension
    ) returning * into saved;
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
