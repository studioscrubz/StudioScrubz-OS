-- StudioScrubz OS: Walkthrough / Proposal / Job photo -> Invoice snapshots.
-- REVIEW ONLY. Do not execute automatically.
--
-- Extends the existing private invoice_job_photos snapshot architecture.
-- Source customerVisible metadata is copied into the immutable Invoice
-- snapshot. Missing or invalid legacy visibility metadata fails closed.
-- No historical Invoice rows are backfilled by this migration.

begin;

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
      or (v_photo - array['id','storagePath','category','originalFilename','mimeType','sizeBytes','uploadedAt','uploadedBy','caption','source','customerVisible']::text[]) <> '{}'::jsonb
      or (v_photo ? 'customerVisible' and jsonb_typeof(v_photo->'customerVisible') <> 'boolean')
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

revoke all on function public.validate_operational_photos(text, uuid, jsonb)
from public, anon, authenticated;

create or replace function public.validate_proposal_pricing_photos(
  p_proposal_id uuid,
  p_photos jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_walkthrough_id uuid;
  v_photo jsonb;
  v_size_text text;
  v_size bigint;
begin
  select walkthrough_id into v_walkthrough_id
  from public.proposals
  where id = p_proposal_id;
  if not found then raise exception 'Proposal not found.'; end if;
  if jsonb_typeof(p_photos) <> 'array' or jsonb_array_length(p_photos) > 100 then
    raise exception 'Proposal pricing photos must be an array of at most 100 items.';
  end if;

  for v_photo in select value from jsonb_array_elements(p_photos) loop
    v_size_text := v_photo->>'sizeBytes';
    if v_size_text is null or v_size_text !~ '^[0-9]+$' or length(v_size_text) > 8 then
      raise exception 'Invalid Proposal pricing photo metadata.';
    end if;
    v_size := v_size_text::bigint;
    if jsonb_typeof(v_photo) <> 'object'
      or not (v_photo ?& array['id','storagePath','category','originalFilename','mimeType','sizeBytes','uploadedAt','uploadedBy','caption','source','ownership'])
      or (v_photo ? 'customerVisible' and jsonb_typeof(v_photo->'customerVisible') <> 'boolean')
      or length(btrim(v_photo->>'id')) not between 1 and 128
      or length(btrim(v_photo->>'originalFilename')) not between 1 and 255
      or (v_photo->>'mimeType') not in ('image/jpeg','image/png','image/webp','image/heic','image/heif')
      or v_size not between 1 and 10485760
      or length(btrim(v_photo->>'uploadedAt')) < 1
      or length(btrim(v_photo->>'uploadedBy')) < 1
      or coalesce(length(v_photo->>'caption'), 0) > 1000
      or (v_photo->>'source') not in ('camera','library')
      or (v_photo->>'ownership') not in ('walkthrough-reference','proposal')
      or (
        v_photo->>'ownership' = 'proposal'
        and (
          not public.is_valid_proposal_photo_path(p_proposal_id, v_photo->>'storagePath')
          or v_photo->>'category' <> 'Pricing'
          or split_part(split_part(v_photo->>'storagePath', '/', 3), '.', 1) <> v_photo->>'id'
          or not exists (
            select 1 from storage.objects object
            where object.bucket_id = 'operational-photos'
              and object.name = v_photo->>'storagePath'
              and object.owner_id = v_photo->>'uploadedBy'
              and lower(coalesce(object.metadata->>'mimetype','')) = lower(v_photo->>'mimeType')
              and case when coalesce(object.metadata->>'size','') ~ '^[0-9]+$'
                and length(object.metadata->>'size') <= 8
                then (object.metadata->>'size')::bigint = v_size else false end
          )
        )
      )
      or (
        v_photo->>'ownership' = 'walkthrough-reference'
        and (
          v_walkthrough_id is null
          or not public.is_valid_operational_photo_path('walkthroughs', v_walkthrough_id, v_photo->>'storagePath')
          or not exists (
            select 1
            from public.walkthroughs walkthrough,
              lateral jsonb_array_elements(case when jsonb_typeof(walkthrough.photos) = 'array' then walkthrough.photos else '[]'::jsonb end) source_photo
            where walkthrough.id = v_walkthrough_id
              and source_photo->>'id' = v_photo->>'id'
              and source_photo->>'storagePath' = v_photo->>'storagePath'
              and source_photo->>'category' is not distinct from v_photo->>'category'
              and source_photo->>'originalFilename' is not distinct from v_photo->>'originalFilename'
              and source_photo->>'mimeType' is not distinct from v_photo->>'mimeType'
              and source_photo->>'sizeBytes' is not distinct from v_photo->>'sizeBytes'
              and source_photo->>'uploadedAt' is not distinct from v_photo->>'uploadedAt'
              and source_photo->>'uploadedBy' is not distinct from v_photo->>'uploadedBy'
              and source_photo->>'source' is not distinct from v_photo->>'source'
              and (case when jsonb_typeof(source_photo->'customerVisible') = 'boolean' then (source_photo->>'customerVisible')::boolean else false end)
                = (case when jsonb_typeof(v_photo->'customerVisible') = 'boolean' then (v_photo->>'customerVisible')::boolean else false end)
          )
        )
      )
      or not exists (
        select 1 from storage.objects object
        where object.bucket_id = 'operational-photos'
          and object.name = v_photo->>'storagePath'
      )
    then raise exception 'Invalid Proposal pricing photo metadata.';
    end if;
  end loop;
end;
$$;

revoke all on function public.validate_proposal_pricing_photos(uuid, jsonb)
from public, anon, authenticated;

create or replace function public.add_proposal_owned_photo(
  p_proposal_id uuid,
  p_photo_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_caption text,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb; v_mime_type text; v_size_text text; v_size bigint;
  v_photo jsonb; v_photos jsonb; v_status text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_profiles profile
    where profile.id = (select auth.uid()) and profile.is_active
      and profile.role in ('Master Admin','Administrator','Manager')
  ) then raise exception 'Proposal photo update denied.'; end if;
  if p_source not in ('camera','library')
    or length(btrim(coalesce(p_original_filename,''))) not between 1 and 255
    or length(coalesce(p_caption,'')) > 1000
    or not public.is_valid_proposal_photo_path(p_proposal_id, p_storage_path)
    or split_part(split_part(p_storage_path, '/', 3), '.', 1) <> p_photo_id::text
  then raise exception 'Invalid Proposal-owned photo metadata.'; end if;
  select case when jsonb_typeof(proposal.photos) = 'array' then proposal.photos else '[]'::jsonb end, proposal.status
  into v_photos, v_status from public.proposals proposal
  where proposal.id = p_proposal_id for update;
  if not found then raise exception 'Proposal not found.'; end if;
  if v_status is distinct from 'Draft' then raise exception 'Pricing photos cannot be changed after the Proposal is finalized.'; end if;
  select object.metadata into v_metadata from storage.objects object
  where object.bucket_id = 'operational-photos' and object.name = p_storage_path
    and object.owner_id = (select auth.uid()::text);
  if not found then raise exception 'The Proposal photo upload was not found.'; end if;
  v_mime_type := lower(coalesce(v_metadata->>'mimetype',''));
  v_size_text := v_metadata->>'size';
  if v_mime_type not in ('image/jpeg','image/png','image/webp','image/heic','image/heif')
    or v_size_text is null or v_size_text !~ '^[0-9]+$' or length(v_size_text) > 8
  then raise exception 'The Proposal photo upload has invalid Storage metadata.'; end if;
  v_size := v_size_text::bigint;
  if v_size not between 1 and 10485760 then raise exception 'The Proposal photo must be between 1 byte and 10 MB.'; end if;
  if jsonb_array_length(v_photos) >= 100 then raise exception 'A Proposal may contain at most 100 pricing photos.'; end if;
  if exists (select 1 from jsonb_array_elements(v_photos) existing
    where existing->>'id' = p_photo_id::text or existing->>'storagePath' = p_storage_path)
  then raise exception 'This Proposal photo is already recorded.'; end if;
  v_photo := jsonb_build_object(
    'id', p_photo_id::text, 'storagePath', p_storage_path, 'category', 'Pricing',
    'originalFilename', btrim(p_original_filename), 'mimeType', v_mime_type,
    'sizeBytes', v_size, 'uploadedAt', now()::text, 'uploadedBy', auth.uid()::text,
    'caption', nullif(btrim(coalesce(p_caption,'')),''), 'source', p_source,
    'ownership', 'proposal', 'customerVisible', false
  );
  v_photos := v_photos || jsonb_build_array(v_photo);
  perform public.validate_proposal_pricing_photos(p_proposal_id, jsonb_build_array(v_photo));
  update public.proposals set photos = v_photos where id = p_proposal_id;
  return v_photo;
end;
$$;

revoke all on function public.add_proposal_owned_photo(uuid, uuid, text, text, text, text)
from public, anon, authenticated;

grant execute on function public.add_proposal_owned_photo(uuid, uuid, text, text, text, text)
to authenticated;

create or replace function public.seed_proposal_pricing_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.photos) <> 'array' then raise exception 'Proposal pricing photos must be initialized by the database.'; end if;
  if jsonb_array_length(new.photos) > 0 then raise exception 'New Proposal pricing photos must be initialized by the database.'; end if;
  if new.walkthrough_id is null then new.photos := '[]'::jsonb; return new; end if;
  perform 1 from public.walkthroughs where id = new.walkthrough_id for share;
  new.photos := coalesce((
    select jsonb_agg(
      photo || jsonb_build_object(
        'ownership', 'walkthrough-reference',
        'customerVisible', case when jsonb_typeof(photo->'customerVisible') = 'boolean'
          then (photo->>'customerVisible')::boolean else false end
      ) order by ordinal
    )
    from public.walkthroughs walkthrough,
      lateral jsonb_array_elements(case when jsonb_typeof(walkthrough.photos) = 'array' then walkthrough.photos else '[]'::jsonb end)
        with ordinality item(photo, ordinal)
    where walkthrough.id = new.walkthrough_id
      and jsonb_typeof(photo) = 'object'
      and length(btrim(photo->>'id')) between 1 and 128
      and split_part(regexp_replace(photo->>'storagePath', '^.*/', ''), '.', 1) = photo->>'id'
      and (photo->>'category') in ('General','Exterior','Interior','Kitchen','Bathroom','Flooring','Damage / Concern','Other')
      and length(btrim(photo->>'originalFilename')) between 1 and 255
      and (photo->>'mimeType') in ('image/jpeg','image/png','image/webp','image/heic','image/heif')
      and case when coalesce(photo->>'sizeBytes','') ~ '^[0-9]+$' and length(photo->>'sizeBytes') <= 8
        then (photo->>'sizeBytes')::bigint between 1 and 10485760 else false end
      and length(btrim(photo->>'uploadedAt')) > 0
      and length(btrim(photo->>'uploadedBy')) > 0
      and coalesce(length(photo->>'caption'), 0) <= 1000
      and (photo->>'source') in ('camera','library')
      and public.is_valid_operational_photo_path('walkthroughs', new.walkthrough_id, photo->>'storagePath')
      and exists (select 1 from storage.objects object
        where object.bucket_id = 'operational-photos' and object.name = photo->>'storagePath')
  ), '[]'::jsonb);
  return new;
