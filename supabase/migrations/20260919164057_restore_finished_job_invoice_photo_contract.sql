-- Restore the verified Invoice photo snapshot contract without backfilling
-- historical Invoices. The snapshot is immutable except for customer_visible.
create table if not exists public.invoice_job_photos (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete restrict,
  job_photo_id text not null check (length(job_photo_id) between 1 and 128),
  storage_path text not null,
  category text not null default 'After',
  original_filename text not null check (length(original_filename) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  caption text check (length(coalesce(caption, '')) <= 1000),
  uploaded_at text not null check (length(uploaded_at) between 1 and 128),
  uploaded_by text not null check (length(uploaded_by) between 1 and 128),
  source text not null check (source in ('camera', 'library')),
  customer_visible boolean not null default false,
  created_at timestamptz not null default now(),
  unique (invoice_id, job_photo_id),
  unique (invoice_id, storage_path)
);

alter table public.invoice_job_photos
  drop constraint if exists invoice_job_photos_category_check;
alter table public.invoice_job_photos
  add constraint invoice_job_photos_category_check check (category in (
    'General', 'Exterior', 'Interior', 'Kitchen', 'Bathroom', 'Flooring',
    'Damage / Concern', 'Pricing', 'Before', 'After', 'Damage / Issue', 'Other'
  ));

alter table public.invoice_job_photos
  drop constraint if exists invoice_job_photos_check;
alter table public.invoice_job_photos
  drop constraint if exists invoice_job_photos_storage_path_check;
alter table public.invoice_job_photos
  add constraint invoice_job_photos_storage_path_check check (
    storage_path like 'walkthroughs/%'
    or storage_path like 'proposals/%'
    or storage_path like 'jobs/%'
  );

create index if not exists invoice_job_photos_invoice_id_idx
  on public.invoice_job_photos(invoice_id);
create index if not exists invoice_job_photos_storage_path_idx
  on public.invoice_job_photos(storage_path);

alter table public.invoice_job_photos enable row level security;
revoke all on table public.invoice_job_photos from public, anon, authenticated;
grant select on table public.invoice_job_photos to authenticated;

drop policy if exists "Invoice finished photos read" on public.invoice_job_photos;
drop policy if exists "Invoice finished photos create" on public.invoice_job_photos;
drop policy if exists "Invoice finished photos update" on public.invoice_job_photos;
drop policy if exists "Invoice finished photos delete" on public.invoice_job_photos;
create policy "Invoice finished photos read"
on public.invoice_job_photos for select to authenticated
using (
  exists (
    select 1 from public.user_profiles profile
    where profile.id = (select auth.uid())
      and profile.is_active
      and profile.role in ('Master Admin', 'Administrator', 'Manager')
  )
);

create or replace function public.snapshot_finished_job_photos_for_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_id is null then return new; end if;
  perform 1 from public.jobs where id = new.job_id for update;

  insert into public.invoice_job_photos (
    invoice_id, job_id, job_photo_id, storage_path, category,
    original_filename, mime_type, size_bytes, caption, uploaded_at,
    uploaded_by, source, customer_visible
  )
  with job_context as (
    select job.id as job_id, job.walkthrough_id, job.proposal_id,
      proposal.walkthrough_id as proposal_walkthrough_id
    from public.jobs job
    left join public.proposals proposal on proposal.id = job.proposal_id
    where job.id = new.job_id
  ), candidates as (
    select 'Job'::text as owner_type, job.id as owner_id,
      null::uuid as referenced_walkthrough_id, photo.value as photo
    from public.jobs job
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(job.photos) = 'array' then job.photos else '[]'::jsonb end
    ) photo(value)
    where job.id = new.job_id
    union all
    select 'Proposal'::text, proposal.id, proposal.walkthrough_id, photo.value
    from job_context context
    join public.proposals proposal on proposal.id = context.proposal_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(proposal.photos) = 'array' then proposal.photos else '[]'::jsonb end
    ) photo(value)
    union all
    select 'Walkthrough'::text, walkthrough.id, walkthrough.id, photo.value
    from job_context context
    join public.walkthroughs walkthrough
      on walkthrough.id = coalesce(context.walkthrough_id, context.proposal_walkthrough_id)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(walkthrough.photos) = 'array' then walkthrough.photos else '[]'::jsonb end
    ) photo(value)
  ), valid_candidates as (
    select candidate.*, parsed.size_bytes
    from candidates candidate
    cross join lateral (
      select case when candidate.photo ->> 'sizeBytes' ~ '^[0-9]{1,8}$'
        then (candidate.photo ->> 'sizeBytes')::bigint else null end as size_bytes
    ) parsed
    where jsonb_typeof(candidate.photo) = 'object'
      and length(btrim(coalesce(candidate.photo ->> 'id', ''))) between 1 and 128
      and candidate.photo ->> 'category' in (
        'General', 'Exterior', 'Interior', 'Kitchen', 'Bathroom', 'Flooring',
        'Damage / Concern', 'Pricing', 'Before', 'After', 'Damage / Issue', 'Other'
      )
      and length(btrim(coalesce(candidate.photo ->> 'originalFilename', ''))) between 1 and 255
      and candidate.photo ->> 'mimeType' in ('image/jpeg','image/png','image/webp','image/heic','image/heif')
      and parsed.size_bytes between 1 and 10485760
      and length(btrim(coalesce(candidate.photo ->> 'uploadedAt', ''))) between 1 and 128
      and length(btrim(coalesce(candidate.photo ->> 'uploadedBy', ''))) between 1 and 128
      and candidate.photo ->> 'source' in ('camera', 'library')
      and length(coalesce(candidate.photo ->> 'caption', '')) <= 1000
      and (
        (candidate.owner_type = 'Job' and public.is_valid_operational_photo_path(
          'jobs', candidate.owner_id, candidate.photo ->> 'storagePath'))
        or (candidate.owner_type = 'Walkthrough' and public.is_valid_operational_photo_path(
          'walkthroughs', candidate.owner_id, candidate.photo ->> 'storagePath'))
        or (candidate.owner_type = 'Proposal' and (
          public.is_valid_proposal_photo_path(candidate.owner_id, candidate.photo ->> 'storagePath')
          or (candidate.referenced_walkthrough_id is not null
            and public.is_valid_operational_photo_path(
              'walkthroughs', candidate.referenced_walkthrough_id,
              candidate.photo ->> 'storagePath'))
        ))
      )
      and exists (
        select 1 from storage.objects object
        where object.bucket_id = 'operational-photos'
          and object.name = candidate.photo ->> 'storagePath'
      )
  )
  select new.id, new.job_id, candidate.photo ->> 'id',
    candidate.photo ->> 'storagePath', candidate.photo ->> 'category',
    candidate.photo ->> 'originalFilename', candidate.photo ->> 'mimeType',
    candidate.size_bytes, nullif(candidate.photo ->> 'caption', ''),
    candidate.photo ->> 'uploadedAt', candidate.photo ->> 'uploadedBy',
    candidate.photo ->> 'source',
    case when jsonb_typeof(candidate.photo -> 'customerVisible') = 'boolean'
      then (candidate.photo ->> 'customerVisible')::boolean else false end
  from valid_candidates candidate
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.snapshot_finished_job_photos_for_invoice()
from public, anon, authenticated;

