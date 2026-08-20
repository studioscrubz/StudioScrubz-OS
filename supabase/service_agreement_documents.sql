-- StudioScrubz OS: private internal Service Agreement documents.
-- REVIEW ONLY. Do not execute automatically.
-- Run after service_agreements.sql, role_permissions.sql, and user_profiles.sql.

create table if not exists public.service_agreement_documents (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.service_agreements(id) on delete cascade,
  document_name text not null check (char_length(btrim(document_name)) between 1 and 200),
  description text check (description is null or char_length(description) <= 1000),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg', 'image/png', 'image/webp'
  )),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  uploaded_by uuid references public.user_profiles(id) on delete set null,
  uploaded_by_name text,
  uploaded_at timestamptz not null default now(),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_agreement_documents_agreement_idx on public.service_agreement_documents(agreement_id);
create index if not exists service_agreement_documents_uploaded_idx on public.service_agreement_documents(uploaded_at desc);
create index if not exists service_agreement_documents_archived_idx on public.service_agreement_documents(archived_at);

create or replace function public.is_valid_agreement_document_path(p_agreement_id uuid, p_document_id uuid, p_name text)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  return array_length(v_parts, 1) = 4
    and v_parts[1] = 'agreements'
    and v_parts[2] = p_agreement_id::text
    and v_parts[3] = p_document_id::text
    and v_parts[4] ~* '^[a-z0-9][a-z0-9_-]{0,120}\.(pdf|doc|docx|jpg|png|webp)$';
