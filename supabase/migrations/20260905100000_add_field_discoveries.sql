begin;

create table public.field_discoveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  scope_snapshot_id uuid references public.scope_snapshots(id),
  discovered_by uuid references public.user_profiles(id),
  area text,
  description text not null,
  estimated_extra_minutes integer,
  estimated_extra_amount numeric,
  status text not null default 'Open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_discoveries_status_check check (status in ('Open','Reviewed','Converted to Change Request','Dismissed')),
  constraint field_discoveries_minutes_check check (estimated_extra_minutes is null or estimated_extra_minutes >= 0)
);

create index field_discoveries_job_created_idx on public.field_discoveries(job_id, created_at desc);

create table public.field_discovery_media (
  id uuid primary key default gen_random_uuid(),
  field_discovery_id uuid not null references public.field_discoveries(id) on delete restrict,
  storage_path text not null,
  media_type text,
  created_at timestamptz not null default now(),
  constraint field_discovery_media_storage_path_key unique (storage_path)
);

create index field_discovery_media_discovery_idx on public.field_discovery_media(field_discovery_id, created_at);

create or replace function private.set_field_discovery_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
revoke all on function private.set_field_discovery_updated_at() from public, anon, authenticated;
create trigger field_discoveries_set_updated_at before update on public.field_discoveries
for each row execute function private.set_field_discovery_updated_at();

alter table public.field_discoveries enable row level security;
alter table public.field_discovery_media enable row level security;
revoke all on table public.field_discoveries from public, anon, authenticated;
revoke all on table public.field_discovery_media from public, anon, authenticated;
grant select on table public.field_discoveries to authenticated;
grant select on table public.field_discovery_media to authenticated;
grant select on table public.field_discoveries to service_role;
grant select on table public.field_discovery_media to service_role;

create policy "Master Admin reads full Field Discoveries"
on public.field_discoveries for select to authenticated using (public.is_master_admin());
create policy "Active users read Field Discovery media"
on public.field_discovery_media for select to authenticated
using (public.has_any_role(array['Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician']));

create view public.field_discoveries_operational
with (security_barrier = true)
as select id, job_id, scope_snapshot_id, discovered_by, area, description,
  estimated_extra_minutes, status, created_at, updated_at
from public.field_discoveries
where public.has_any_role(array['Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician']);
revoke all on table public.field_discoveries_operational from public, anon, authenticated;
grant select on table public.field_discoveries_operational to authenticated;

