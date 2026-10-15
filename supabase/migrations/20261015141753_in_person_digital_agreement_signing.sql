-- StudioScrubz OS: short-lived, witnessed, in-person digital signing.
-- Depends on the already-applied 20261014170443_physical_signed_agreements.sql.

alter table public.service_agreements
  drop constraint if exists service_agreements_signing_method_check;
alter table public.service_agreements
  add constraint service_agreements_signing_method_check
  check (signing_method is null or signing_method in ('electronic', 'physical', 'in_person_digital'));

alter table public.service_agreements
  add column if not exists in_person_witnessed_by uuid references public.user_profiles(id) on delete set null,
  add column if not exists in_person_witnessed_by_name text,
  add column if not exists in_person_signing_session_id uuid;

create table public.service_agreement_in_person_signing_sessions (
  id uuid primary key,
  agreement_id uuid not null references public.service_agreements(id) on delete restrict,
  token_hash text not null unique check (char_length(token_hash) = 64),
  agreement_snapshot jsonb not null,
  witnessed_by uuid references public.user_profiles(id) on delete set null,
  witnessed_by_name text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  revoked_at timestamptz,
  client_signed_name text,
  consent_text text,
  constraint service_agreement_in_person_session_expiry check (expires_at > created_at),
  constraint service_agreement_in_person_session_completion check (
    (completed_at is null and client_signed_name is null and consent_text is null)
    or (completed_at is not null and client_signed_name is not null and consent_text is not null)
  )
);

create index service_agreement_in_person_sessions_agreement_idx
  on public.service_agreement_in_person_signing_sessions(agreement_id, created_at desc);

-- A short-lived receipt proves that the server decoded the PNG and found real
-- ink before either public completion RPC may accept it. The public roles have
-- no table access and cannot create their own validation receipts.
create table public.service_agreement_validated_signatures (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null check (char_length(token_hash) = 64),
  signature_hash text not null check (char_length(signature_hash) = 64),
  signing_context text not null check (signing_context in ('electronic', 'in_person_digital')),
  validated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz,
  constraint service_agreement_validated_signature_expiry check (expires_at > validated_at)
);

create index service_agreement_validated_signatures_lookup_idx
  on public.service_agreement_validated_signatures(token_hash, signature_hash, signing_context)
  where consumed_at is null;

alter table public.service_agreement_validated_signatures enable row level security;
revoke all on table public.service_agreement_validated_signatures from public, anon, authenticated;

create function public.agreement_signature_png_hash(p_signature text)
returns text
language plpgsql immutable security invoker set search_path = ''
as $$
declare
  encoded text;
  png bytea;
  width bigint;
  height bigint;
begin
  if p_signature is null or char_length(p_signature) < 200
    or char_length(p_signature) > 700000
    or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'The drawn signature must be a valid PNG image.';
  end if;
  encoded := substring(p_signature from 23);
  begin
    png := decode(encoded, 'base64');
  exception when others then
    raise exception 'The drawn signature must be a valid PNG image.';
  end;
  if octet_length(png) < 45
    or substring(png from 1 for 8) <> decode('89504e470d0a1a0a', 'hex')
    or substring(png from 13 for 4) <> convert_to('IHDR', 'UTF8')
    or position(convert_to('IDAT', 'UTF8') in png) = 0
    or substring(png from octet_length(png) - 11 for 12) <> decode('0000000049454e44ae426082', 'hex') then
    raise exception 'The drawn signature must be a valid PNG image.';
  end if;
  width := get_byte(png, 16)::bigint * 16777216 + get_byte(png, 17)::bigint * 65536
    + get_byte(png, 18)::bigint * 256 + get_byte(png, 19);
  height := get_byte(png, 20)::bigint * 16777216 + get_byte(png, 21)::bigint * 65536
    + get_byte(png, 22)::bigint * 256 + get_byte(png, 23);
  if width < 240 or height < 80 or width > 2400 or height > 1200 then
    raise exception 'The drawn signature image has invalid dimensions.';
  end if;
  return encode(extensions.digest(png, 'sha256'), 'hex');
end;
$$;

