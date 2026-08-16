-- StudioScrubz OS: private operational photo storage.
-- REVIEW ONLY. Do not execute automatically.
-- Run after walkthroughs.sql, jobs.sql, role_permissions.sql, and jobs_assigned_crew.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'operational-photos',
  'operational-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_read_operational_photo_record(
  p_record_type text,
  p_record_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then return false; end if;
  v_role := public.current_user_role();
  if v_role in ('Master Admin', 'Administrator', 'Manager') then
    if p_record_type = 'walkthroughs' then return exists(select 1 from public.walkthroughs where id = p_record_id); end if;
    if p_record_type = 'jobs' then return exists(select 1 from public.jobs where id = p_record_id); end if;
    return false;
  end if;
  if p_record_type = 'walkthroughs' then
    -- Mirrors role_permissions.sql: Sales has read access to all Walkthrough rows.
    return v_role = 'Sales' and exists(select 1 from public.walkthroughs where id = p_record_id);
  end if;
  if p_record_type = 'jobs' then
    return v_role in ('Crew Lead', 'Scrub Technician') and exists(
      select 1 from public.jobs j
      where j.id = p_record_id and public.is_assigned_to_crew(j.assigned_crew_id)
    );
  end if;
  return false;
end;
$$;

revoke all on function public.can_read_operational_photo_record(text, uuid) from public, anon, authenticated;
grant execute on function public.can_read_operational_photo_record(text, uuid) to authenticated;