create or replace function public.create_field_discovery(
  p_job_id uuid,
  p_area text default null,
  p_description text default null,
  p_estimated_extra_minutes integer default null,
  p_estimated_extra_amount numeric default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_role text; v_id uuid; v_snapshot_id uuid;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  v_role := public.current_user_role();
  if v_role not in ('Master Admin','Administrator','Manager','Crew Lead','Scrub Technician') then
    raise exception 'Field Discovery creation permission denied.';
  end if;
  if not public.can_write_operational_photo_record('jobs', p_job_id) then
    raise exception 'Job not found or outside your permitted scope.';
  end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null then raise exception 'Description is required.'; end if;
  if p_estimated_extra_minutes is not null and p_estimated_extra_minutes < 0 then raise exception 'Estimated extra time cannot be negative.'; end if;
  if p_estimated_extra_amount is not null and v_role <> 'Master Admin' then raise exception 'Only Master Admin may record an estimated extra amount.'; end if;
  if p_estimated_extra_amount is not null and (p_estimated_extra_amount = 'NaN'::numeric or p_estimated_extra_amount < 0) then raise exception 'Estimated extra amount cannot be negative.'; end if;
  select id into v_snapshot_id from public.scope_snapshots where job_id = p_job_id and version = 1 limit 1;
  insert into public.field_discoveries(job_id, scope_snapshot_id, discovered_by, area, description, estimated_extra_minutes, estimated_extra_amount)
  values (p_job_id, v_snapshot_id, auth.uid(), nullif(btrim(coalesce(p_area, '')), ''), btrim(p_description), p_estimated_extra_minutes, p_estimated_extra_amount)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_field_discovery_status(p_field_discovery_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  v_role := public.current_user_role();
  if v_role not in ('Master Admin','Administrator','Manager') then raise exception 'Field Discovery review permission denied.'; end if;
  if p_status not in ('Open','Reviewed','Dismissed') then raise exception 'Invalid Field Discovery status.'; end if;
  update public.field_discoveries set status = p_status where id = p_field_discovery_id;
  if not found then raise exception 'Field Discovery not found.'; end if;
end;
$$;

create or replace function public.is_valid_field_discovery_media_path(p_job_id uuid, p_discovery_id uuid, p_name text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_name ~ ('^jobs/' || p_job_id::text || '/discoveries/' || p_discovery_id::text || '/[0-9a-f-]+\.(jpg|png|webp|heic|heif)$');
$$;
revoke all on function public.is_valid_field_discovery_media_path(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.add_field_discovery_media(p_field_discovery_id uuid, p_storage_path text, p_media_type text default null)
returns public.field_discovery_media language plpgsql security definer set search_path = '' as $$
declare v_role text; v_discovery public.field_discoveries; v_media public.field_discovery_media; v_metadata jsonb;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  v_role := public.current_user_role();
  if v_role not in ('Master Admin','Administrator','Manager','Crew Lead','Scrub Technician') then raise exception 'Field Discovery media permission denied.'; end if;
  select * into v_discovery from public.field_discoveries where id = p_field_discovery_id;
  if not found or not public.can_write_operational_photo_record('jobs', v_discovery.job_id) then raise exception 'Field Discovery not found or outside your permitted scope.'; end if;
  if not public.is_valid_field_discovery_media_path(v_discovery.job_id, v_discovery.id, p_storage_path) then raise exception 'Invalid Field Discovery media path.'; end if;
  select metadata into v_metadata from storage.objects where bucket_id = 'operational-photos' and name = p_storage_path and owner_id = auth.uid()::text;
  if not found then raise exception 'Uploaded Field Discovery media was not found.'; end if;
  if lower(coalesce(v_metadata->>'mimetype', p_media_type, '')) not in ('image/jpeg','image/png','image/webp','image/heic','image/heif') then raise exception 'Unsupported Field Discovery media type.'; end if;
  insert into public.field_discovery_media(field_discovery_id, storage_path, media_type)
  values (v_discovery.id, p_storage_path, nullif(lower(coalesce(p_media_type, v_metadata->>'mimetype', '')), '')) returning * into v_media;
  return v_media;
end;
$$;

revoke all on function public.create_field_discovery(uuid,text,text,integer,numeric) from public, anon, authenticated;
revoke all on function public.update_field_discovery_status(uuid,text) from public, anon, authenticated;
revoke all on function public.add_field_discovery_media(uuid,text,text) from public, anon, authenticated;
grant execute on function public.create_field_discovery(uuid,text,text,integer,numeric) to authenticated;
grant execute on function public.update_field_discovery_status(uuid,text) to authenticated;
grant execute on function public.add_field_discovery_media(uuid,text,text) to authenticated;

create or replace function public.is_valid_operational_photo_path(p_record_type text, p_record_id uuid, p_name text)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare v_parts text[] := string_to_array(p_name, '/'); v_filename text;
begin
  if p_record_type not in ('walkthroughs','jobs') or v_parts[1] is distinct from p_record_type or v_parts[2] is distinct from p_record_id::text then return false; end if;
  if p_record_type = 'walkthroughs' then
    if array_length(v_parts, 1) <> 3 then return false; end if; v_filename := v_parts[3];
  elsif array_length(v_parts, 1) = 4 and v_parts[3] in ('before','after','damage','other') then v_filename := v_parts[4];
  elsif array_length(v_parts, 1) = 5 and v_parts[3] = 'discoveries' and v_parts[4] ~ '^[0-9a-f-]{36}$' then v_filename := v_parts[5];
  else return false;
  end if;
  return v_filename ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif)$';
end;
$$;

create or replace function public.can_read_operational_photo_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[] := string_to_array(p_name, '/'); v_job_id uuid; v_discovery_id uuid;
begin
  if array_length(v_parts, 1) = 5 and v_parts[1] = 'jobs' and v_parts[3] = 'discoveries' then
    v_job_id := v_parts[2]::uuid; v_discovery_id := v_parts[4]::uuid;
    return public.is_valid_operational_photo_path('jobs', v_job_id, p_name)
      and public.has_any_role(array['Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician'])
      and exists(select 1 from public.field_discoveries where id = v_discovery_id and job_id = v_job_id);
  end if;
  if array_length(v_parts, 1) not in (3,4) or v_parts[1] not in ('walkthroughs','jobs') then return false; end if;
  v_job_id := v_parts[2]::uuid;
  return public.is_valid_operational_photo_path(v_parts[1], v_job_id, p_name) and public.can_read_operational_photo_record(v_parts[1], v_job_id);
exception when invalid_text_representation then return false;
end;
$$;

create or replace function public.can_write_operational_photo_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[] := string_to_array(p_name, '/'); v_job_id uuid; v_discovery_id uuid;
begin
  if array_length(v_parts, 1) = 5 and v_parts[1] = 'jobs' and v_parts[3] = 'discoveries' then
    v_job_id := v_parts[2]::uuid; v_discovery_id := v_parts[4]::uuid;
    return public.is_valid_operational_photo_path('jobs', v_job_id, p_name)
      and public.can_write_operational_photo_record('jobs', v_job_id)
      and exists(select 1 from public.field_discoveries where id = v_discovery_id and job_id = v_job_id);
  end if;
  if array_length(v_parts, 1) not in (3,4) or v_parts[1] not in ('walkthroughs','jobs') then return false; end if;
  v_job_id := v_parts[2]::uuid;
  return public.is_valid_operational_photo_path(v_parts[1], v_job_id, p_name) and public.can_write_operational_photo_record(v_parts[1], v_job_id);
exception when invalid_text_representation then return false;
end;
$$;

revoke all on function public.is_valid_operational_photo_path(text,uuid,text) from public, anon, authenticated;
revoke all on function public.can_read_operational_photo_path(text), public.can_write_operational_photo_path(text) from public, anon, authenticated;
grant execute on function public.can_read_operational_photo_path(text), public.can_write_operational_photo_path(text) to authenticated;

notify pgrst, 'reload schema';
commit;