create function public.register_validated_agreement_signature(
  p_token text,
  p_signature text,
  p_signing_context text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare receipt_id uuid;
begin
  if p_token is null or char_length(p_token) < 32 then raise exception 'A valid signing token is required.'; end if;
  if p_signing_context not in ('electronic', 'in_person_digital') then raise exception 'The signing context is invalid.'; end if;
  if p_signing_context = 'electronic' and not exists (
    select 1 from public.service_agreements
    where client_access_token = p_token and archived_at is null and status = 'Sent'
      and client_signed_at is null and client_signature is null and signing_method is null
      and (client_access_token_expires_at is null or client_access_token_expires_at > now())
  ) then
    raise exception 'This agreement link is invalid, expired, or no longer available.';
  end if;
  if p_signing_context = 'in_person_digital' and not exists (
    select 1 from public.service_agreement_in_person_signing_sessions
    where token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
      and completed_at is null and revoked_at is null and expires_at > now()
  ) then
    raise exception 'This in-person signing session is invalid or expired.';
  end if;
  insert into public.service_agreement_validated_signatures(token_hash, signature_hash, signing_context)
  values (
    encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex'),
    public.agreement_signature_png_hash(p_signature),
    p_signing_context
  ) returning id into receipt_id;
  return receipt_id;
end;
$$;

alter table public.service_agreements
  add constraint service_agreements_in_person_signing_session_id_fkey
  foreign key (in_person_signing_session_id)
  references public.service_agreement_in_person_signing_sessions(id) on delete restrict;

alter table public.service_agreement_in_person_signing_sessions enable row level security;
revoke all on table public.service_agreement_in_person_signing_sessions from public, anon, authenticated;

create or replace function public.create_in_person_agreement_signing_session(
  p_agreement_id uuid,
  p_session_id uuid,
  p_token text
)
returns table(session_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.user_profiles;
  agreement_row public.service_agreements;
  snapshot jsonb;
  session_expiry timestamptz := now() + interval '15 minutes';
begin
  select * into actor
  from public.user_profiles
  where id = (select auth.uid()) and is_active
  for share;
  if not found or actor.role not in ('Master Admin', 'Administrator', 'Manager') then
    raise exception 'Agreement management permission is required.' using errcode = '42501';
  end if;
  if p_session_id is null or p_token is null or length(p_token) < 43 then
    raise exception 'A secure signing session token is required.';
  end if;

  select * into agreement_row
  from public.service_agreements
  where id = p_agreement_id
  for update;
  if not found then raise exception 'Service Agreement not found.'; end if;
  if agreement_row.archived_at is not null or agreement_row.status <> 'Sent'
    or agreement_row.signing_method is not null or agreement_row.client_signed_at is not null
    or agreement_row.client_signature is not null then
    raise exception 'Only an unsigned, non-archived Sent Agreement can be signed in person.';
  end if;

  select jsonb_build_object(
    'agreement_number', agreement_row.agreement_number,
    'status', agreement_row.status,
    'client_name', coalesce(c.company_name, nullif(concat_ws(' ', c.first_name, c.last_name), ''), 'Client'),
    'property_location', coalesce(p.property_name, p.address, 'Service location'),
    'service_name', agreement_row.service_name,
    'service_description', coalesce(nullif(agreement_row.pricing_snapshot->>'service_description', ''), ''),
    'scope', coalesce((select string_agg(item.value->>'text', E'\n') from jsonb_array_elements(agreement_row.scope) item), ''),
    'frequency', agreement_row.frequency,
    'days_of_week', agreement_row.days_of_week,
    'day_of_month', agreement_row.day_of_month,
    'second_day_of_month', agreement_row.second_day_of_month,
    'third_day_of_month', agreement_row.third_day_of_month,
    'custom_interval_days', agreement_row.custom_interval_days,
    'default_start_time', agreement_row.default_start_time,
    'start_date', agreement_row.start_date,
    'end_date', agreement_row.end_date,
    'billing_type', agreement_row.billing_type,
    'billing_amount', agreement_row.billing_amount,
    'pricing_snapshot', agreement_row.pricing_snapshot,
    'payment_terms', agreement_row.payment_terms,
    'agreement_terms', agreement_row.agreement_terms,
    'cancellation_terms', agreement_row.cancellation_terms,
    'special_instructions', agreement_row.special_instructions,
    'client_signed_at', null,
    'client_signed_name', null,
    'client_signature', null,
    'client_consent_text', null,
    'client_consent_at', null,
    'signing_method', null,
    'in_person_witnessed_by_name', coalesce(nullif(btrim(actor.display_name), ''), actor.email, 'Authorized Representative'),
    'business_name', coalesce(bs.business_name, 'StudioScrubz'),
    'tagline', bs.tagline,
    'business_email', bs.business_email,
    'business_phone', bs.business_phone,
    'website', bs.website,
    'address', bs.address,
    'city', bs.city,
    'state', bs.state,
    'zip', bs.zip
  ) into snapshot
  from public.clients c
  left join public.properties p on p.id = agreement_row.property_id
  left join public.business_settings bs on true
  where c.id = agreement_row.client_id
  limit 1;
  if snapshot is null then raise exception 'Agreement client details could not be loaded.'; end if;

  update public.service_agreement_in_person_signing_sessions
  set revoked_at = now()
  where agreement_id = agreement_row.id and completed_at is null and revoked_at is null;

  insert into public.service_agreement_in_person_signing_sessions(
    id, agreement_id, token_hash, agreement_snapshot, witnessed_by,
    witnessed_by_name, expires_at
  ) values (
    p_session_id, agreement_row.id,
    encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), snapshot, actor.id,
    coalesce(nullif(btrim(actor.display_name), ''), actor.email, 'Authorized Representative'),
    session_expiry
  );

  return query select p_session_id, session_expiry;
end;
$$;

create or replace function public.get_in_person_agreement_signing_session(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare session_row public.service_agreement_in_person_signing_sessions;
begin
  if p_token is null or length(p_token) < 43 then raise exception 'This signing session is invalid.'; end if;
  select * into session_row
  from public.service_agreement_in_person_signing_sessions
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and revoked_at is null
  limit 1;
  if not found or session_row.expires_at <= now() then
    raise exception 'This in-person signing session is invalid or expired.';
  end if;
  return session_row.agreement_snapshot || jsonb_build_object(
    'session_expires_at', session_row.expires_at,
    'session_completed_at', session_row.completed_at
  );
end;
$$;

create or replace function public.complete_in_person_agreement_signature(
  p_token text,
  p_signed_name text,
  p_signature text,
  p_consent boolean,
  p_reviewed boolean
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  session_row public.service_agreement_in_person_signing_sessions;
  validation_row public.service_agreement_validated_signatures;
  agreement_row public.service_agreements;
  signed_at timestamptz := now();
  legal_name text := regexp_replace(btrim(coalesce(p_signed_name, '')), '[[:space:]]+', ' ', 'g');
  consent_copy text := 'I have reviewed the complete Service Agreement, agree to its terms, and consent to use my drawn electronic signature for this in-person signing.';
begin
  if p_token is null or length(p_token) < 43 then raise exception 'This signing session is invalid.'; end if;
  if char_length(legal_name) < 2 or char_length(legal_name) > 160 then raise exception 'Enter your full legal name.'; end if;
  if p_consent is distinct from true or p_reviewed is distinct from true then
    raise exception 'Review the complete Agreement and consent to electronic signing.';
  end if;

  select * into validation_row
  from public.service_agreement_validated_signatures
  where token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and signature_hash = public.agreement_signature_png_hash(p_signature)
    and signing_context = 'in_person_digital'
    and consumed_at is null and expires_at > signed_at
  order by validated_at desc limit 1 for update skip locked;
  if not found then raise exception 'The drawn signature has not passed server validation or has expired.'; end if;

  select * into session_row
  from public.service_agreement_in_person_signing_sessions
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  for update;
  if not found or session_row.revoked_at is not null or session_row.expires_at <= signed_at then
    raise exception 'This in-person signing session is invalid or expired.';
  end if;
  if session_row.completed_at is not null then raise exception 'This Agreement has already been signed.'; end if;

  select * into agreement_row from public.service_agreements
  where id = session_row.agreement_id for update;
  if not found or agreement_row.archived_at is not null or agreement_row.status <> 'Sent'
    or agreement_row.signing_method is not null or agreement_row.client_signed_at is not null
    or agreement_row.client_signature is not null then
    raise exception 'This Agreement is no longer eligible for in-person signing.';
  end if;

  update public.service_agreements
  set client_signed_name = legal_name,
      client_signature = p_signature,
      client_signed_at = signed_at,
      accepted_at = signed_at,
      client_consent_text = consent_copy,
      client_consent_at = signed_at,
      client_signed_snapshot = session_row.agreement_snapshot,
      signing_method = 'in_person_digital',
      in_person_witnessed_by = session_row.witnessed_by,
      in_person_witnessed_by_name = session_row.witnessed_by_name,
      in_person_signing_session_id = session_row.id,
      status = 'Accepted',
      client_access_token = null,
      client_access_token_expires_at = null
  where id = agreement_row.id;

  update public.service_agreement_in_person_signing_sessions
  set completed_at = signed_at, client_signed_name = legal_name, consent_text = consent_copy
  where id = session_row.id;

  update public.service_agreement_validated_signatures set consumed_at = signed_at where id = validation_row.id;

  return session_row.agreement_snapshot || jsonb_build_object(
    'status', 'Accepted',
    'client_signed_name', legal_name,
    'client_signature', p_signature,
    'client_signed_at', signed_at,
    'client_consent_text', consent_copy,
    'client_consent_at', signed_at,
    'signing_method', 'in_person_digital',
    'in_person_witnessed_by_name', session_row.witnessed_by_name,
    'session_expires_at', session_row.expires_at,
    'session_completed_at', signed_at
  );
end;
$$;

-- Replace the legacy typed-name acceptance overload. Keeping the four-argument
-- overload would let callers bypass drawn-signature and review validation.
revoke all on function public.accept_service_agreement_by_token(text, text, text, boolean) from public, anon, authenticated;
-- Deliberately omit CASCADE so an unexpected dependency aborts the migration
-- instead of silently removing another database object.
drop function public.accept_service_agreement_by_token(text, text, text, boolean);

create function public.accept_service_agreement_by_token(
  p_token text,
  p_signed_name text,
  p_signature text,
  p_consent boolean,
  p_reviewed boolean
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_signed_name, '')), '[[:space:]]+', ' ', 'g');
  v_consent_text constant text := 'I have reviewed the complete Service Agreement, agree to its terms, and consent to use my drawn electronic signature.';
  v_snapshot jsonb;
  v_validation public.service_agreement_validated_signatures;
  v_signed_at timestamptz := now();
begin
  if p_token is null or length(p_token) < 32 then raise exception 'This agreement link is invalid, expired, or no longer available.'; end if;
  if p_consent is distinct from true or p_reviewed is distinct from true then
    raise exception 'Review the complete Agreement and consent to electronic signing.';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 160 then raise exception 'Enter a valid full legal name.'; end if;

  select * into v_validation
  from public.service_agreement_validated_signatures
  where token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and signature_hash = public.agreement_signature_png_hash(p_signature)
    and signing_context = 'electronic'
    and consumed_at is null and expires_at > v_signed_at
  order by validated_at desc limit 1 for update skip locked;
  if not found then raise exception 'The drawn signature has not passed server validation or has expired.'; end if;

  select jsonb_build_object(
    'agreement_number', a.agreement_number,
    'client_name', coalesce(c.company_name, nullif(concat_ws(' ', c.first_name, c.last_name), ''), 'Client'),
    'property_location', coalesce(p.property_name, p.address, 'Service location'),
    'service_name', a.service_name,
    'service_description', coalesce(nullif(a.pricing_snapshot->>'service_description', ''), ''),
    'scope', coalesce((select string_agg(item.value->>'text', E'\n') from jsonb_array_elements(a.scope) item), ''),
    'frequency', a.frequency, 'days_of_week', a.days_of_week, 'day_of_month', a.day_of_month,
    'second_day_of_month', a.second_day_of_month, 'third_day_of_month', a.third_day_of_month,
    'custom_interval_days', a.custom_interval_days, 'default_start_time', a.default_start_time,
    'start_date', a.start_date, 'end_date', a.end_date, 'billing_type', a.billing_type,
    'billing_amount', a.billing_amount, 'pricing_snapshot', a.pricing_snapshot,
    'payment_terms', a.payment_terms, 'agreement_terms', a.agreement_terms,
    'cancellation_terms', a.cancellation_terms, 'special_instructions', a.special_instructions,
    'business_name', coalesce(bs.business_name, 'StudioScrubz'), 'tagline', bs.tagline,
    'business_email', bs.business_email, 'business_phone', bs.business_phone,
    'website', bs.website, 'address', bs.address, 'city', bs.city, 'state', bs.state, 'zip', bs.zip
  ) into v_snapshot
  from public.service_agreements a
  left join public.clients c on c.id = a.client_id
  left join public.properties p on p.id = a.property_id
  left join public.business_settings bs on true
  where a.client_access_token = p_token and a.archived_at is null and a.status = 'Sent'
    and a.client_signed_at is null and a.client_signature is null and a.signing_method is null
    and (a.client_access_token_expires_at is null or a.client_access_token_expires_at > now())
  limit 1 for update of a;
  if v_snapshot is null then
    raise exception 'This agreement cannot be signed because it is invalid, expired, revoked, already signed, or no longer awaiting acceptance.';
  end if;

  update public.service_agreements
  set client_signed_name = v_name,
      client_signature = p_signature,
      client_signed_at = v_signed_at,
      accepted_at = v_signed_at,
      client_consent_text = v_consent_text,
      client_consent_at = v_signed_at,
      client_signed_snapshot = v_snapshot,
      signing_method = 'electronic',
      status = 'Accepted'
  where client_access_token = p_token and archived_at is null and status = 'Sent'
    and client_signed_at is null and client_signature is null and signing_method is null;

  if not found then raise exception 'This Agreement is no longer eligible for electronic signing.'; end if;
  update public.service_agreement_validated_signatures set consumed_at = v_signed_at where id = v_validation.id;
  return public.get_service_agreement_by_token(p_token);
end;
$$;

create or replace function public.classify_electronic_service_agreement_signature()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.client_signed_at is null and new.client_signed_at is not null then
    if old.signing_method = 'physical' then
      raise exception 'A physically signed Agreement cannot receive an electronic signature.';
    end if;
    if new.signing_method is null then new.signing_method := 'electronic'; end if;
    if new.signing_method not in ('electronic', 'in_person_digital') then
      raise exception 'The Agreement signing method is invalid.';
    end if;
  end if;
  if old.signing_method is not null and new.signing_method is distinct from old.signing_method then
    raise exception 'The Agreement signing method is immutable.';
  end if;
  return new;
end;
$$;

create or replace function public.protect_service_agreement_signing_provenance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  physical_event public.service_agreement_physical_signing_events;
  in_person_session public.service_agreement_in_person_signing_sessions;
begin
  if new.signing_method is not distinct from old.signing_method
    and new.physically_signed_on is not distinct from old.physically_signed_on
    and new.physical_signed_uploaded_by is not distinct from old.physical_signed_uploaded_by
    and new.physical_signed_uploaded_by_name is not distinct from old.physical_signed_uploaded_by_name
    and new.physical_signed_uploaded_at is not distinct from old.physical_signed_uploaded_at
    and new.physical_signing_original_status is not distinct from old.physical_signing_original_status
    and new.physical_signing_event_id is not distinct from old.physical_signing_event_id
    and new.in_person_witnessed_by is not distinct from old.in_person_witnessed_by
    and new.in_person_witnessed_by_name is not distinct from old.in_person_witnessed_by_name
    and new.in_person_signing_session_id is not distinct from old.in_person_signing_session_id then
    return new;
  end if;
  if new.signing_method = 'electronic' and old.client_signed_at is null
    and new.client_signed_at is not null and new.physically_signed_on is null
    and new.physical_signing_event_id is null and new.in_person_signing_session_id is null then return new;
  end if;
  if new.signing_method = 'in_person_digital' and old.client_signed_at is null
    and new.client_signed_at is not null and new.in_person_signing_session_id is not null then
    select * into in_person_session from public.service_agreement_in_person_signing_sessions
    where id = new.in_person_signing_session_id and agreement_id = new.id;
    if not found or in_person_session.witnessed_by is distinct from new.in_person_witnessed_by
      or in_person_session.witnessed_by_name is distinct from new.in_person_witnessed_by_name
      or in_person_session.agreement_snapshot is distinct from new.client_signed_snapshot then
      raise exception 'In-person signing provenance does not match its secure session.';
    end if;
    return new;
  end if;
  if new.signing_method <> 'physical' or new.physical_signing_event_id is null then
    raise exception 'Agreement signing provenance is immutable.';
  end if;
  select * into physical_event from public.service_agreement_physical_signing_events
  where id = new.physical_signing_event_id and agreement_id = new.id;
  if not found or physical_event.physically_signed_on is distinct from new.physically_signed_on
    or physical_event.performed_by is distinct from new.physical_signed_uploaded_by
    or physical_event.performed_by_name is distinct from new.physical_signed_uploaded_by_name
    or physical_event.performed_at is distinct from new.physical_signed_uploaded_at then
    raise exception 'Agreement signing provenance does not match its audit event.';
  end if;
  return new;
end;
$$;

revoke all on function public.create_in_person_agreement_signing_session(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_in_person_agreement_signing_session(uuid, uuid, text) to authenticated;
revoke all on function public.get_in_person_agreement_signing_session(text) from public, anon, authenticated;
grant execute on function public.get_in_person_agreement_signing_session(text) to anon, authenticated;
revoke all on function public.complete_in_person_agreement_signature(text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.complete_in_person_agreement_signature(text, text, text, boolean, boolean) to anon, authenticated;
revoke all on function public.agreement_signature_png_hash(text) from public, anon, authenticated;
grant execute on function public.agreement_signature_png_hash(text) to service_role;
revoke all on function public.register_validated_agreement_signature(text, text, text) from public, anon, authenticated;
grant execute on function public.register_validated_agreement_signature(text, text, text) to service_role;
revoke all on function public.accept_service_agreement_by_token(text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.accept_service_agreement_by_token(text, text, text, boolean, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