end;
$$;
revoke all on function public.is_valid_agreement_document_path(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.can_read_service_agreement_document(p_agreement_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and public.current_user_role() in ('Master Admin', 'Administrator', 'Manager', 'Sales')
    and exists(select 1 from public.service_agreements where id = p_agreement_id);
$$;

create or replace function public.can_manage_service_agreement_document(p_agreement_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and public.current_user_role() in ('Master Admin', 'Administrator', 'Manager', 'Sales')
    and exists(select 1 from public.service_agreements where id = p_agreement_id);
$$;

revoke all on function public.can_read_service_agreement_document(uuid), public.can_manage_service_agreement_document(uuid) from public, anon, authenticated;
grant execute on function public.can_read_service_agreement_document(uuid), public.can_manage_service_agreement_document(uuid) to authenticated;

create or replace function public.agreement_document_storage_object_exists(p_storage_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from storage.objects
    where bucket_id = 'agreement-documents' and name = p_storage_path
  );
$$;

create or replace function public.can_delete_agreement_document_metadata(p_agreement_id uuid, p_storage_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage_service_agreement_document(p_agreement_id)
    and not public.agreement_document_storage_object_exists(p_storage_path);
$$;

create or replace function public.can_create_agreement_document_metadata(p_agreement_id uuid, p_document_id uuid, p_storage_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage_service_agreement_document(p_agreement_id)
    and public.is_valid_agreement_document_path(p_agreement_id, p_document_id, p_storage_path)
    and public.agreement_document_storage_object_exists(p_storage_path);
$$;

revoke all on function public.agreement_document_storage_object_exists(text), public.can_delete_agreement_document_metadata(uuid, text), public.can_create_agreement_document_metadata(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.can_delete_agreement_document_metadata(uuid, text), public.can_create_agreement_document_metadata(uuid, uuid, text) to authenticated;

create or replace function public.prepare_service_agreement_document()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uploader_name text;
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := (select auth.uid());
    select coalesce(nullif(btrim(display_name), ''), email) into v_uploader_name
    from public.user_profiles where id = (select auth.uid());
    new.uploaded_by_name := v_uploader_name;
    new.uploaded_at := now();
    new.created_at := now();
  else
    if new.id is distinct from old.id
      or new.agreement_id is distinct from old.agreement_id
      or new.original_filename is distinct from old.original_filename
      or new.storage_path is distinct from old.storage_path
      or new.mime_type is distinct from old.mime_type
      or new.size_bytes is distinct from old.size_bytes
      or new.uploaded_by is distinct from old.uploaded_by
      or new.uploaded_by_name is distinct from old.uploaded_by_name
      or new.uploaded_at is distinct from old.uploaded_at
      or new.created_at is distinct from old.created_at
    then raise exception 'Agreement document storage and uploader metadata are immutable.';
    end if;
  end if;
  if not public.is_valid_agreement_document_path(new.agreement_id, new.id, new.storage_path) then
    raise exception 'Agreement document path is invalid.';
  end if;
  new.document_name := btrim(new.document_name);
  new.description := nullif(btrim(new.description), '');
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.prepare_service_agreement_document() from public, anon, authenticated;
drop trigger if exists prepare_service_agreement_document on public.service_agreement_documents;
create trigger prepare_service_agreement_document before insert or update on public.service_agreement_documents
for each row execute function public.prepare_service_agreement_document();

alter table public.service_agreement_documents enable row level security;
revoke all on public.service_agreement_documents from public, anon;
grant select, insert, update, delete on public.service_agreement_documents to authenticated;

drop policy if exists "Agreement documents parent read" on public.service_agreement_documents;
drop policy if exists "Agreement documents parent create" on public.service_agreement_documents;
drop policy if exists "Agreement documents parent update" on public.service_agreement_documents;
drop policy if exists "Agreement documents parent delete" on public.service_agreement_documents;
create policy "Agreement documents parent read" on public.service_agreement_documents for select to authenticated
using (public.can_read_service_agreement_document(agreement_id));
create policy "Agreement documents parent create" on public.service_agreement_documents for insert to authenticated
with check (
  public.can_create_agreement_document_metadata(agreement_id, id, storage_path)
  and uploaded_by = (select auth.uid())
);
create policy "Agreement documents parent update" on public.service_agreement_documents for update to authenticated
using (public.can_manage_service_agreement_document(agreement_id))
with check (public.can_manage_service_agreement_document(agreement_id));
create policy "Agreement documents parent delete" on public.service_agreement_documents for delete to authenticated
using (public.can_delete_agreement_document_metadata(agreement_id, storage_path));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agreement-documents',
  'agreement-documents',
  false,
  26214400,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg', 'image/png', 'image/webp'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.agreement_document_path_agreement_id(p_name text)
returns uuid language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_agreement_id uuid;
  v_document_id uuid;
begin
  if array_length(v_parts, 1) <> 4 or v_parts[1] <> 'agreements' then return null; end if;
  v_agreement_id := v_parts[2]::uuid;
  v_document_id := v_parts[3]::uuid;
  if not public.is_valid_agreement_document_path(v_agreement_id, v_document_id, p_name) then return null; end if;
  return v_agreement_id;
exception when invalid_text_representation then
  return null;
end;
$$;
revoke all on function public.agreement_document_path_agreement_id(text) from public, anon, authenticated;

create or replace function public.can_read_agreement_document_path(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.agreement_document_path_agreement_id(p_name) is not null
    and public.can_read_service_agreement_document(public.agreement_document_path_agreement_id(p_name));
$$;
create or replace function public.can_manage_agreement_document_path(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.agreement_document_path_agreement_id(p_name) is not null
    and public.can_manage_service_agreement_document(public.agreement_document_path_agreement_id(p_name));
$$;
revoke all on function public.can_read_agreement_document_path(text), public.can_manage_agreement_document_path(text) from public, anon, authenticated;
grant execute on function public.can_read_agreement_document_path(text), public.can_manage_agreement_document_path(text) to authenticated;

drop policy if exists "Agreement documents scoped read" on storage.objects;
drop policy if exists "Agreement documents scoped upload" on storage.objects;
drop policy if exists "Agreement documents scoped delete" on storage.objects;
create policy "Agreement documents scoped read" on storage.objects for select to authenticated
using (bucket_id = 'agreement-documents' and public.can_read_agreement_document_path(name));
create policy "Agreement documents scoped upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'agreement-documents'
  and public.can_manage_agreement_document_path(name)
  and owner_id = (select auth.uid()::text)
);
create policy "Agreement documents scoped delete" on storage.objects for delete to authenticated
using (bucket_id = 'agreement-documents' and public.can_manage_agreement_document_path(name));

-- Prevent the existing agreement permanent-delete RPC from cascading metadata while
-- leaving private Storage objects behind. Phase 3 can replace this guard with an
-- orchestrated Storage-API cleanup before deleting the agreement.
create or replace function public.prevent_agreement_delete_with_documents()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.service_agreement_documents where agreement_id = old.id) then
    raise exception 'Delete Agreement documents through the Storage workflow before permanently deleting this Service Agreement.';
  end if;
  return old;
end;
$$;
revoke all on function public.prevent_agreement_delete_with_documents() from public, anon, authenticated;
drop trigger if exists prevent_agreement_delete_with_documents on public.service_agreements;
create trigger prevent_agreement_delete_with_documents before delete on public.service_agreements
for each row execute function public.prevent_agreement_delete_with_documents();

-- No anonymous table or Storage access is granted. Public agreement token pages
-- intentionally cannot list, download, or otherwise discover these documents.