create or replace function public.can_write_operational_photo_record(
  p_record_type text,
  p_record_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then return false; end if;
  v_role := public.current_user_role();
  if v_role in ('Master Admin', 'Administrator', 'Manager') then
    if p_record_type = 'walkthroughs' then return exists(select 1 from public.walkthroughs where id = p_record_id); end if;
    if p_record_type = 'jobs' then return exists(select 1 from public.jobs where id = p_record_id); end if;
    return false;
  end if;
  if p_record_type = 'jobs' then
    return v_role in ('Crew Lead', 'Scrub Technician') and exists(
      select 1 from public.jobs j
      where j.id = p_record_id and public.is_assigned_to_crew(j.assigned_crew_id)
    );
  end if;
  return false;
end;
$$;

revoke all on function public.can_write_operational_photo_record(text, uuid) from public, anon, authenticated;
grant execute on function public.can_write_operational_photo_record(text, uuid) to authenticated;

create or replace function public.can_delete_operational_photo_record(
  p_record_type text,
  p_record_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then return false; end if;
  v_role := public.current_user_role();
  if v_role not in ('Master Admin', 'Administrator', 'Manager') then return false; end if;
  if p_record_type = 'walkthroughs' then return exists(select 1 from public.walkthroughs where id = p_record_id); end if;
  if p_record_type = 'jobs' then return exists(select 1 from public.jobs where id = p_record_id); end if;
  return false;
end;
$$;

revoke all on function public.can_delete_operational_photo_record(text, uuid) from public, anon, authenticated;
grant execute on function public.can_delete_operational_photo_record(text, uuid) to authenticated;

create or replace function public.is_valid_operational_photo_path(
  p_record_type text,
  p_record_id uuid,
  p_name text
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_filename text;
begin
  if p_record_type not in ('walkthroughs', 'jobs')
    or v_parts[1] is distinct from p_record_type
    or v_parts[2] is distinct from p_record_id::text
  then return false;
  end if;

  if p_record_type = 'walkthroughs' then
    if array_length(v_parts, 1) <> 3 then return false; end if;
    v_filename := v_parts[3];
  else
    if array_length(v_parts, 1) <> 4
      or v_parts[3] not in ('before', 'after', 'damage', 'other')
    then return false;
    end if;
    v_filename := v_parts[4];
  end if;

  return v_filename ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif)$';
end;
$$;

revoke all on function public.is_valid_operational_photo_path(text, uuid, text) from public, anon, authenticated;

create or replace function public.can_read_operational_photo_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_id uuid;
begin
  if array_length(v_parts, 1) not in (3, 4) or v_parts[1] not in ('walkthroughs', 'jobs') then return false; end if;
  v_id := v_parts[2]::uuid;
  return public.is_valid_operational_photo_path(v_parts[1], v_id, p_name)
    and public.can_read_operational_photo_record(v_parts[1], v_id);
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function public.can_read_operational_photo_path(text) from public, anon, authenticated;
grant execute on function public.can_read_operational_photo_path(text) to authenticated;

create or replace function public.can_write_operational_photo_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[] := string_to_array(p_name, '/'); v_id uuid;
begin
  if array_length(v_parts, 1) not in (3, 4) or v_parts[1] not in ('walkthroughs', 'jobs') then return false; end if;
  v_id := v_parts[2]::uuid;
  return public.is_valid_operational_photo_path(v_parts[1], v_id, p_name)
    and public.can_write_operational_photo_record(v_parts[1], v_id);
exception when invalid_text_representation then return false;
end;
$$;

create or replace function public.can_delete_operational_photo_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[] := string_to_array(p_name, '/'); v_id uuid;
begin
  if array_length(v_parts, 1) not in (3, 4) or v_parts[1] not in ('walkthroughs', 'jobs') then return false; end if;
  v_id := v_parts[2]::uuid;
  return public.is_valid_operational_photo_path(v_parts[1], v_id, p_name)
    and public.can_delete_operational_photo_record(v_parts[1], v_id);
exception when invalid_text_representation then return false;
end;
$$;

revoke all on function public.can_write_operational_photo_path(text), public.can_delete_operational_photo_path(text) from public, anon, authenticated;
grant execute on function public.can_write_operational_photo_path(text), public.can_delete_operational_photo_path(text) to authenticated;

drop policy if exists "Operational photos scoped read" on storage.objects;
drop policy if exists "Operational photos scoped upload" on storage.objects;
drop policy if exists "Operational photos scoped delete" on storage.objects;
create policy "Operational photos scoped read" on storage.objects for select to authenticated
using (bucket_id = 'operational-photos' and public.can_read_operational_photo_path(name));
create policy "Operational photos scoped upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'operational-photos'
  and public.can_write_operational_photo_path(name)
  and owner_id = (select auth.uid()::text)
);
create policy "Operational photos scoped delete" on storage.objects for delete to authenticated
using (bucket_id = 'operational-photos' and public.can_delete_operational_photo_path(name));

create or replace function public.validate_operational_photos(
  p_record_type text,
  p_record_id uuid,
  p_photos jsonb
)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_photo jsonb;
  v_prefix text := p_record_type || '/' || p_record_id::text || '/';
begin
  if jsonb_typeof(p_photos) <> 'array' or jsonb_array_length(p_photos) > 100 then
    raise exception 'Photo metadata must be an array of at most 100 items.';
  end if;
  for v_photo in select value from jsonb_array_elements(p_photos) loop
    if jsonb_typeof(v_photo) <> 'object'
      or not (v_photo ?& array['id','storagePath','category','originalFilename','mimeType','sizeBytes','uploadedAt','uploadedBy','caption','source'])
      or (v_photo - array['id','storagePath','category','originalFilename','mimeType','sizeBytes','uploadedAt','uploadedBy','caption','source']::text[]) <> '{}'::jsonb
      or left(v_photo->>'storagePath', length(v_prefix)) <> v_prefix
      or not public.is_valid_operational_photo_path(p_record_type, p_record_id, v_photo->>'storagePath')
      or (v_photo->>'mimeType') not in ('image/jpeg','image/png','image/webp','image/heic','image/heif')
      or coalesce((v_photo->>'sizeBytes')::bigint, 0) not between 1 and 10485760
      or length(v_photo->>'originalFilename') > 255
      or length(coalesce(v_photo->>'caption', '')) > 1000
      or (v_photo->>'source') not in ('camera', 'library')
    then raise exception 'Invalid operational photo metadata.';
    end if;
  end loop;
end;
$$;

revoke all on function public.validate_operational_photos(text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.get_operational_photos(p_record_type text, p_record_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_photos jsonb;
begin
  if not public.can_read_operational_photo_record(p_record_type, p_record_id) then raise exception 'Photo access denied.'; end if;
  if p_record_type = 'walkthroughs' then select photos into v_photos from public.walkthroughs where id = p_record_id;
  elsif p_record_type = 'jobs' then select photos into v_photos from public.jobs where id = p_record_id;
  else raise exception 'Unsupported operational photo record type.';
  end if;
  if not found then raise exception 'Operational record not found.'; end if;
  return coalesce(v_photos, '[]'::jsonb);
end;
$$;

create or replace function public.set_operational_photos(p_record_type text, p_record_id uuid, p_photos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_existing jsonb;
begin
  if not public.can_write_operational_photo_record(p_record_type, p_record_id) then raise exception 'Photo update denied.'; end if;
  perform public.validate_operational_photos(p_record_type, p_record_id, p_photos);
  if p_record_type = 'walkthroughs' then select photos into v_existing from public.walkthroughs where id = p_record_id for update;
  elsif p_record_type = 'jobs' then select photos into v_existing from public.jobs where id = p_record_id for update;
  else raise exception 'Unsupported operational photo record type.';
  end if;
  if not found then raise exception 'Operational record not found.'; end if;
  if not public.can_delete_operational_photo_record(p_record_type, p_record_id) and exists(
    select 1 from jsonb_array_elements(coalesce(v_existing, '[]'::jsonb)) old_photo
    where not exists(
      select 1 from jsonb_array_elements(p_photos) new_photo
      where new_photo->>'id' = old_photo->>'id'
        and new_photo->>'storagePath' = old_photo->>'storagePath'
    )
  ) then raise exception 'Photo deletion is restricted to administrative roles.';
  end if;
  if p_record_type = 'walkthroughs' then update public.walkthroughs set photos = p_photos where id = p_record_id;
  else update public.jobs set photos = p_photos where id = p_record_id;
  end if;
  return p_photos;
end;
$$;

revoke all on function public.get_operational_photos(text, uuid), public.set_operational_photos(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_operational_photos(text, uuid), public.set_operational_photos(text, uuid, jsonb) to authenticated;

-- No anon Storage or table privileges are added. Archived records retain photos.
-- Permanent object cleanup is intentionally not added to the existing delete RPC here.
