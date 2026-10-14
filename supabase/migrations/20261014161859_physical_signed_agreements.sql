-- StudioScrubz OS: authenticated administrative intake for physically signed
-- Service Agreements. This migration is forward-only and is not applied by
-- the application automatically.

alter table public.service_agreements
  add column if not exists signing_method text,
  add column if not exists physically_signed_on date,
  add column if not exists physical_signed_uploaded_by uuid references public.user_profiles(id) on delete set null,
  add column if not exists physical_signed_uploaded_by_name text,
  add column if not exists physical_signed_uploaded_at timestamptz,
  add column if not exists physical_signing_original_status text,
  add column if not exists physical_signing_event_id uuid;

alter table public.service_agreements
  drop constraint if exists service_agreements_signing_method_check;
alter table public.service_agreements
  add constraint service_agreements_signing_method_check
  check (signing_method is null or signing_method in ('electronic', 'physical'));

update public.service_agreements
set signing_method = 'electronic'
where client_signed_at is not null and signing_method is null;

create table if not exists public.service_agreement_physical_signing_events (
  id uuid primary key,
  agreement_id uuid not null references public.service_agreements(id) on delete restrict,
  event_type text not null check (event_type in ('Physical Signature Finalized', 'Physical Signed Copy Replaced')),
  original_status text not null,
  resulting_status text not null,
  physically_signed_on date not null,
  required_client_signature_confirmed boolean not null check (required_client_signature_confirmed),
  all_other_signatures_confirmed boolean not null check (all_other_signatures_confirmed),
  performed_by uuid references public.user_profiles(id) on delete set null,
  performed_by_name text not null,
  performed_at timestamptz not null default now(),
  replaced_event_id uuid references public.service_agreement_physical_signing_events(id) on delete restrict,
  file_count integer not null check (file_count between 1 and 20),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists service_agreement_physical_signing_events_agreement_idx
  on public.service_agreement_physical_signing_events(agreement_id, performed_at desc);

create table if not exists public.service_agreement_physical_files (
  id uuid primary key,
  agreement_id uuid not null references public.service_agreements(id) on delete restrict,
  signing_event_id uuid not null references public.service_agreement_physical_signing_events(id) on delete restrict,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  page_order integer not null check (page_order between 1 and 20),
  uploaded_by uuid references public.user_profiles(id) on delete set null,
  uploaded_by_name text not null,
  uploaded_at timestamptz not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (signing_event_id, page_order)
);

create index if not exists service_agreement_physical_files_agreement_idx
  on public.service_agreement_physical_files(agreement_id, archived_at, page_order);

alter table public.service_agreements
  drop constraint if exists service_agreements_physical_signing_event_id_fkey;
alter table public.service_agreements
  add constraint service_agreements_physical_signing_event_id_fkey
  foreign key (physical_signing_event_id)
  references public.service_agreement_physical_signing_events(id) on delete restrict;

alter table public.service_agreement_physical_signing_events enable row level security;
alter table public.service_agreement_physical_files enable row level security;
revoke all on public.service_agreement_physical_signing_events, public.service_agreement_physical_files from public, anon;
grant select on public.service_agreement_physical_signing_events, public.service_agreement_physical_files to authenticated;

drop policy if exists "Physical signing administrators read events" on public.service_agreement_physical_signing_events;
create policy "Physical signing administrators read events"
on public.service_agreement_physical_signing_events for select to authenticated
using (public.has_any_role(array['Master Admin', 'Administrator']));

drop policy if exists "Physical signing administrators read files" on public.service_agreement_physical_files;
create policy "Physical signing administrators read files"
on public.service_agreement_physical_files for select to authenticated
using (public.has_any_role(array['Master Admin', 'Administrator']));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'signed-agreements',
  'signed-agreements',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies are added. Uploads and signed URLs are created by
-- authenticated server routes after checking the active administrative role.

create or replace function public.classify_electronic_service_agreement_signature()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.client_signed_at is null and new.client_signed_at is not null then
    if old.signing_method = 'physical' then
      raise exception 'A physically signed Agreement cannot receive an electronic signature.';
    end if;
    new.signing_method := 'electronic';
  end if;
  if old.signing_method is not null and new.signing_method is distinct from old.signing_method then
    raise exception 'The Agreement signing method is immutable.';
  end if;
  return new;
end;
$$;
revoke all on function public.classify_electronic_service_agreement_signature() from public, anon, authenticated;
drop trigger if exists classify_electronic_service_agreement_signature on public.service_agreements;
create trigger classify_electronic_service_agreement_signature
before update on public.service_agreements
for each row execute function public.classify_electronic_service_agreement_signature();

create or replace function public.protect_service_agreement_signing_provenance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  event_row public.service_agreement_physical_signing_events;
begin
  if new.signing_method is not distinct from old.signing_method
    and new.physically_signed_on is not distinct from old.physically_signed_on
    and new.physical_signed_uploaded_by is not distinct from old.physical_signed_uploaded_by
    and new.physical_signed_uploaded_by_name is not distinct from old.physical_signed_uploaded_by_name
    and new.physical_signed_uploaded_at is not distinct from old.physical_signed_uploaded_at
    and new.physical_signing_original_status is not distinct from old.physical_signing_original_status
    and new.physical_signing_event_id is not distinct from old.physical_signing_event_id then
    return new;
  end if;

  if new.signing_method = 'electronic'
    and old.client_signed_at is null and new.client_signed_at is not null
    and new.physically_signed_on is null and new.physical_signing_event_id is null then
    return new;
  end if;

  if new.signing_method <> 'physical' or new.physical_signing_event_id is null then
    raise exception 'Agreement signing provenance is immutable.';
  end if;

  select * into event_row from public.service_agreement_physical_signing_events
  where id = new.physical_signing_event_id and agreement_id = new.id;
  if not found
    or event_row.physically_signed_on is distinct from new.physically_signed_on
    or event_row.performed_by is distinct from new.physical_signed_uploaded_by
    or event_row.performed_by_name is distinct from new.physical_signed_uploaded_by_name
    or event_row.performed_at is distinct from new.physical_signed_uploaded_at then
    raise exception 'Agreement signing provenance does not match its audit event.';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_service_agreement_signing_provenance() from public, anon, authenticated;
drop trigger if exists protect_service_agreement_signing_provenance on public.service_agreements;
create trigger protect_service_agreement_signing_provenance
before update on public.service_agreements
for each row execute function public.protect_service_agreement_signing_provenance();

-- Extend the existing signed-agreement immutability guards to physical copies.
-- Physical intake intentionally leaves the electronic signature columns null,
-- so signing_method must also be treated as the durable signed marker.
create or replace function public.prevent_signed_agreement_material_changes()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if old.client_signed_at is not null or old.signing_method = 'physical' then
    if new.client_signed_snapshot is distinct from old.client_signed_snapshot
      or new.client_signed_name is distinct from old.client_signed_name
      or new.client_signature is distinct from old.client_signature
      or new.client_signed_at is distinct from old.client_signed_at
      or new.client_consent_text is distinct from old.client_consent_text
      or new.client_consent_at is distinct from old.client_consent_at
    then raise exception 'Signed acceptance data is immutable.';
    end if;
    if new.client_id is distinct from old.client_id
      or new.property_id is distinct from old.property_id
      or new.service_name is distinct from old.service_name
      or new.scope is distinct from old.scope
      or new.frequency is distinct from old.frequency
      or new.days_of_week is distinct from old.days_of_week
      or new.interval_weeks is distinct from old.interval_weeks
      or new.day_of_month is distinct from old.day_of_month
      or new.second_day_of_month is distinct from old.second_day_of_month
      or new.custom_interval_days is distinct from old.custom_interval_days
      or new.default_start_time is distinct from old.default_start_time
      or new.start_date is distinct from old.start_date
      or new.end_date is distinct from old.end_date
      or new.billing_type is distinct from old.billing_type
      or new.billing_amount is distinct from old.billing_amount
      or new.payment_terms is distinct from old.payment_terms
      or new.agreement_terms is distinct from old.agreement_terms
      or new.cancellation_terms is distinct from old.cancellation_terms
      or new.special_instructions is distinct from old.special_instructions
    then raise exception 'A signed Service Agreement cannot be materially changed. Cancel it and create a new agreement for revised terms.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_signed_upkeep_schedule_changes()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if (old.client_signed_at is not null or old.signing_method = 'physical')
    and new.third_day_of_month is distinct from old.third_day_of_month then
    raise exception 'A signed Service Agreement cannot be materially changed. Cancel it and create a new agreement for revised terms.';
  end if;
  return new;
end;
$$;

create or replace function public.finalize_physical_service_agreement(
  p_agreement_id uuid,
  p_event_id uuid,
  p_physically_signed_on date,
  p_required_client_signature_confirmed boolean,
  p_all_other_signatures_confirmed boolean,
  p_files jsonb,
  p_replace boolean default false
)
returns public.service_agreements
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.user_profiles;
  agreement_row public.service_agreements;
  result_row public.service_agreements;
  previous_event_id uuid;
  uploaded_at timestamptz := now();
  file_count integer;
  file_row record;
begin
  select * into actor from public.user_profiles where id = (select auth.uid()) and is_active for share;
  if not found or actor.role not in ('Master Admin', 'Administrator') then
    raise exception 'Physical Agreement signing requires an active Master Admin or Administrator account.' using errcode = '42501';
  end if;

  if p_physically_signed_on is null or p_physically_signed_on > current_date then
    raise exception 'Enter a valid physical signing date that is not in the future.';
  end if;
  if p_required_client_signature_confirmed is distinct from true
    or p_all_other_signatures_confirmed is distinct from true then
    raise exception 'Confirm that every required signature is present.';
  end if;
  if jsonb_typeof(p_files) <> 'array' then raise exception 'Signed Agreement files are required.'; end if;
  file_count := jsonb_array_length(p_files);
  if file_count < 1 or file_count > 20 then raise exception 'Upload between 1 and 20 signed Agreement files.'; end if;

  select * into agreement_row from public.service_agreements where id = p_agreement_id for update;
  if not found then raise exception 'Service Agreement not found.'; end if;
  if agreement_row.client_signed_at is not null or agreement_row.client_signature is not null
    or agreement_row.signing_method = 'electronic' then
    raise exception 'An electronically signed Agreement cannot be replaced by a physical signing event.';
  end if;

  previous_event_id := (
    select event.id from public.service_agreement_physical_signing_events event
    where event.agreement_id = agreement_row.id
    order by event.performed_at desc limit 1
  );

  if p_replace then
    if agreement_row.signing_method <> 'physical' or previous_event_id is null then
      raise exception 'There is no physical signed copy to replace.';
    end if;
  else
    if agreement_row.status <> 'Sent' or agreement_row.signing_method is not null or previous_event_id is not null then
      raise exception 'Only an unsigned Sent Agreement can be finalized from a physical copy.';
    end if;
  end if;

  for file_row in
    select * from jsonb_to_recordset(p_files) as item(
      id uuid,
      original_filename text,
      storage_path text,
      mime_type text,
      size_bytes bigint,
      page_order integer
    )
  loop
    if file_row.id is null
      or file_row.original_filename is null or char_length(file_row.original_filename) not between 1 and 255
      or file_row.mime_type not in ('application/pdf', 'image/jpeg', 'image/png')
      or file_row.size_bytes not between 1 and 26214400
      or file_row.page_order not between 1 and 20
      or file_row.storage_path <> format('agreements/%s/%s/%s/%s', agreement_row.id, p_event_id, file_row.id, regexp_replace(file_row.original_filename, '[^a-zA-Z0-9._-]+', '-', 'g'))
      or not exists (
        select 1 from storage.objects object
        where object.bucket_id = 'signed-agreements' and object.name = file_row.storage_path
      )
    then
      raise exception 'A signed Agreement file is invalid or was not uploaded successfully.';
    end if;
  end loop;

  if (select count(distinct (item->>'page_order')::integer) from jsonb_array_elements(p_files) item) <> file_count then
    raise exception 'Signed Agreement file order must be unique.';
  end if;

  insert into public.service_agreement_physical_signing_events (
    id, agreement_id, event_type, original_status, resulting_status,
    physically_signed_on, required_client_signature_confirmed,
    all_other_signatures_confirmed, performed_by, performed_by_name,
    performed_at, replaced_event_id, file_count, metadata
  ) values (
    p_event_id, agreement_row.id,
    case when p_replace then 'Physical Signed Copy Replaced' else 'Physical Signature Finalized' end,
    agreement_row.status,
    case when p_replace then agreement_row.status else 'Accepted' end,
    p_physically_signed_on, true, true, actor.id,
    coalesce(nullif(btrim(actor.display_name), ''), actor.email, 'Authorized Administrator'),
    uploaded_at, previous_event_id, file_count,
    jsonb_build_object('signing_method', 'physical')
  );

  if p_replace then
    update public.service_agreement_physical_files
    set archived_at = uploaded_at
    where agreement_id = agreement_row.id and archived_at is null;
  end if;

  insert into public.service_agreement_physical_files (
    id, agreement_id, signing_event_id, original_filename, storage_path,
    mime_type, size_bytes, page_order, uploaded_by, uploaded_by_name, uploaded_at
  )
  select item.id, agreement_row.id, p_event_id, item.original_filename,
    item.storage_path, item.mime_type, item.size_bytes, item.page_order,
    actor.id, coalesce(nullif(btrim(actor.display_name), ''), actor.email, 'Authorized Administrator'), uploaded_at
  from jsonb_to_recordset(p_files) as item(
    id uuid,
    original_filename text,
    storage_path text,
    mime_type text,
    size_bytes bigint,
    page_order integer
  );

  update public.service_agreements
  set status = case when p_replace then agreement_row.status else 'Accepted' end,
      accepted_at = case when p_replace then agreement_row.accepted_at else uploaded_at end,
      signing_method = 'physical',
      physically_signed_on = p_physically_signed_on,
      physical_signed_uploaded_by = actor.id,
      physical_signed_uploaded_by_name = coalesce(nullif(btrim(actor.display_name), ''), actor.email, 'Authorized Administrator'),
      physical_signed_uploaded_at = uploaded_at,
      physical_signing_original_status = coalesce(agreement_row.physical_signing_original_status, agreement_row.status),
      physical_signing_event_id = p_event_id,
      client_access_token = case when p_replace then agreement_row.client_access_token else null end,
      client_access_token_expires_at = case when p_replace then agreement_row.client_access_token_expires_at else null end
  where id = agreement_row.id
  returning * into result_row;

  return result_row;
end;
$$;

revoke all on function public.finalize_physical_service_agreement(uuid, uuid, date, boolean, boolean, jsonb, boolean)
from public, anon, authenticated;
grant execute on function public.finalize_physical_service_agreement(uuid, uuid, date, boolean, boolean, jsonb, boolean)
to authenticated;

notify pgrst, 'reload schema';
