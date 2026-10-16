-- StudioScrubz representative electronic countersignatures.
-- Client signature evidence remains in its existing, independent fields.
begin;

create table public.service_agreement_representative_signing_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  agreement_id uuid not null unique references public.service_agreements(id) on delete restrict,
  signed_name text not null check (char_length(btrim(signed_name)) between 2 and 160),
  signature text not null,
  signature_hash text not null check (char_length(signature_hash) = 64),
  signed_by uuid not null references public.user_profiles(id) on delete restrict,
  signed_by_name text not null,
  signed_at timestamptz not null default now(),
  consent_text text not null,
  document_snapshot jsonb not null check (jsonb_typeof(document_snapshot) = 'object'),
  document_hash text not null check (char_length(document_hash) = 64)
);

create index service_agreement_representative_signing_events_actor_idx
  on public.service_agreement_representative_signing_events(signed_by, signed_at desc);

alter table public.service_agreement_representative_signing_events enable row level security;
revoke all on table public.service_agreement_representative_signing_events from public, anon, authenticated;
grant select on table public.service_agreement_representative_signing_events to authenticated;
create policy service_agreement_representative_signing_events_staff_read
on public.service_agreement_representative_signing_events for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.user_profiles profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
);

create function private.protect_representative_signing_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'StudioScrubz representative signature evidence is append-only.';
end;
$$;

create trigger service_agreement_representative_signing_events_append_only
before update or delete on public.service_agreement_representative_signing_events
for each row execute function private.protect_representative_signing_event();

create function private.protect_representative_signed_agreement_terms()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.service_agreement_representative_signing_events event
    where event.agreement_id = old.id
  ) and (
    new.client_id is distinct from old.client_id
    or new.property_id is distinct from old.property_id
    or new.proposal_id is distinct from old.proposal_id
    or new.division is distinct from old.division
    or new.agreement_name is distinct from old.agreement_name
    or new.service_name is distinct from old.service_name
    or new.scope is distinct from old.scope
    or new.frequency is distinct from old.frequency
    or new.days_of_week is distinct from old.days_of_week
    or new.interval_weeks is distinct from old.interval_weeks
    or new.day_of_month is distinct from old.day_of_month
    or new.second_day_of_month is distinct from old.second_day_of_month
    or new.third_day_of_month is distinct from old.third_day_of_month
    or new.custom_interval_days is distinct from old.custom_interval_days
    or new.start_date is distinct from old.start_date
    or new.end_date is distinct from old.end_date
    or new.auto_renew is distinct from old.auto_renew
    or new.billing_type is distinct from old.billing_type
    or new.billing_amount is distinct from old.billing_amount
    or new.pricing_snapshot is distinct from old.pricing_snapshot
    or new.payment_terms is distinct from old.payment_terms
    or new.agreement_terms is distinct from old.agreement_terms
    or new.cancellation_terms is distinct from old.cancellation_terms
    or new.special_instructions is distinct from old.special_instructions
  ) then
    raise exception 'A representative-signed Service Agreement cannot be materially changed. Cancel it and create a new agreement for revised terms.';
  end if;
  return new;
end;
$$;

create trigger protect_representative_signed_agreement_terms
before update on public.service_agreements
for each row execute function private.protect_representative_signed_agreement_terms();

create function public.representative_sign_service_agreement(
  p_agreement_id uuid,
  p_signed_name text,
  p_signature text,
  p_consent boolean,
  p_idempotency_key uuid
)
returns public.service_agreement_representative_signing_events
language plpgsql security definer set search_path = '' as $$
declare
  actor public.user_profiles;
  agreement_row public.service_agreements;
  event_row public.service_agreement_representative_signing_events;
  legal_name text := regexp_replace(btrim(coalesce(p_signed_name, '')), '[[:space:]]+', ' ', 'g');
  actor_name text;
  signature_hash text;
  snapshot jsonb;
  snapshot_hash text;
  consent_copy constant text := 'I confirm that I am authorized to sign for StudioScrubz, have reviewed the complete Service Agreement, and intend my drawn electronic signature to bind StudioScrubz to these terms.';
