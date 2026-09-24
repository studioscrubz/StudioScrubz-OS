begin;

create table public.job_applications (
  id uuid primary key default gen_random_uuid(),
  opening_identifier text not null default 'lead-generator' check (opening_identifier = 'lead-generator'),
  source_page text not null default '/careers' check (source_page = '/careers'),
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null check (char_length(email) between 3 and 254),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  city text not null check (char_length(city) between 2 and 100),
  preferred_contact_method text not null check (preferred_contact_method in ('Email','Phone','Text')),
  relevant_experience text not null check (char_length(relevant_experience) between 2 and 2000),
  reachable_networks text not null check (char_length(reachable_networks) between 2 and 2000),
  weekly_availability text not null check (char_length(weekly_availability) between 2 and 500),
  fit_reason text not null check (char_length(fit_reason) between 2 and 2000),
  commission_acknowledged boolean not null check (commission_acknowledged),
  contact_consent boolean not null check (contact_consent),
  status text not null default 'New' check (status in ('New','Contacted','Interviewing','Selected','Declined')),
  internal_notes text null check (internal_notes is null or char_length(internal_notes) <= 4000),
  submitted_ip_hash text not null check (char_length(submitted_ip_hash) = 64),
  contact_fingerprint text not null check (char_length(contact_fingerprint) = 64),
  notification_status text not null default 'Prepared' check (notification_status in ('Prepared','Sent','Failed')),
  notification_provider_id text null,
  notification_error text null check (notification_error is null or char_length(notification_error) <= 1000),
  notification_updated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.job_applications(id) on delete restrict,
  event_type text not null check (event_type in ('Submitted','Status Changed','Notes Updated')),
  from_status text null,
  to_status text null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index job_applications_created_idx on public.job_applications(created_at desc);
create index job_applications_status_created_idx on public.job_applications(status, created_at desc);
create index job_applications_ip_rate_idx on public.job_applications(submitted_ip_hash, created_at desc);
create index job_applications_contact_rate_idx on public.job_applications(contact_fingerprint, created_at desc);
create index job_application_events_application_idx on public.job_application_events(application_id, created_at);

alter table public.job_applications enable row level security;
alter table public.job_application_events enable row level security;
revoke all on table public.job_applications, public.job_application_events from public, anon, authenticated;
grant select, insert, update on table public.job_applications to service_role;
grant select, insert on table public.job_application_events to service_role;

create function private.record_job_application_submission()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.job_application_events(application_id,event_type,to_status,details)
  values(new.id,'Submitted','New',jsonb_build_object('sourcePage',new.source_page,'openingIdentifier',new.opening_identifier));
  return new;
end $$;
revoke all on function private.record_job_application_submission() from public,anon,authenticated;
create trigger job_application_submitted_event after insert on public.job_applications
for each row execute function private.record_job_application_submission();

create function public.get_job_applications()
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Job application access denied.' using errcode='42501';
  end if;
  return query select to_jsonb(a)||jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.job_application_events e where e.application_id=a.id),'[]'::jsonb))
  from public.job_applications a order by a.created_at desc;
end $$;

create function public.update_job_application(p_application_id uuid,p_status text,p_internal_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.job_applications; old_status text; old_notes text;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Job application update denied.' using errcode='42501';
  end if;
  if p_status not in ('New','Contacted','Interviewing','Selected','Declined') then raise exception 'Invalid application status.'; end if;
  if char_length(coalesce(p_internal_notes,'')) > 4000 then raise exception 'Internal notes are too long.'; end if;
  select * into a from public.job_applications where id=p_application_id for update;
  if not found then raise exception 'Job application not found.'; end if;
  old_status:=a.status; old_notes:=a.internal_notes;
  update public.job_applications set status=p_status,internal_notes=nullif(btrim(coalesce(p_internal_notes,'')),''),updated_at=now() where id=a.id returning * into a;
  if old_status is distinct from a.status then
    insert into public.job_application_events(application_id,event_type,from_status,to_status,actor_user_id)
    values(a.id,'Status Changed',old_status,a.status,auth.uid());
  end if;
  if old_notes is distinct from a.internal_notes then
    insert into public.job_application_events(application_id,event_type,from_status,to_status,actor_user_id)
    values(a.id,'Notes Updated',a.status,a.status,auth.uid());
  end if;
  return to_jsonb(a);
end $$;

revoke all on function public.get_job_applications(),public.update_job_application(uuid,text,text) from public,anon,authenticated;
grant execute on function public.get_job_applications(),public.update_job_application(uuid,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
