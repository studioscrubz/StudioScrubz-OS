-- Internal profitability configuration and server-only route cache.
-- Customer-facing estimates and proposals continue to use their existing public snapshots.

create table public.profitability_settings (
  singleton boolean primary key default true check (singleton),
  settings jsonb not null default jsonb_build_object(
    'version', 1,
    'cleanerHourlyWage', 30,
    'employerBurdenRate', 0.20,
    'targetGrossMarginRate', 0.35,
    'travelOrigin', '9110 De Soto Ave, Chatsworth, CA 91311',
    'defaultVehiclesPerJob', 1,
    'vehicleOperatingRatePerMile', null,
    'companyRequiredTravelIsCompensable', true
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profitability_settings(singleton)
values (true)
on conflict (singleton) do nothing;

create table public.profitability_route_cache (
  cache_key text primary key check (cache_key ~ '^[0-9a-f]{64}$'),
  origin text not null,
  destination text not null,
  provider text not null check (provider in ('Geoapify')),
  route jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profitability_route_cache_expires_at_idx on public.profitability_route_cache(expires_at);

-- Profitability is deliberately separate from broadly-readable Estimate and Proposal JSON.
-- Each save appends an immutable projection so historical financial assumptions remain auditable.
create table public.profitability_projections (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid references public.estimates(id) on delete restrict,
  proposal_id uuid references public.proposals(id) on delete restrict,
  projection jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(estimate_id, proposal_id) = 1)
);
create index profitability_projections_estimate_created_idx on public.profitability_projections(estimate_id, created_at desc) where estimate_id is not null;
create index profitability_projections_proposal_created_idx on public.profitability_projections(proposal_id, created_at desc) where proposal_id is not null;

alter table public.profitability_settings enable row level security;
alter table public.profitability_route_cache enable row level security;
alter table public.profitability_projections enable row level security;
revoke all on table public.profitability_settings, public.profitability_route_cache, public.profitability_projections from public, anon, authenticated;
grant select, insert, update, delete on table public.profitability_settings, public.profitability_route_cache, public.profitability_projections to service_role;

create function private.validate_profitability_settings(p_settings jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  numeric_value numeric;
  vehicle_rate numeric;
  origin text;
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Profitability settings must be an object.' using errcode = '22023';
  end if;
  if not (p_settings ?& array['version','cleanerHourlyWage','employerBurdenRate','targetGrossMarginRate','travelOrigin','defaultVehiclesPerJob','vehicleOperatingRatePerMile','companyRequiredTravelIsCompensable'])
    or (select count(*) from jsonb_object_keys(p_settings)) <> 8 then
    raise exception 'Profitability settings contain unsupported or missing fields.' using errcode = '22023';
  end if;
  if p_settings->'version' <> '1'::jsonb or jsonb_typeof(p_settings->'travelOrigin') <> 'string'
    or jsonb_typeof(p_settings->'companyRequiredTravelIsCompensable') <> 'boolean' then
    raise exception 'Profitability settings are invalid.' using errcode = '22023';
  end if;
  origin := btrim(p_settings->>'travelOrigin');
  if char_length(origin) < 12 or char_length(origin) > 300 then
    raise exception 'Travel origin must be a complete address.' using errcode = '22023';
  end if;
  begin numeric_value := (p_settings->>'cleanerHourlyWage')::numeric; exception when others then raise exception 'Cleaner hourly wage is invalid.' using errcode = '22023'; end;
  if numeric_value < 0 or numeric_value > 10000 then raise exception 'Cleaner hourly wage is invalid.' using errcode = '22023'; end if;
  begin numeric_value := (p_settings->>'employerBurdenRate')::numeric; exception when others then raise exception 'Employer burden rate is invalid.' using errcode = '22023'; end;
  if numeric_value < 0 or numeric_value >= .95 then raise exception 'Employer burden rate is invalid.' using errcode = '22023'; end if;
  begin numeric_value := (p_settings->>'targetGrossMarginRate')::numeric; exception when others then raise exception 'Target gross margin is invalid.' using errcode = '22023'; end;
  if numeric_value < 0 or numeric_value >= .95 then raise exception 'Target gross margin is invalid.' using errcode = '22023'; end if;
  begin numeric_value := (p_settings->>'defaultVehiclesPerJob')::numeric; exception when others then raise exception 'Default vehicles per job is invalid.' using errcode = '22023'; end;
  if numeric_value <> trunc(numeric_value) or numeric_value < 1 or numeric_value > 20 then raise exception 'Default vehicles per job is invalid.' using errcode = '22023'; end if;
  if p_settings->'vehicleOperatingRatePerMile' = 'null'::jsonb then vehicle_rate := null;
  else begin vehicle_rate := (p_settings->>'vehicleOperatingRatePerMile')::numeric; exception when others then raise exception 'Vehicle operating rate is invalid.' using errcode = '22023'; end;
    if vehicle_rate < 0 or vehicle_rate > 1000 then raise exception 'Vehicle operating rate is invalid.' using errcode = '22023'; end if;
  end if;
  return jsonb_build_object(
    'version',1,
    'cleanerHourlyWage',round((p_settings->>'cleanerHourlyWage')::numeric,2),
    'employerBurdenRate',(p_settings->>'employerBurdenRate')::numeric,
    'targetGrossMarginRate',(p_settings->>'targetGrossMarginRate')::numeric,
    'travelOrigin',origin,
    'defaultVehiclesPerJob',(p_settings->>'defaultVehiclesPerJob')::integer,
    'vehicleOperatingRatePerMile',case when vehicle_rate is null then null else round(vehicle_rate,4) end,
    'companyRequiredTravelIsCompensable',(p_settings->>'companyRequiredTravelIsCompensable')::boolean
  );
end;
$function$;
revoke all on function private.validate_profitability_settings(jsonb) from public, anon, authenticated;

create function private.validate_profitability_projection(p_projection jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare n numeric;
begin
  if p_projection is null or jsonb_typeof(p_projection) <> 'object'
    or p_projection->'version' <> '1'::jsonb
    or jsonb_typeof(p_projection->'directCosts') <> 'object'
    or jsonb_typeof(p_projection->'travel') <> 'object' then
    raise exception 'A valid profitability projection is required.' using errcode = '22023';
  end if;
  foreach n in array array[
    (p_projection->>'price')::numeric, (p_projection->>'cleanerCount')::numeric,
    (p_projection->>'hoursPerCleaner')::numeric, (p_projection->>'estimatedLaborHours')::numeric,
    (p_projection->>'hourlyWage')::numeric, (p_projection->>'loadedHourlyLaborCost')::numeric
  ] loop
    if n is null or n < 0 or n in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then raise exception 'Profitability projection contains an invalid cost.' using errcode = '22023'; end if;
  end loop;
  if p_projection->'travel'->>'verification' not in ('Verified','Manual','Unverified','Unavailable') then
    raise exception 'Profitability projection contains an invalid travel state.' using errcode = '22023';
  end if;
  if p_projection->'travel'->>'verification' = 'Manual'
    and (jsonb_typeof(p_projection->'travel'->'roundTripMiles') <> 'number' or jsonb_typeof(p_projection->'travel'->'roundTripMinutes') <> 'number'
      or (p_projection->'travel'->>'roundTripMiles')::numeric < 0 or (p_projection->'travel'->>'roundTripMinutes')::numeric < 0
      or (p_projection->'travel'->>'roundTripMiles')::numeric in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      or (p_projection->'travel'->>'roundTripMinutes')::numeric in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) then
    raise exception 'Manual travel requires nonnegative mileage and duration.' using errcode = '22023';
  end if;
  if p_projection->'travel'->>'verification' = 'Manual'
    and (((p_projection->'travel'->>'roundTripMiles')::numeric = 0 or (p_projection->'travel'->>'roundTripMinutes')::numeric = 0)
      and lower(btrim(coalesce(p_projection->'travel'->>'origin',''))) <> lower(btrim(coalesce(p_projection->'travel'->>'destination','')))) then
    raise exception 'Zero manual travel is only valid when origin and destination are the same.' using errcode = '22023';
  end if;
  return p_projection;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Profitability projection contains malformed numeric data.' using errcode = '22023';
end;
$function$;
revoke all on function private.validate_profitability_projection(jsonb) from public, anon, authenticated;

create function public.get_profitability_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare value jsonb;
begin
  if (select auth.uid()) is null or not public.has_any_role(array['Master Admin']) then
    raise exception 'Internal profitability access denied.' using errcode = '42501';
  end if;
  select settings into value from public.profitability_settings where singleton;
  return private.validate_profitability_settings(value);
end;
$function$;

create function public.save_profitability_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare value jsonb;
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Only Master Admin may change profitability settings.' using errcode = '42501';
  end if;
  value := private.validate_profitability_settings(p_settings);
  update public.profitability_settings set settings = value, updated_at = now() where singleton;
  return value;
end;
$function$;

revoke all on function public.get_profitability_settings() from public, anon, authenticated;
revoke all on function public.save_profitability_settings(jsonb) from public, anon, authenticated;
grant execute on function public.get_profitability_settings() to authenticated;
grant execute on function public.save_profitability_settings(jsonb) to authenticated;

create function public.get_profitability_projection(p_estimate_id uuid default null, p_proposal_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare value jsonb;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin']) then raise exception 'Internal profitability access denied.' using errcode = '42501'; end if;
  if num_nonnulls(p_estimate_id, p_proposal_id) <> 1 then raise exception 'Exactly one Estimate or Proposal is required.' using errcode = '22023'; end if;
  select projection into value from public.profitability_projections
   where (estimate_id = p_estimate_id or proposal_id = p_proposal_id)
   order by created_at desc limit 1;
  return value;
end;
$function$;

create function public.save_profitability_projection(p_estimate_id uuid default null, p_proposal_id uuid default null, p_projection jsonb default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare value jsonb;
begin
  if auth.uid() is null or not public.is_master_admin() then raise exception 'Internal profitability access denied.' using errcode = '42501'; end if;
  if num_nonnulls(p_estimate_id, p_proposal_id) <> 1 then raise exception 'Exactly one Estimate or Proposal is required.' using errcode = '22023'; end if;
  value := private.validate_profitability_projection(p_projection);
  if p_estimate_id is not null and not exists(select 1 from public.estimates where id=p_estimate_id) then raise exception 'Estimate not found.' using errcode = '23503'; end if;
  if p_proposal_id is not null and not exists(select 1 from public.proposals where id=p_proposal_id) then raise exception 'Proposal not found.' using errcode = '23503'; end if;
  insert into public.profitability_projections(estimate_id, proposal_id, projection, created_by)
  values (p_estimate_id, p_proposal_id, value, auth.uid());
  return value;
end;
$function$;
revoke all on function public.get_profitability_projection(uuid,uuid) from public, anon, authenticated;
revoke all on function public.save_profitability_projection(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.get_profitability_projection(uuid,uuid) to authenticated;
grant execute on function public.save_profitability_projection(uuid,uuid,jsonb) to authenticated;

-- Safely move any draft projections written by the initial local implementation.
insert into public.profitability_projections(estimate_id, projection)
select id, result->'profitability' from public.estimates
where jsonb_typeof(result->'profitability') = 'object';
insert into public.profitability_projections(proposal_id, projection)
select id, result->'profitability' from public.proposals
where jsonb_typeof(result->'profitability') = 'object';
update public.estimates set result = result - 'profitability' where result ? 'profitability';
update public.proposals set result = result - 'profitability' where result ? 'profitability';
update public.estimates set approved_pricing_snapshot = case when approved_pricing_snapshot ? 'result' then jsonb_set(approved_pricing_snapshot, '{result}', (approved_pricing_snapshot->'result') - 'profitability') else approved_pricing_snapshot - 'profitability' end where approved_pricing_snapshot ? 'profitability' or approved_pricing_snapshot->'result' ? 'profitability';
update public.proposals set approved_pricing_snapshot = case when approved_pricing_snapshot ? 'result' then jsonb_set(approved_pricing_snapshot, '{result}', (approved_pricing_snapshot->'result') - 'profitability') else approved_pricing_snapshot - 'profitability' end where approved_pricing_snapshot ? 'profitability' or approved_pricing_snapshot->'result' ? 'profitability';
update public.estimates set client_delivery_snapshot = client_delivery_snapshot - 'profitability' where client_delivery_snapshot ? 'profitability';
update public.proposals set client_delivery_snapshot = client_delivery_snapshot - 'profitability' where client_delivery_snapshot ? 'profitability';

create function private.reject_general_profitability_json()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.result ? 'profitability' then raise exception 'Profitability must be stored in the restricted profitability_projections relation.' using errcode = '22023'; end if;
  if new.approved_pricing_snapshot ? 'profitability'
    or new.approved_pricing_snapshot->'result' ? 'profitability'
    or new.client_delivery_snapshot ? 'profitability'
    or new.client_delivery_snapshot->'result' ? 'profitability' then
    raise exception 'Profitability cannot be included in pricing or customer snapshots.' using errcode = '22023';
  end if;
  return new;
end;
$function$;
revoke all on function private.reject_general_profitability_json() from public, anon, authenticated;
create trigger estimates_reject_general_profitability_json before insert or update of result, approved_pricing_snapshot, client_delivery_snapshot on public.estimates for each row execute function private.reject_general_profitability_json();
create trigger proposals_reject_general_profitability_json before insert or update of result, approved_pricing_snapshot, client_delivery_snapshot on public.proposals for each row execute function private.reject_general_profitability_json();

notify pgrst, 'reload schema';