begin
  select * into actor from public.user_profiles
  where id = (select auth.uid()) and is_active
  for share;
  if not found or actor.role <> 'Master Admin' then
    raise exception 'Master Admin permission is required.' using errcode = '42501';
  end if;
  if p_agreement_id is null or p_idempotency_key is null then
    raise exception 'Agreement and idempotency identifiers are required.';
  end if;
  if char_length(legal_name) < 2 or char_length(legal_name) > 160 then
    raise exception 'Enter your full legal name.';
  end if;
  if p_consent is distinct from true then
    raise exception 'Representative signing consent is required.';
  end if;
  signature_hash := public.agreement_signature_png_hash(p_signature);

  perform pg_advisory_xact_lock(hashtextextended('representative-sign:' || p_idempotency_key::text, 0));
  select * into event_row from public.service_agreement_representative_signing_events
  where idempotency_key = p_idempotency_key;
  if found then
    if event_row.agreement_id is distinct from p_agreement_id
      or event_row.signed_name is distinct from legal_name
      or event_row.signature_hash is distinct from signature_hash then
      raise exception 'The signing idempotency key is already associated with different details.';
    end if;
    return event_row;
  end if;

  select * into agreement_row from public.service_agreements
  where id = p_agreement_id for update;
  if not found then raise exception 'Service Agreement not found.'; end if;
  if agreement_row.archived_at is not null
    or agreement_row.status not in ('Sent', 'Accepted', 'Active', 'Paused') then
    raise exception 'Only a current Sent, Accepted, Active, or Paused Service Agreement may be countersigned.';
  end if;
  if exists (
    select 1 from public.service_agreement_representative_signing_events
    where agreement_id = agreement_row.id
  ) then
    raise exception 'This Service Agreement has already been signed by StudioScrubz.';
  end if;

  snapshot := jsonb_build_object(
    'schema_version', 1,
    'agreement_id', agreement_row.id,
    'agreement_number', agreement_row.agreement_number,
    'client_id', agreement_row.client_id,
    'property_id', agreement_row.property_id,
    'proposal_id', agreement_row.proposal_id,
    'division', agreement_row.division,
    'agreement_name', agreement_row.agreement_name,
    'service_name', agreement_row.service_name,
    'scope', agreement_row.scope,
    'frequency', agreement_row.frequency,
    'days_of_week', agreement_row.days_of_week,
    'interval_weeks', agreement_row.interval_weeks,
    'day_of_month', agreement_row.day_of_month,
    'second_day_of_month', agreement_row.second_day_of_month,
    'third_day_of_month', agreement_row.third_day_of_month,
    'custom_interval_days', agreement_row.custom_interval_days,
    'start_date', agreement_row.start_date,
    'end_date', agreement_row.end_date,
    'auto_renew', agreement_row.auto_renew,
    'billing_type', agreement_row.billing_type,
    'billing_amount', agreement_row.billing_amount,
    'pricing_snapshot', agreement_row.pricing_snapshot,
    'payment_terms', agreement_row.payment_terms,
    'agreement_terms', agreement_row.agreement_terms,
    'cancellation_terms', agreement_row.cancellation_terms,
    'special_instructions', agreement_row.special_instructions
  );
  snapshot_hash := encode(extensions.digest(convert_to(snapshot::text, 'UTF8'), 'sha256'), 'hex');
  actor_name := coalesce(nullif(btrim(actor.display_name), ''), actor.email, 'Master Admin');

  insert into public.service_agreement_representative_signing_events(
    idempotency_key, agreement_id, signed_name, signature, signature_hash,
    signed_by, signed_by_name, consent_text, document_snapshot, document_hash
  ) values (
    p_idempotency_key, agreement_row.id, legal_name, p_signature, signature_hash,
    actor.id, actor_name, consent_copy, snapshot, snapshot_hash
  ) returning * into event_row;
  return event_row;
end;
$$;

create function public.get_representative_agreement_signature_by_token(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when event.id is null then null else jsonb_build_object(
    'id', event.id,
    'agreement_id', event.agreement_id,
    'signed_name', event.signed_name,
    'signature', event.signature,
    'signed_by_name', event.signed_by_name,
    'signed_at', event.signed_at,
    'consent_text', event.consent_text,
    'document_hash', event.document_hash
  ) end
  from public.service_agreements agreement
  left join public.service_agreement_representative_signing_events event
    on event.agreement_id = agreement.id
  where p_token is not null and char_length(p_token) >= 32
    and agreement.client_access_token = p_token
    and agreement.archived_at is null
    and agreement.status in ('Sent', 'Accepted', 'Active', 'Paused')
    and (agreement.client_access_token_expires_at is null or agreement.client_access_token_expires_at > now())
  limit 1;
$$;

revoke all on function public.representative_sign_service_agreement(uuid,text,text,boolean,uuid)
from public, anon, authenticated;
grant execute on function public.representative_sign_service_agreement(uuid,text,text,boolean,uuid)
to authenticated;
revoke all on function public.get_representative_agreement_signature_by_token(text)
from public, anon, authenticated;
grant execute on function public.get_representative_agreement_signature_by_token(text)
to anon, authenticated;
revoke all on function private.protect_representative_signing_event()
from public, anon, authenticated;
revoke all on function private.protect_representative_signed_agreement_terms()
from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
