-- StudioScrubz OS: secure public Estimate walkthrough requests.
-- REVIEW ONLY. Do not execute automatically.
-- Run after estimate_proposal_delivery.sql and the current Walkthrough/Auth migrations.

-- Public Estimate reads remain token-scoped and return only the frozen client
-- snapshot plus safe live delivery/request state. No internal identifiers leave this RPC.
create or replace function public.get_estimate_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This estimate link is invalid, expired, or no longer available.';
  end if;

  select e.client_delivery_snapshot || jsonb_build_object(
    'status', e.status,
    'sent_at', e.sent_at,
    'walkthrough_requested', (w.id is not null),
    'walkthrough_requested_at', coalesce(w.measurements ->> 'requestedAt', w.created_at::text),
    'walkthrough_preferred_contact_method', w.measurements ->> 'preferredContactMethod',
    'business_name', coalesce(bs.business_name, 'StudioScrubz'),
    'tagline', bs.tagline,
    'business_email', bs.business_email,
    'business_phone', bs.business_phone,
    'website', bs.website,
    'address', bs.address,
    'city', bs.city,
    'state', bs.state,
    'zip', bs.zip
  ) into v_result
  from public.estimates e
  left join public.business_settings bs on true
  left join lateral (
    select wt.id, wt.measurements, wt.created_at
    from public.walkthroughs wt
    where wt.estimate_id = e.id and wt.archived_at is null
    order by wt.created_at desc
    limit 1
  ) w on true
  where e.client_access_token = p_token
    and e.archived_at is null
    and e.status = 'Open'
    and e.client_delivery_snapshot is not null
    and (e.client_access_token_expires_at is null or e.client_access_token_expires_at > now())
  limit 1;

  if v_result is null then
    raise exception 'This estimate link is invalid, expired, or no longer available.';
  end if;
  return v_result;
end;
$$;

create or replace function public.request_estimate_walkthrough_by_token(
  p_token text,
  p_client_name text,
  p_email text default null,
  p_phone text default null,
  p_preferred_contact_method text default 'Phone'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estimate public.estimates%rowtype;
  v_existing public.walkthroughs%rowtype;
  v_created public.walkthroughs%rowtype;
  v_name text := btrim(coalesce(p_client_name, ''));
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_method text := btrim(coalesce(p_preferred_contact_method, ''));
  v_requested_at timestamptz := now();
  v_scope jsonb := '[]'::jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This estimate link is invalid, expired, or no longer available.';
  end if;
  if length(v_name) < 2 or length(v_name) > 150 then
    raise exception 'Enter a valid client name.';
  end if;
  if v_method not in ('Phone', 'Text', 'Email') then
    raise exception 'Choose Phone, Text, or Email as the preferred contact method.';
  end if;
  if v_email is not null and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if v_phone is not null and length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7 then
    raise exception 'Enter a valid phone number.';
  end if;
  if (v_method = 'Email' and v_email is null)
    or (v_method in ('Phone', 'Text') and v_phone is null) then
    raise exception 'Provide a valid contact value for the preferred contact method.';
  end if;

  select e.* into v_estimate
  from public.estimates e
  where e.client_access_token = p_token
    and e.archived_at is null
    and e.status = 'Open'
    and e.client_delivery_snapshot is not null
    and (e.client_access_token_expires_at is null or e.client_access_token_expires_at > now())
  limit 1
  for update;

  if not found or v_estimate.client_id is null or v_estimate.property_id is null then
    raise exception 'This Estimate is not eligible for a walkthrough request.';
  end if;

  select wt.* into v_existing
  from public.walkthroughs wt
  where wt.estimate_id = v_estimate.id and wt.archived_at is null
  order by wt.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'walkthrough_requested', true,
      'walkthrough_requested_at', coalesce(v_existing.measurements ->> 'requestedAt', v_existing.created_at::text),
      'walkthrough_preferred_contact_method', coalesce(v_existing.measurements ->> 'preferredContactMethod', v_method)
    );
  end if;

  if jsonb_typeof(v_estimate.client_delivery_snapshot -> 'scope') = 'array' then
    select coalesce(jsonb_agg(jsonb_build_object('id', 'estimate-scope-' || item.ordinality, 'label', item.value)), '[]'::jsonb)
      into v_scope
    from jsonb_array_elements_text(v_estimate.client_delivery_snapshot -> 'scope') with ordinality as item(value, ordinality);
  end if;

  insert into public.walkthroughs (
    estimate_id, client_id, property_id, division, status,
    contact_name, phone, email, notes, scope, measurements, recommendations, photos
  ) values (
    v_estimate.id, v_estimate.client_id, v_estimate.property_id, v_estimate.division, 'New',
    v_name, v_phone, v_email, 'Walkthrough requested from the secure public Estimate.', v_scope,
    jsonb_build_object(
      'serviceType', coalesce(v_estimate.client_delivery_snapshot ->> 'service_name', v_estimate.service_name, ''),
      'serviceDescription', coalesce(v_estimate.client_delivery_snapshot ->> 'service_description', ''),
      'requestSource', 'Public Estimate',
      'requestedAt', v_requested_at,
      'preferredContactMethod', v_method,
      'estimateNumber', v_estimate.estimate_number
    ),
    '[]'::jsonb, '[]'::jsonb
  ) returning * into v_created;

  return jsonb_build_object(
    'walkthrough_requested', true,
    'walkthrough_requested_at', v_requested_at,
    'walkthrough_preferred_contact_method', v_method
  );
exception
  when unique_violation then
    select wt.* into v_existing from public.walkthroughs wt
    where wt.estimate_id = v_estimate.id and wt.archived_at is null
    order by wt.created_at desc limit 1;
    if found then
      return jsonb_build_object(
        'walkthrough_requested', true,
        'walkthrough_requested_at', coalesce(v_existing.measurements ->> 'requestedAt', v_existing.created_at::text),
        'walkthrough_preferred_contact_method', coalesce(v_existing.measurements ->> 'preferredContactMethod', v_method)
      );
    end if;
    raise;
end;
$$;

revoke all on function public.get_estimate_by_token(text) from public, anon, authenticated;
revoke all on function public.request_estimate_walkthrough_by_token(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.get_estimate_by_token(text) to anon, authenticated;
grant execute on function public.request_estimate_walkthrough_by_token(text, text, text, text, text) to anon, authenticated;

-- Defense in depth: anonymous clients use only the token-scoped functions above.
revoke all on table public.estimates, public.walkthroughs from anon;

-- This migration intentionally adds no anon table policy or grant and has not
-- been executed by this project. Review it before running in Supabase.