end;
$$;

revoke all on function public.seed_proposal_pricing_photos()
from public, anon, authenticated;

drop trigger if exists proposals_seed_pricing_photos on public.proposals;
create trigger proposals_seed_pricing_photos
before insert on public.proposals
for each row execute function public.seed_proposal_pricing_photos();

alter table public.invoice_job_photos
  drop constraint if exists invoice_job_photos_category_check;

alter table public.invoice_job_photos
  add constraint invoice_job_photos_category_check
  check (category in (
    'General', 'Exterior', 'Interior', 'Kitchen', 'Bathroom', 'Flooring',
    'Damage / Concern', 'Pricing', 'Before', 'After', 'Damage / Issue', 'Other'
  ));

alter table public.invoice_job_photos
  drop constraint if exists invoice_job_photos_check;

alter table public.invoice_job_photos
  drop constraint if exists invoice_job_photos_storage_path_check;

alter table public.invoice_job_photos
  add constraint invoice_job_photos_storage_path_check
  check (
    storage_path like 'walkthroughs/%'
    or storage_path like 'proposals/%'
    or storage_path like 'jobs/%'
  );

create or replace function public.snapshot_finished_job_photos_for_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_id is null then return new; end if;

  -- Serialize with the existing operational photo metadata writers.
  perform 1 from public.jobs where id = new.job_id for update;

  insert into public.invoice_job_photos (
    invoice_id, job_id, job_photo_id, storage_path, category,
    original_filename, mime_type, size_bytes, caption, uploaded_at,
    uploaded_by, source, customer_visible
  )
  with job_context as (
    select
      job.id as job_id,
      job.walkthrough_id,
      job.proposal_id,
      proposal.walkthrough_id as proposal_walkthrough_id
    from public.jobs job
    left join public.proposals proposal on proposal.id = job.proposal_id
    where job.id = new.job_id
  ), candidates as (
    select
      'Job'::text as owner_type,
      job.id as owner_id,
      null::uuid as referenced_walkthrough_id,
      photo.value as photo
    from public.jobs job
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(job.photos) = 'array' then job.photos else '[]'::jsonb end
    ) photo(value)
    where job.id = new.job_id

    union all

    select
      'Proposal'::text,
      proposal.id,
      proposal.walkthrough_id,
      photo.value
    from job_context context
    join public.proposals proposal on proposal.id = context.proposal_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(proposal.photos) = 'array' then proposal.photos else '[]'::jsonb end
    ) photo(value)

    union all

    select
      'Walkthrough'::text,
      walkthrough.id,
      walkthrough.id,
      photo.value
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
      select case
        when candidate.photo ->> 'sizeBytes' ~ '^[0-9]{1,8}$'
          then (candidate.photo ->> 'sizeBytes')::bigint
        else null
      end as size_bytes
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
        (
          candidate.owner_type = 'Job'
          and public.is_valid_operational_photo_path(
            'jobs', candidate.owner_id, candidate.photo ->> 'storagePath'
          )
        )
        or (
          candidate.owner_type = 'Walkthrough'
          and public.is_valid_operational_photo_path(
            'walkthroughs', candidate.owner_id, candidate.photo ->> 'storagePath'
          )
        )
        or (
          candidate.owner_type = 'Proposal'
          and (
            public.is_valid_proposal_photo_path(
              candidate.owner_id, candidate.photo ->> 'storagePath'
            )
            or (
              candidate.referenced_walkthrough_id is not null
              and public.is_valid_operational_photo_path(
                'walkthroughs',
                candidate.referenced_walkthrough_id,
                candidate.photo ->> 'storagePath'
              )
            )
          )
        )
      )
      and exists (
        select 1 from storage.objects object
        where object.bucket_id = 'operational-photos'
          and object.name = candidate.photo ->> 'storagePath'
      )
  )
  select
    new.id,
    new.job_id,
    candidate.photo ->> 'id',
    candidate.photo ->> 'storagePath',
    candidate.photo ->> 'category',
    candidate.photo ->> 'originalFilename',
    candidate.photo ->> 'mimeType',
    candidate.size_bytes,
    nullif(candidate.photo ->> 'caption', ''),
    candidate.photo ->> 'uploadedAt',
    candidate.photo ->> 'uploadedBy',
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

