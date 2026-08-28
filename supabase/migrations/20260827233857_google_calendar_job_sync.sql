-- StudioScrubz OS: server-owned Google Calendar connection and durable Job sync queue.
begin;

create table public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  connected_account_email text,
  calendar_id text,
  calendar_name text,
  encrypted_refresh_token text,
  auto_create_events boolean not null default false,
  send_tech_invites boolean not null default true,
  sync_job_changes boolean not null default true,
  cancel_event_on_job_cancel boolean not null default true,
  default_duration_minutes integer not null default 120 check (default_duration_minutes between 15 and 1440),
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_connection_complete check (
    (encrypted_refresh_token is null and calendar_id is null)
    or (encrypted_refresh_token is not null and nullif(btrim(calendar_id), '') is not null)
  )
);

create unique index google_calendar_single_connection_idx
  on public.google_calendar_connections ((true));

create table public.job_calendar_syncs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete restrict,
  connection_id uuid references public.google_calendar_connections(id) on delete set null,
  calendar_id text,
  event_id text,
  event_html_link text,
  sync_status text not null default 'Pending' check (sync_status in ('Pending','Synced','Warning','Failed','Cancelled','Disconnected','Unscheduled')),
  payload_hash text,
  attendee_warnings text[] not null default '{}',
  last_attempted_at timestamptz,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index job_calendar_syncs_status_idx on public.job_calendar_syncs(sync_status, updated_at);
create unique index job_calendar_syncs_remote_event_idx
  on public.job_calendar_syncs(calendar_id, event_id) where event_id is not null;

alter table public.google_calendar_connections enable row level security;
alter table public.job_calendar_syncs enable row level security;
revoke all on public.google_calendar_connections from public, anon, authenticated;
revoke all on public.job_calendar_syncs from public, anon, authenticated;
grant select on public.job_calendar_syncs to authenticated;

create policy "Authorized Job calendar status read"
on public.job_calendar_syncs for select to authenticated
using (public.has_any_role(array['Master Admin','Administrator','Manager']));

create or replace function public.queue_job_calendar_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare connection_row public.google_calendar_connections;
begin
  select * into connection_row from public.google_calendar_connections limit 1;
  if not found or connection_row.encrypted_refresh_token is null then return new; end if;
  if tg_op = 'INSERT' and not connection_row.auto_create_events then return new; end if;
  if tg_op = 'UPDATE' and not connection_row.sync_job_changes
     and not (new.status = 'Cancelled' and old.status is distinct from new.status and connection_row.cancel_event_on_job_cancel)
  then return new; end if;
  insert into public.job_calendar_syncs(job_id, connection_id, sync_status, last_sync_error)
  values (new.id, connection_row.id,
    case when new.scheduled_date is null or new.start_time is null then 'Unscheduled' else 'Pending' end, null)
  on conflict (job_id) do update set connection_id=excluded.connection_id,
    sync_status=excluded.sync_status, last_sync_error=null, updated_at=now();
  return new;
end; $$;

revoke all on function public.queue_job_calendar_sync() from public, anon, authenticated;
create trigger jobs_queue_google_calendar_sync
after insert or update of scheduled_date,start_time,estimated_duration,service_name,property_id,assigned_crew_id,status
on public.jobs for each row execute function public.queue_job_calendar_sync();

notify pgrst, 'reload schema';
commit;
