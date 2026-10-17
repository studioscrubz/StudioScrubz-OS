-- Durable, private, per-attendee calendar invitations for internal events.
begin;

alter table public.internal_schedule_events
  add column if not exists calendar_sequence integer not null default 0
    check (calendar_sequence >= 0);

create table public.internal_schedule_event_invitation_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_id uuid not null references public.internal_schedule_events(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  calendar_uid text not null,
  calendar_sequence integer not null check (calendar_sequence >= 0),
  method text not null check (method in ('REQUEST', 'CANCEL')),
  recipient_name text not null,
  recipient_email text,
  event_snapshot jsonb not null check (jsonb_typeof(event_snapshot) = 'object'),
  rsvp_token_hash text check (rsvp_token_hash is null or char_length(rsvp_token_hash) = 64),
  status text not null default 'Pending' check (status in ('Pending', 'Accepted', 'Failed', 'Unavailable')),
  provider text not null default 'resend' check (provider = 'resend'),
  provider_message_id text,
  provider_submission_started_at timestamptz,
  accepted_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, employee_id, calendar_sequence, method),
  constraint internal_event_invitation_delivery_result check (
    (status = 'Pending' and recipient_email is not null and provider_message_id is null and accepted_at is null and failed_at is null and failure_reason is null)
    or (status = 'Accepted' and recipient_email is not null and provider_message_id is not null and accepted_at is not null and failed_at is null and failure_reason is null)
    or (status = 'Failed' and recipient_email is not null and provider_message_id is null and accepted_at is null and failed_at is not null and failure_reason is not null)
    or (status = 'Unavailable' and recipient_email is null and provider_message_id is null and accepted_at is null and failed_at is not null and failure_reason is not null)
  )
);

create index internal_event_invitation_deliveries_event_idx
  on public.internal_schedule_event_invitation_deliveries(event_id, employee_id, created_at desc);
create unique index internal_event_invitation_deliveries_token_idx
  on public.internal_schedule_event_invitation_deliveries(rsvp_token_hash)
  where rsvp_token_hash is not null;

create table public.internal_schedule_event_invitation_provider_submissions (
  delivery_id uuid primary key references public.internal_schedule_event_invitation_deliveries(id) on delete restrict,
  event_key text not null unique,
  provider_message_id text not null unique,
  accepted_at timestamptz not null default now()
);

alter table public.internal_schedule_event_invitation_deliveries enable row level security;
alter table public.internal_schedule_event_invitation_provider_submissions enable row level security;
revoke all on table public.internal_schedule_event_invitation_deliveries from public, anon, authenticated;
revoke all on table public.internal_schedule_event_invitation_provider_submissions from public, anon, authenticated;
grant select, insert, update on table public.internal_schedule_event_invitation_deliveries to service_role;
grant select, insert on table public.internal_schedule_event_invitation_provider_submissions to service_role;

create function private.bump_internal_event_calendar_sequence()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'internal_schedule_events' then
    if new.title is distinct from old.title or new.description is distinct from old.description
      or new.meeting_mode is distinct from old.meeting_mode or new.starts_at is distinct from old.starts_at
      or new.ends_at is distinct from old.ends_at or new.timezone is distinct from old.timezone
      or new.location is distinct from old.location or new.video_link is distinct from old.video_link
      or new.status is distinct from old.status then
      new.calendar_sequence := old.calendar_sequence + 1;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    update public.internal_schedule_events set calendar_sequence = calendar_sequence + 1 where id = old.event_id;
    return old;
  elsif tg_op = 'INSERT' then
    update public.internal_schedule_events set calendar_sequence = calendar_sequence + 1 where id = new.event_id;
    return new;
  end if;
  return new;
end;
$$;

create trigger internal_schedule_events_calendar_sequence
before update on public.internal_schedule_events
for each row execute function private.bump_internal_event_calendar_sequence();
create trigger internal_schedule_event_attendees_calendar_sequence
after insert or delete on public.internal_schedule_event_attendees
for each row execute function private.bump_internal_event_calendar_sequence();