-- Preserve the existing trigger name so both automatic completed-Job Invoice
-- creation and any other Job-linked Invoice insertion use the same snapshot.
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
  select
    invoice.id,
    new.id,
    photo.value ->> 'id',
    photo.value ->> 'storagePath',
    photo.value ->> 'category',
    photo.value ->> 'originalFilename',
    photo.value ->> 'mimeType',
    parsed.size_bytes,
    nullif(photo.value ->> 'caption', ''),
    photo.value ->> 'uploadedAt',
    photo.value ->> 'uploadedBy',
    photo.value ->> 'source',
    case when jsonb_typeof(photo.value -> 'customerVisible') = 'boolean'
      then (photo.value ->> 'customerVisible')::boolean else false end
  from public.invoices invoice
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(new.photos) = 'array' then new.photos else '[]'::jsonb end
  ) photo(value)
  cross join lateral (
    select case
      when photo.value ->> 'sizeBytes' ~ '^[0-9]{1,8}$'
        then (photo.value ->> 'sizeBytes')::bigint
      else null
    end as size_bytes
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
      select 1
      from jsonb_array_elements(
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
    select 1
    from public.invoice_job_photos reference
    where reference.job_id = old.id
      -- Walkthrough and Proposal paths are protected by the existing shared
      -- operational-photo deletion guard, not by this Job JSON guard.
      and reference.storage_path like 'jobs/' || old.id::text || '/%'
      and not exists (
        select 1
        from jsonb_array_elements(
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

-- Proposal-owned Storage objects need the same durable Invoice-reference guard
-- already enforced for Walkthrough and Job objects. Preserve the existing
-- authorization and Proposal-reference checks, and add only the Invoice check.
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
    or array_length(v_parts, 1) <> 3
  then return false; end if;
  v_proposal_id := v_parts[2]::uuid;
  return not exists (
    select 1
    from public.proposals proposal,
      lateral jsonb_array_elements(
        case when jsonb_typeof(proposal.photos) = 'array'
          then proposal.photos else '[]'::jsonb end
      ) photo
    where proposal.id = v_proposal_id
      and photo->>'storagePath' = p_name
  )
  and not exists (
    select 1
    from public.invoice_job_photos reference
    where reference.storage_path = p_name
  );
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function public.can_delete_proposal_photo_path(text)
from public, anon, authenticated;

grant execute on function public.can_delete_proposal_photo_path(text)
to authenticated;

-- Existing RLS, authenticated internal reads, explicit visibility RPC, private
-- Storage, and token-validated public signed-URL delivery remain unchanged.
-- No anon table or Storage privilege is added.

notify pgrst, 'reload schema';

commit;
