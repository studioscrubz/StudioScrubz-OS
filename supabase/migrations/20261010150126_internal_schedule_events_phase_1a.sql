begin;

create table public.internal_schedule_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text,
  category text not null check (category in ('Vendor', 'Sales', 'Administrative', 'Other')),
  meeting_mode text not null check (meeting_mode in ('Phone', 'Video', 'In Person')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null check (char_length(btrim(timezone)) between 1 and 100),
  organizer_user_id uuid not null references public.user_profiles(id) on delete restrict,
  organizer_employee_id uuid not null references public.employees(id) on delete restrict,
  visibility text not null check (visibility in ('Management Only', 'Sales Visible')),
  location text,
  video_link text,
  prospect_id uuid references public.prospects(id) on delete set null,
  vendor_name text,
  status text not null default 'Scheduled' check (status in ('Scheduled', 'Canceled')),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  check (ends_at > starts_at),
  check (location is null or char_length(btrim(location)) between 1 and 500),
  check (video_link is null or char_length(btrim(video_link)) between 1 and 2000),
  check (vendor_name is null or char_length(btrim(vendor_name)) between 1 and 300)
);

create table public.internal_schedule_event_attendees (
  event_id uuid not null references public.internal_schedule_events(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  invitation_status text not null default 'Invited'
    check (invitation_status in ('Invited', 'Accepted', 'Declined', 'Tentative')),
  invited_at timestamptz not null default transaction_timestamp(),
  responded_at timestamptz,
  primary key (event_id, employee_id),
  check (
    (invitation_status = 'Invited' and responded_at is null)
    or (invitation_status <> 'Invited' and responded_at is not null)
  )
);

create index internal_schedule_events_time_idx
  on public.internal_schedule_events(starts_at, ends_at)
  where status = 'Scheduled';
create index internal_schedule_events_organizer_idx
  on public.internal_schedule_events(organizer_user_id, starts_at desc);
create index internal_schedule_events_prospect_idx
  on public.internal_schedule_events(prospect_id)
  where prospect_id is not null;
create index internal_schedule_event_attendees_employee_idx
  on public.internal_schedule_event_attendees(employee_id, event_id);

alter table public.internal_schedule_events enable row level security;
alter table public.internal_schedule_event_attendees enable row level security;

revoke all on table public.internal_schedule_events
from public, anon, authenticated;
revoke all on table public.internal_schedule_event_attendees
from public, anon, authenticated;

-- Authorization deliberately combines the primary profile role with the
-- existing additive Sales capability. Schedule-page access alone is never
-- sufficient to expose an internal event.
create function private.internal_schedule_access_level(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when profile.role in ('Master Admin', 'Administrator') then 'Management'
    when profile.role in ('Sales', 'Lead Representative')
      or private.is_eligible_lead_representative_employee(profile.employee_id)
      then 'Sales'
    else 'None'
  end
  from public.user_profiles profile
  where p_user_id is not null
    and profile.id = p_user_id
    and profile.is_active
$$;

revoke all on function private.internal_schedule_access_level(uuid)
from public, anon, authenticated, service_role;

create function private.current_internal_schedule_access_level()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.internal_schedule_access_level(auth.uid()),
    'None'
  )
$$;

revoke all on function private.current_internal_schedule_access_level()
from public, anon, authenticated, service_role;

create function private.internal_schedule_employee_is_authorized(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles profile
    where profile.employee_id = p_employee_id
      and profile.is_active
      and private.internal_schedule_access_level(profile.id) in ('Management', 'Sales')
  )
$$;

revoke all on function private.internal_schedule_employee_is_authorized(uuid)
from public, anon, authenticated, service_role;

create function private.internal_schedule_organizer_is_valid(
  p_user_id uuid,
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles profile
    join public.employees employee on employee.id = profile.employee_id
    where profile.id = p_user_id
      and profile.employee_id = p_employee_id
      and profile.is_active
      and employee.employment_status = 'Active'
      and employee.archived_at is null
      and private.internal_schedule_access_level(profile.id) in ('Management', 'Sales')
  )
$$;

revoke all on function private.internal_schedule_organizer_is_valid(uuid, uuid)
from public, anon, authenticated, service_role;

create function private.current_user_is_internal_event_attendee(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.internal_schedule_access_level(auth.uid()) in ('Management', 'Sales')
    and exists (
      select 1
      from public.internal_schedule_event_attendees attendee
      join public.user_profiles profile
        on profile.employee_id = attendee.employee_id
       and profile.id = auth.uid()
       and profile.is_active
      where attendee.event_id = p_event_id
    )
$$;

revoke all on function private.current_user_is_internal_event_attendee(uuid)
from public, anon, authenticated, service_role;

create function private.can_view_internal_schedule_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.internal_schedule_access_level(auth.uid())
    when 'Management' then true
    when 'Sales' then exists (
      select 1
      from public.internal_schedule_events event
      where event.id = p_event_id
        and (
          event.visibility = 'Sales Visible'
          or event.organizer_user_id = auth.uid()
          or private.current_user_is_internal_event_attendee(event.id)
        )
    )
    else false
  end
$$;

revoke all on function private.can_view_internal_schedule_event(uuid)
from public, anon, authenticated, service_role;

grant execute on function private.current_internal_schedule_access_level(),
  private.can_view_internal_schedule_event(uuid)
to authenticated;

create function private.prepare_internal_schedule_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone_row
    where timezone_row.name = new.timezone
  ) then
    raise exception 'Select a valid IANA timezone.' using errcode = '22023';
  end if;

  if not private.internal_schedule_organizer_is_valid(
    new.organizer_user_id,
    new.organizer_employee_id
  ) then
    raise exception 'Select an active authorized internal-event organizer.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := transaction_timestamp();
  end if;
  new.updated_at := transaction_timestamp();
  return new;
end;
$$;

revoke all on function private.prepare_internal_schedule_event()
from public, anon, authenticated, service_role;

create trigger internal_schedule_events_prepare
before insert or update on public.internal_schedule_events
for each row execute function private.prepare_internal_schedule_event();

create function private.prepare_internal_schedule_event_attendee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.internal_schedule_employee_is_authorized(new.employee_id) then
    raise exception 'Internal-event attendees must have an authorized active role.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.invitation_status := 'Invited';
    new.invited_at := transaction_timestamp();
    new.responded_at := null;
  elsif new.invitation_status is distinct from old.invitation_status then
    new.responded_at := case
      when new.invitation_status = 'Invited' then null
      else transaction_timestamp()
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.prepare_internal_schedule_event_attendee()
from public, anon, authenticated, service_role;

create trigger internal_schedule_event_attendees_prepare
before insert or update on public.internal_schedule_event_attendees
for each row execute function private.prepare_internal_schedule_event_attendee();

create policy "Authorized users read internal events"
on public.internal_schedule_events
for select to authenticated
using (private.can_view_internal_schedule_event(id));

create policy "Management creates internal events"
on public.internal_schedule_events
for insert to authenticated
with check (private.current_internal_schedule_access_level() = 'Management');

create policy "Sales creates own visible events"
on public.internal_schedule_events
for insert to authenticated
with check (
  private.current_internal_schedule_access_level() = 'Sales'
  and organizer_user_id = (select auth.uid())
  and organizer_employee_id = public.current_employee_id()
  and visibility = 'Sales Visible'
);

create policy "Management updates internal events"
on public.internal_schedule_events
for update to authenticated
using (private.current_internal_schedule_access_level() = 'Management')
with check (private.current_internal_schedule_access_level() = 'Management');

create policy "Sales updates own visible events"
on public.internal_schedule_events
for update to authenticated
using (
  private.current_internal_schedule_access_level() = 'Sales'
  and organizer_user_id = (select auth.uid())
  and visibility = 'Sales Visible'
)
with check (
  private.current_internal_schedule_access_level() = 'Sales'
  and organizer_user_id = (select auth.uid())
  and organizer_employee_id = public.current_employee_id()
  and visibility = 'Sales Visible'
);

create policy "Management deletes internal events"
on public.internal_schedule_events
for delete to authenticated
using (private.current_internal_schedule_access_level() = 'Management');

create policy "Sales deletes own visible events"
on public.internal_schedule_events
for delete to authenticated
using (
  private.current_internal_schedule_access_level() = 'Sales'
  and organizer_user_id = (select auth.uid())
  and visibility = 'Sales Visible'
);

create policy "Authorized users read event attendees"
on public.internal_schedule_event_attendees
for select to authenticated
using (private.can_view_internal_schedule_event(event_id));

create policy "Management invites event attendees"
on public.internal_schedule_event_attendees
for insert to authenticated
with check (private.current_internal_schedule_access_level() = 'Management');

create policy "Sales organizers invite event attendees"
on public.internal_schedule_event_attendees
for insert to authenticated
with check (
  private.current_internal_schedule_access_level() = 'Sales'
  and exists (
    select 1
    from public.internal_schedule_events event
    where event.id = event_id
      and event.organizer_user_id = (select auth.uid())
      and event.visibility = 'Sales Visible'
  )
);

create policy "Invitees update only their RSVP"
on public.internal_schedule_event_attendees
for update to authenticated
using (
  private.current_internal_schedule_access_level() in ('Management', 'Sales')
  and employee_id = public.current_employee_id()
)
with check (
  private.current_internal_schedule_access_level() in ('Management', 'Sales')
  and employee_id = public.current_employee_id()
);

create policy "Management removes event attendees"
on public.internal_schedule_event_attendees
for delete to authenticated
using (private.current_internal_schedule_access_level() = 'Management');

create policy "Sales organizers remove event attendees"
on public.internal_schedule_event_attendees
for delete to authenticated
using (
  private.current_internal_schedule_access_level() = 'Sales'
  and exists (
    select 1
    from public.internal_schedule_events event
    where event.id = event_id
      and event.organizer_user_id = (select auth.uid())
      and event.visibility = 'Sales Visible'
  )
);

grant select, insert, update, delete on table public.internal_schedule_events
to authenticated;
grant select, insert, delete on table public.internal_schedule_event_attendees
to authenticated;
grant update (invitation_status) on table public.internal_schedule_event_attendees
to authenticated;

notify pgrst, 'reload schema';

commit;