drop trigger if exists invoices_snapshot_finished_job_photos on public.invoices;
create trigger invoices_snapshot_finished_job_photos
after insert on public.invoices
for each row execute function public.snapshot_finished_job_photos_for_invoice();

create or replace function public.sync_new_finished_job_photos_to_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.invoice_job_photos (
    invoice_id, job_id, job_photo_id, storage_path, category,
    original_filename, mime_type, size_bytes, caption, uploaded_at,
    uploaded_by, source, customer_visible
  )
  select invoice.id, new.id, photo.value ->> 'id', photo.value ->> 'storagePath',
    photo.value ->> 'category', photo.value ->> 'originalFilename',
    photo.value ->> 'mimeType', parsed.size_bytes,
    nullif(photo.value ->> 'caption', ''), photo.value ->> 'uploadedAt',
    photo.value ->> 'uploadedBy', photo.value ->> 'source',
    case when jsonb_typeof(photo.value -> 'customerVisible') = 'boolean'
      then (photo.value ->> 'customerVisible')::boolean else false end
  from public.invoices invoice
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(new.photos) = 'array' then new.photos else '[]'::jsonb end
  ) photo(value)
  cross join lateral (
    select case when photo.value ->> 'sizeBytes' ~ '^[0-9]{1,8}$'
      then (photo.value ->> 'sizeBytes')::bigint else null end as size_bytes
  ) parsed
  where invoice.job_id = new.id
    and invoice.status not in ('Paid', 'Cancelled', 'Archived')
    and jsonb_typeof(photo.value) = 'object'
    and length(btrim(coalesce(photo.value ->> 'id', ''))) between 1 and 128
    and photo.value ->> 'category' in (
      'General', 'Exterior', 'Interior', 'Kitchen', 'Bathroom', 'Flooring',
      'Damage / Concern', 'Pricing', 'Before', 'After', 'Damage / Issue', 'Other'
    )
    and public.is_valid_operational_photo_path('jobs', new.id, photo.value ->> 'storagePath')
    and length(btrim(coalesce(photo.value ->> 'originalFilename', ''))) between 1 and 255
    and photo.value ->> 'mimeType' in ('image/jpeg','image/png','image/webp','image/heic','image/heif')
    and parsed.size_bytes between 1 and 10485760
    and length(btrim(coalesce(photo.value ->> 'uploadedAt', ''))) between 1 and 128
    and length(btrim(coalesce(photo.value ->> 'uploadedBy', ''))) between 1 and 128
    and photo.value ->> 'source' in ('camera', 'library')
    and length(coalesce(photo.value ->> 'caption', '')) <= 1000
    and not exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(old.photos) = 'array' then old.photos else '[]'::jsonb end
      ) old_photo(value)
      where old_photo.value ->> 'id' = photo.value ->> 'id'
        and old_photo.value ->> 'storagePath' = photo.value ->> 'storagePath'
    )
    and exists (
      select 1 from storage.objects object
      where object.bucket_id = 'operational-photos'
        and object.name = photo.value ->> 'storagePath'
    )
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.sync_new_finished_job_photos_to_invoice()
from public, anon, authenticated;

