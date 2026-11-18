alter table public.service_agreements add column monthly_week_ordinals integer[];

alter table public.service_agreements
  drop constraint service_agreements_twice_monthly_schedule_check,
  add constraint service_agreements_twice_monthly_schedule_check check (
    (frequency = 'Twice Monthly' and (
      (monthly_week_ordinals is null and day_of_month is not null and second_day_of_month is not null
        and day_of_month between 1 and 28 and second_day_of_month between 1 and 28
        and day_of_month <> second_day_of_month and third_day_of_month is null)
      or (monthly_week_ordinals is not null and day_of_month is null and second_day_of_month is null and third_day_of_month is null)
    ))
    or (service_name = 'StudioScrubz Upkeep Plan' and frequency = 'Monthly'
      and day_of_month is not null and second_day_of_month is not null and third_day_of_month is not null
      and day_of_month between 1 and 28 and second_day_of_month between 1 and 28 and third_day_of_month between 1 and 28
      and day_of_month <> second_day_of_month and day_of_month <> third_day_of_month and second_day_of_month <> third_day_of_month)
    or (frequency <> 'Twice Monthly' and service_name <> 'StudioScrubz Upkeep Plan'
      and second_day_of_month is null and third_day_of_month is null)
  ),
  add constraint service_agreements_monthly_week_ordinals_check check (
    monthly_week_ordinals is null or (
      frequency = 'Twice Monthly' and array_ndims(monthly_week_ordinals) = 1
      and array_lower(monthly_week_ordinals,1) = 1 and cardinality(monthly_week_ordinals) = 2
      and monthly_week_ordinals[1] between 1 and 4 and monthly_week_ordinals[2] between 1 and 4
      and monthly_week_ordinals[1] <> monthly_week_ordinals[2]
      and array_position(monthly_week_ordinals,null) is null
      and jsonb_typeof(days_of_week) = 'array' and jsonb_array_length(days_of_week) = 1
      and days_of_week->0 in ('0'::jsonb,'1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_signed_agreement_material_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      or new.monthly_week_ordinals is distinct from old.monthly_week_ordinals
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
$function$;

CREATE OR REPLACE FUNCTION public.get_service_agreement_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'This agreement link is invalid, expired, or no longer available.'; end if;
  select case when a.client_signed_snapshot is not null then
    a.client_signed_snapshot || jsonb_build_object(
      'status',a.status,
      'service_description',coalesce(nullif(a.client_signed_snapshot->>'service_description',''),nullif(a.pricing_snapshot->>'service_description',''),''),
      'client_signed_at',a.client_signed_at,'client_signed_name',a.client_signed_name,
      'client_signature',a.client_signature,'client_consent_text',a.client_consent_text,'client_consent_at',a.client_consent_at)
  else jsonb_build_object(
    'agreement_number',a.agreement_number,'status',a.status,
    'client_name',coalesce(c.company_name,nullif(concat_ws(' ',c.first_name,c.last_name),''),'Client'),
    'property_location',coalesce(p.property_name,p.address,'Service location'),
    'service_name',a.service_name,'service_description',coalesce(nullif(a.pricing_snapshot->>'service_description',''),''),
    'scope',coalesce((select string_agg(item.value->>'text',E'\n') from jsonb_array_elements(a.scope) item),''),
    'frequency',a.frequency,'days_of_week',a.days_of_week,'day_of_month',a.day_of_month,
    'monthly_week_ordinals', a.monthly_week_ordinals, 'second_day_of_month',a.second_day_of_month,'third_day_of_month',a.third_day_of_month,'custom_interval_days',a.custom_interval_days,
    'default_start_time',a.default_start_time,'start_date',a.start_date,'end_date',a.end_date,
    'billing_type',a.billing_type,'billing_amount',a.billing_amount,'pricing_snapshot',a.pricing_snapshot,
    'payment_terms',a.payment_terms,'agreement_terms',a.agreement_terms,'cancellation_terms',a.cancellation_terms,
    'special_instructions',a.special_instructions,'client_signed_at',null,'client_signed_name',null,
    'client_signature',null,'client_consent_text',null,'client_consent_at',null,
    'business_name',coalesce(bs.business_name,'StudioScrubz'),'tagline',bs.tagline,
    'business_email',bs.business_email,'business_phone',bs.business_phone,'website',bs.website,
    'address',bs.address,'city',bs.city,'state',bs.state,'zip',bs.zip)
  end into v_result
  from public.service_agreements a
  left join public.clients c on c.id=a.client_id
  left join public.properties p on p.id=a.property_id
  left join public.business_settings bs on true
  where a.client_access_token=p_token and a.archived_at is null
    and a.status in ('Sent','Accepted','Active','Paused')
    and (a.client_access_token_expires_at is null or a.client_access_token_expires_at>now())
  limit 1;
  if v_result is null then raise exception 'This agreement link is invalid, expired, or no longer available.'; end if;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_in_person_agreement_signing_session(p_agreement_id uuid, p_session_id uuid, p_token text)
 RETURNS TABLE(session_id uuid, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'monthly_week_ordinals', agreement_row.monthly_week_ordinals, 'second_day_of_month', agreement_row.second_day_of_month,
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
$function$;

CREATE OR REPLACE FUNCTION public.accept_service_agreement_by_token(p_token text, p_signed_name text, p_signature text, p_consent boolean, p_reviewed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'monthly_week_ordinals', a.monthly_week_ordinals, 'second_day_of_month', a.second_day_of_month, 'third_day_of_month', a.third_day_of_month,
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
$function$;

CREATE OR REPLACE FUNCTION public.representative_sign_service_agreement(p_agreement_id uuid, p_signed_name text, p_signature text, p_consent boolean, p_idempotency_key uuid)
 RETURNS service_agreement_representative_signing_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'monthly_week_ordinals', agreement_row.monthly_week_ordinals, 'second_day_of_month', agreement_row.second_day_of_month,
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
$function$;
