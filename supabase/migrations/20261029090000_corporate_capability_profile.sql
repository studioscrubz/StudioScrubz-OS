-- Supabase applies this migration atomically; transaction boundaries are owned by the runner.
alter table public.business_settings
  add column corporate_capability_profile jsonb not null default '{"version":1,"overview":"","differentiators":[],"pastPerformance":[],"naicsCodes":[],"certifications":[],"uei":"","cageCode":"","serviceAreas":"","contactName":"","contactTitle":""}'::jsonb;

comment on column public.business_settings.corporate_capability_profile is
  'Verified corporate capability facts used by the authenticated capability statement generator.';

create function public.validate_corporate_capability_profile(p_profile jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  expected_keys constant text[] := array[
    'version', 'overview', 'differentiators', 'pastPerformance', 'naicsCodes',
    'certifications', 'uei', 'cageCode', 'serviceAreas', 'contactName', 'contactTitle'
  ];
  key_name text;
  key_count integer;
  normalized jsonb;
begin
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'Corporate capability profile must be an object.' using errcode = '22023';
  end if;
  if octet_length(p_profile::text) > 32768 then
    raise exception 'Corporate capability profile is too large.' using errcode = '22023';
  end if;

  select count(*) into key_count from jsonb_object_keys(p_profile);
  if key_count <> cardinality(expected_keys) or not (p_profile ?& expected_keys) then
    raise exception 'Corporate capability profile contains an unsupported or missing field.' using errcode = '22023';
  end if;
  if p_profile->'version' <> '1'::jsonb then
    raise exception 'Corporate capability profile version must be 1.' using errcode = '22023';
  end if;

  foreach key_name in array array['overview', 'uei', 'cageCode', 'serviceAreas', 'contactName', 'contactTitle'] loop
    if jsonb_typeof(p_profile->key_name) <> 'string' then
      raise exception 'Corporate capability profile field % must be text.', key_name using errcode = '22023';
    end if;
  end loop;
  if char_length(btrim(p_profile->>'overview')) > 2500
    or char_length(btrim(p_profile->>'serviceAreas')) > 1000
    or char_length(btrim(p_profile->>'contactName')) > 120
    or char_length(btrim(p_profile->>'contactTitle')) > 120 then
    raise exception 'Corporate capability profile text exceeds its allowed size.' using errcode = '22023';
  end if;
  if btrim(p_profile->>'uei') <> '' and btrim(p_profile->>'uei') !~ '^[A-Za-z0-9]{12}$' then
    raise exception 'UEI must contain exactly 12 letters or numbers.' using errcode = '22023';
  end if;
  if btrim(p_profile->>'cageCode') <> '' and btrim(p_profile->>'cageCode') !~ '^[A-Za-z0-9]{5}$' then
    raise exception 'CAGE code must contain exactly 5 letters or numbers.' using errcode = '22023';
  end if;

  foreach key_name in array array['differentiators', 'pastPerformance', 'naicsCodes', 'certifications'] loop
    if jsonb_typeof(p_profile->key_name) <> 'array' then
      raise exception 'Corporate capability profile field % must be a list.', key_name using errcode = '22023';
    end if;
  end loop;
  if jsonb_array_length(p_profile->'differentiators') > 12
    or jsonb_array_length(p_profile->'pastPerformance') > 12
    or jsonb_array_length(p_profile->'naicsCodes') > 20
    or jsonb_array_length(p_profile->'certifications') > 20 then
    raise exception 'Corporate capability profile list contains too many items.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_profile->'differentiators') item
    where jsonb_typeof(item) <> 'string' or char_length(btrim(item #>> '{}')) not between 1 and 300
  ) or exists (
    select 1 from jsonb_array_elements(p_profile->'pastPerformance') item
    where jsonb_typeof(item) <> 'string' or char_length(btrim(item #>> '{}')) not between 1 and 500
  ) or exists (
    select 1 from jsonb_array_elements(p_profile->'naicsCodes') item
    where jsonb_typeof(item) <> 'string' or btrim(item #>> '{}') !~ '^\d{2,6}$'
  ) or exists (
    select 1 from jsonb_array_elements(p_profile->'certifications') item
    where jsonb_typeof(item) <> 'string' or char_length(btrim(item #>> '{}')) not between 1 and 160
  ) then
    raise exception 'Corporate capability profile contains an invalid list item.' using errcode = '22023';
  end if;
  foreach key_name in array array['differentiators', 'pastPerformance', 'naicsCodes', 'certifications'] loop
    if (
      select count(*) <> count(distinct lower(btrim(item #>> '{}')))
      from jsonb_array_elements(p_profile->key_name) item
    ) then
      raise exception 'Corporate capability profile field % contains duplicate items.', key_name using errcode = '22023';
    end if;
  end loop;

  normalized := jsonb_build_object(
    'version', 1,
    'overview', btrim(p_profile->>'overview'),
    'differentiators', (select coalesce(jsonb_agg(to_jsonb(btrim(item #>> '{}')) order by ordinal), '[]'::jsonb) from jsonb_array_elements(p_profile->'differentiators') with ordinality values_with_order(item, ordinal)),
    'pastPerformance', (select coalesce(jsonb_agg(to_jsonb(btrim(item #>> '{}')) order by ordinal), '[]'::jsonb) from jsonb_array_elements(p_profile->'pastPerformance') with ordinality values_with_order(item, ordinal)),
    'naicsCodes', (select coalesce(jsonb_agg(to_jsonb(btrim(item #>> '{}')) order by ordinal), '[]'::jsonb) from jsonb_array_elements(p_profile->'naicsCodes') with ordinality values_with_order(item, ordinal)),
    'certifications', (select coalesce(jsonb_agg(to_jsonb(btrim(item #>> '{}')) order by ordinal), '[]'::jsonb) from jsonb_array_elements(p_profile->'certifications') with ordinality values_with_order(item, ordinal)),
    'uei', upper(btrim(p_profile->>'uei')),
    'cageCode', upper(btrim(p_profile->>'cageCode')),
    'serviceAreas', btrim(p_profile->>'serviceAreas'),
    'contactName', btrim(p_profile->>'contactName'),
    'contactTitle', btrim(p_profile->>'contactTitle')
  );
  if octet_length(normalized::text) > 32768 then
    raise exception 'Corporate capability profile is too large.' using errcode = '22023';
  end if;
  return normalized;
end;
$function$;

revoke all on function public.validate_corporate_capability_profile(jsonb) from public, anon, authenticated;

create function public.normalize_corporate_capability_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.corporate_capability_profile := public.validate_corporate_capability_profile(new.corporate_capability_profile);
  return new;
end;
$function$;

revoke all on function public.normalize_corporate_capability_profile() from public, anon, authenticated;

create trigger business_settings_normalize_corporate_capability_profile
before insert or update of corporate_capability_profile on public.business_settings
for each row execute function public.normalize_corporate_capability_profile();

create function public.get_corporate_capability_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  profile jsonb;
begin
  if (select auth.uid()) is null
    or not public.has_any_role(array['Master Admin', 'Administrator', 'Sales']) then
    raise exception 'Corporate capability profile access denied.' using errcode = '42501';
  end if;

  select settings.corporate_capability_profile into profile
  from public.business_settings settings
  order by settings.created_at, settings.id
  limit 1;
  if profile is null then
    raise exception 'Business Settings have not been configured.' using errcode = 'P0002';
  end if;
  return public.validate_corporate_capability_profile(profile);
end;
$function$;

create function public.save_corporate_capability_profile(p_profile jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized jsonb;
  saved jsonb;
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Only Master Admin may save the corporate capability profile.' using errcode = '42501';
  end if;
  normalized := public.validate_corporate_capability_profile(p_profile);

  update public.business_settings settings
  set corporate_capability_profile = normalized,
      updated_at = now()
  where settings.id = (
    select singleton.id from public.business_settings singleton
    order by singleton.created_at, singleton.id
    limit 1
  )
  returning settings.corporate_capability_profile into saved;
  if saved is null then
    raise exception 'Business Settings have not been configured.' using errcode = 'P0002';
  end if;
  return saved;
end;
$function$;

revoke all on function public.get_corporate_capability_profile() from public, anon, authenticated;
revoke all on function public.save_corporate_capability_profile(jsonb) from public, anon, authenticated;
grant execute on function public.get_corporate_capability_profile() to authenticated;
grant execute on function public.save_corporate_capability_profile(jsonb) to authenticated;

notify pgrst, 'reload schema';