drop trigger if exists jobs_sync_new_finished_photos_to_invoice on public.jobs;
create trigger jobs_sync_new_finished_photos_to_invoice
after update of photos on public.jobs
for each row execute function public.sync_new_finished_job_photos_to_invoice();

create or replace function public.protect_invoiced_job_photo_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.invoice_job_photos reference
    where reference.job_id = old.id
      and reference.storage_path like 'jobs/' || old.id::text || '/%'
      and not exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(new.photos) = 'array' then new.photos else '[]'::jsonb end
        ) photo(value)
        where photo.value ->> 'id' = reference.job_photo_id
          and photo.value ->> 'storagePath' = reference.storage_path
      )
  ) then
    raise exception 'A Job photo referenced by an Invoice cannot be deleted.';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_invoiced_job_photo_references()
from public, anon, authenticated;

drop trigger if exists jobs_protect_invoiced_photo_references on public.jobs;
create trigger jobs_protect_invoiced_photo_references
before update of photos on public.jobs
for each row execute function public.protect_invoiced_job_photo_references();

create or replace function public.set_invoice_job_photo_visibility(
  p_invoice_id uuid,
  p_photo_id uuid,
  p_customer_visible boolean
)
returns public.invoice_job_photos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.invoice_job_photos;
begin
  if p_customer_visible is null then
    raise exception 'Customer visibility must be true or false.';
  end if;
  if auth.uid() is null or not exists (
    select 1 from public.user_profiles profile
    where profile.id = auth.uid()
      and profile.is_active
      and profile.role in ('Master Admin', 'Administrator')
  ) then
    raise exception 'Invoice photo visibility permission is required.';
  end if;
  update public.invoice_job_photos
  set customer_visible = p_customer_visible
  where invoice_id = p_invoice_id and id = p_photo_id
  returning * into v_photo;
  if not found then raise exception 'Invoice finished photo not found.'; end if;
  return v_photo;
end;
$$;
revoke all on function public.set_invoice_job_photo_visibility(uuid, uuid, boolean)
from public, anon, authenticated;
grant execute on function public.set_invoice_job_photo_visibility(uuid, uuid, boolean)
to authenticated;

create or replace function public.can_delete_operational_photo_path(p_name text)
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
  if array_length(v_parts, 1) not in (3, 4)
    or v_parts[1] not in ('walkthroughs', 'jobs') then return false; end if;
  v_id := v_parts[2]::uuid;
  return public.is_valid_operational_photo_path(v_parts[1], v_id, p_name)
    and public.can_delete_operational_photo_record(v_parts[1], v_id)
    and not exists (
      select 1 from public.invoice_job_photos reference
      where reference.storage_path = p_name
    )
    and not exists (
      select 1 from public.walkthroughs walkthrough,
        lateral jsonb_array_elements(
          case when jsonb_typeof(walkthrough.photos) = 'array'
            then walkthrough.photos else '[]'::jsonb end
        ) photo
      where v_parts[1] = 'walkthroughs' and walkthrough.id = v_id
        and photo->>'storagePath' = p_name
    )
    and not exists (
      select 1 from public.jobs job,
        lateral jsonb_array_elements(
          case when jsonb_typeof(job.photos) = 'array' then job.photos else '[]'::jsonb end
        ) photo
      where v_parts[1] = 'jobs' and job.id = v_id
        and photo->>'storagePath' = p_name
    )
    and not exists (
      select 1 from public.proposals proposal,
        lateral jsonb_array_elements(
          case when jsonb_typeof(proposal.photos) = 'array'
            then proposal.photos else '[]'::jsonb end
        ) photo
      where photo->>'storagePath' = p_name
    );
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.can_delete_operational_photo_path(text)
from public, anon, authenticated;
grant execute on function public.can_delete_operational_photo_path(text)
to authenticated;

create or replace function public.can_delete_proposal_photo_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_proposal_id uuid;
begin
  if not public.can_write_proposal_photo_path(p_name)
    or array_length(v_parts, 1) <> 3 then return false; end if;
  v_proposal_id := v_parts[2]::uuid;
  return not exists (
    select 1 from public.proposals proposal,
      lateral jsonb_array_elements(
        case when jsonb_typeof(proposal.photos) = 'array'
          then proposal.photos else '[]'::jsonb end
      ) photo
    where proposal.id = v_proposal_id and photo->>'storagePath' = p_name
  ) and not exists (
    select 1 from public.invoice_job_photos reference
    where reference.storage_path = p_name
  );
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.can_delete_proposal_photo_path(text)
from public, anon, authenticated;
grant execute on function public.can_delete_proposal_photo_path(text)
to authenticated;

drop policy if exists "Operational photos scoped delete" on storage.objects;
create policy "Operational photos scoped delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'operational-photos'
  and (
    public.can_delete_operational_photo_path(name)
    or public.can_delete_proposal_photo_path(name)
  )
);

notify pgrst, 'reload schema';