create function private.protect_internal_event_invitation_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.event_key is distinct from old.event_key or new.event_id is distinct from old.event_id
    or new.employee_id is distinct from old.employee_id or new.calendar_uid is distinct from old.calendar_uid
    or new.calendar_sequence is distinct from old.calendar_sequence or new.method is distinct from old.method
    or new.recipient_name is distinct from old.recipient_name or new.recipient_email is distinct from old.recipient_email
    or new.event_snapshot is distinct from old.event_snapshot or new.rsvp_token_hash is distinct from old.rsvp_token_hash
    or new.provider is distinct from old.provider or new.created_at is distinct from old.created_at then
    raise exception 'Internal event invitation identity and evidence are immutable.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger protect_internal_event_invitation_delivery
before update on public.internal_schedule_event_invitation_deliveries
for each row execute function private.protect_internal_event_invitation_delivery();

create function private.protect_internal_event_invitation_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Internal event invitation provider receipts are append-only.';
end;
$$;
create trigger internal_event_invitation_submissions_append_only
before update or delete on public.internal_schedule_event_invitation_provider_submissions
for each row execute function private.protect_internal_event_invitation_submission();

create function public.respond_to_internal_schedule_invitation(p_token text, p_response text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare delivery public.internal_schedule_event_invitation_deliveries;
begin
  if p_token is null or char_length(p_token) < 43 or p_response not in ('Accepted', 'Tentative', 'Declined') then
    raise exception 'The invitation response is invalid.';
  end if;
  select * into delivery from public.internal_schedule_event_invitation_deliveries
  where rsvp_token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and method = 'REQUEST' order by calendar_sequence desc limit 1;
  if not found or delivery.status <> 'Accepted' then raise exception 'This invitation is invalid or unavailable.'; end if;
  if not exists (select 1 from public.internal_schedule_events e where e.id = delivery.event_id and e.calendar_sequence = delivery.calendar_sequence and e.status = 'Scheduled') then
    raise exception 'This invitation has been superseded or canceled.';
  end if;
  update public.internal_schedule_event_attendees attendee
  set invitation_status = p_response
  from public.internal_schedule_events event
  where attendee.event_id = delivery.event_id and attendee.employee_id = delivery.employee_id
    and event.id = attendee.event_id and event.status = 'Scheduled'
    and event.calendar_sequence = delivery.calendar_sequence;
  if not found then raise exception 'This event is canceled or you are no longer an attendee.'; end if;
  return jsonb_build_object('event_id', delivery.event_id, 'response', p_response);
end;
$$;

create function public.get_internal_schedule_invitation_statuses(p_event_id uuid)
returns table(employee_id uuid, delivery_status text, accepted_at timestamptz, failure_reason text)
language sql stable security definer set search_path = '' as $$
  select distinct on (delivery.employee_id) delivery.employee_id, delivery.status,
    delivery.accepted_at, delivery.failure_reason
  from public.internal_schedule_event_invitation_deliveries delivery
  where delivery.event_id = p_event_id
    and private.can_view_internal_schedule_event(p_event_id)
    and private.current_internal_schedule_access_level() = 'Management'
  order by delivery.employee_id, delivery.calendar_sequence desc, delivery.created_at desc;
$$;

revoke all on function public.respond_to_internal_schedule_invitation(text,text) from public, anon, authenticated;
grant execute on function public.respond_to_internal_schedule_invitation(text,text) to anon, authenticated;
revoke all on function public.get_internal_schedule_invitation_statuses(uuid) from public, anon, authenticated;
grant execute on function public.get_internal_schedule_invitation_statuses(uuid) to authenticated;
revoke all on function private.bump_internal_event_calendar_sequence() from public, anon, authenticated;
revoke all on function private.protect_internal_event_invitation_delivery() from public, anon, authenticated;
revoke all on function private.protect_internal_event_invitation_submission() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
