-- StudioScrubz OS: expose the Agreement service-description snapshot.
-- REVIEW ONLY. Do not execute automatically.
-- No schema change is required: service_description is stored in the existing
-- immutable service_agreements.pricing_snapshot JSONB document.

create or replace function public.get_service_agreement_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This agreement link is invalid, expired, or no longer available.';
  end if;

  select case when a.client_signed_snapshot is not null then
    a.client_signed_snapshot || jsonb_build_object(
      'status', a.status,
      'service_description', coalesce(
        nullif(a.client_signed_snapshot ->> 'service_description', ''),
        nullif(a.pricing_snapshot ->> 'service_description', ''),
        ''
      ),
      'client_signed_at', a.client_signed_at,
      'client_signed_name', a.client_signed_name,
      'client_signature', a.client_signature,
      'client_consent_text', a.client_consent_text,
      'client_consent_at', a.client_consent_at
    )
  else jsonb_build_object(
    'agreement_number', a.agreement_number,
    'status', a.status,
    'client_name', coalesce(c.company_name, nullif(concat_ws(' ', c.first_name, c.last_name), ''), 'Client'),
    'property_location', coalesce(p.property_name, p.address, 'Service location'),
    'service_name', a.service_name,
    'service_description', coalesce(nullif(a.pricing_snapshot ->> 'service_description', ''), ''),
    'scope', coalesce((select string_agg(item.value ->> 'text', E'\n') from jsonb_array_elements(a.scope) item), ''),
    'frequency', a.frequency,
    'days_of_week', a.days_of_week,
    'day_of_month', a.day_of_month,
    'custom_interval_days', a.custom_interval_days,
    'default_start_time', a.default_start_time,
    'start_date', a.start_date,
    'end_date', a.end_date,
    'billing_type', a.billing_type,
    'billing_amount', a.billing_amount,
    'pricing_snapshot', a.pricing_snapshot,
    'payment_terms', a.payment_terms,
    'agreement_terms', a.agreement_terms,
    'cancellation_terms', a.cancellation_terms,
    'special_instructions', a.special_instructions,
    'client_signed_at', null,
    'client_signed_name', null,
    'client_signature', null,
    'client_consent_text', null,
    'client_consent_at', null,
    'business_name', coalesce(bs.business_name, 'StudioScrubz'),
    'tagline', bs.tagline,
    'business_email', bs.business_email,
    'business_phone', bs.business_phone,
    'website', bs.website,
    'address', bs.address,
    'city', bs.city,
    'state', bs.state,
    'zip', bs.zip
  ) end into v_result
  from public.service_agreements a
  left join public.clients c on c.id = a.client_id
  left join public.properties p on p.id = a.property_id
  left join public.business_settings bs on true
  where a.client_access_token = p_token
    and a.archived_at is null
    and a.status in ('Sent', 'Accepted', 'Active', 'Paused')
    and (a.client_access_token_expires_at is null or a.client_access_token_expires_at > now())
  limit 1;

  if v_result is null then
    raise exception 'This agreement link is invalid, expired, or no longer available.';
  end if;
  return v_result;
end;
$$;

create or replace function public.accept_service_agreement_by_token(
  p_token text,
  p_signed_name text,
  p_signature text,
  p_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_signed_name, ''));
  v_signature text := btrim(coalesce(p_signature, ''));
  v_consent_text constant text := 'I have reviewed and agree to the terms of this Service Agreement.';
  v_snapshot jsonb;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'This agreement link is invalid, expired, or no longer available.'; end if;
  if p_consent is distinct from true then raise exception 'Explicit consent is required to sign this Service Agreement.'; end if;
  if length(v_name) < 2 or length(v_name) > 150 then raise exception 'Enter a valid full legal name.'; end if;
  if v_signature <> ('/s/ ' || v_name) then raise exception 'The typed signature is invalid.'; end if;

  select jsonb_build_object(
    'agreement_number', a.agreement_number,
    'client_name', coalesce(c.company_name, nullif(concat_ws(' ', c.first_name, c.last_name), ''), 'Client'),
    'property_location', coalesce(p.property_name, p.address, 'Service location'),
    'service_name', a.service_name,
    'service_description', coalesce(nullif(a.pricing_snapshot ->> 'service_description', ''), ''),
    'scope', coalesce((select string_agg(item.value ->> 'text', E'\n') from jsonb_array_elements(a.scope) item), ''),
    'frequency', a.frequency,
    'days_of_week', a.days_of_week,
    'day_of_month', a.day_of_month,
    'custom_interval_days', a.custom_interval_days,
    'default_start_time', a.default_start_time,
    'start_date', a.start_date,
    'end_date', a.end_date,
    'billing_type', a.billing_type,
    'billing_amount', a.billing_amount,
    'pricing_snapshot', a.pricing_snapshot,
    'payment_terms', a.payment_terms,
    'agreement_terms', a.agreement_terms,
    'cancellation_terms', a.cancellation_terms,
    'special_instructions', a.special_instructions,
    'business_name', coalesce(bs.business_name, 'StudioScrubz'),
    'tagline', bs.tagline,
    'business_email', bs.business_email,
    'business_phone', bs.business_phone,
    'website', bs.website,
    'address', bs.address,
    'city', bs.city,
    'state', bs.state,
    'zip', bs.zip
  ) into v_snapshot
  from public.service_agreements a
  left join public.clients c on c.id = a.client_id
  left join public.properties p on p.id = a.property_id
  left join public.business_settings bs on true
  where a.client_access_token = p_token
    and a.archived_at is null
    and a.status = 'Sent'
    and a.client_signed_at is null
    and (a.client_access_token_expires_at is null or a.client_access_token_expires_at > now())
  limit 1 for update of a;

  if v_snapshot is null then
    raise exception 'This agreement cannot be signed because it is invalid, expired, revoked, already signed, or no longer awaiting acceptance.';
  end if;

  update public.service_agreements set
    client_signed_name = v_name,
    client_signature = v_signature,
    client_signed_at = now(),
    accepted_at = now(),
    client_consent_text = v_consent_text,
    client_consent_at = now(),
    client_signed_snapshot = v_snapshot,
    status = 'Accepted'
  where client_access_token = p_token
    and archived_at is null
    and status = 'Sent'
    and client_signed_at is null;

  return public.get_service_agreement_by_token(p_token);
end;
$$;

revoke all on function public.get_service_agreement_by_token(text) from public, anon, authenticated;
revoke all on function public.accept_service_agreement_by_token(text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.get_service_agreement_by_token(text) to anon, authenticated;
grant execute on function public.accept_service_agreement_by_token(text,text,text,boolean) to anon, authenticated;

notify pgrst, 'reload schema';
