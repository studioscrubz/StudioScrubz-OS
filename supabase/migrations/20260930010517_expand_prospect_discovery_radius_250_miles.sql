begin;

alter table public.prospect_discovery_runs
  drop constraint if exists prospect_discovery_runs_radius_meters_check;

alter table public.prospect_discovery_runs
  add constraint prospect_discovery_runs_radius_meters_check
  check (radius_meters between 500 and 402336);

create or replace function public.begin_prospect_discovery(
  p_request_id uuid,
  p_location text,
  p_radius_meters integer,
  p_category text,
  p_keyword text,
  p_assigned_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid := (select auth.uid());
  management boolean := public.has_any_role(array['Master Admin','Administrator','Manager']);
  key text;
  cached uuid;
  created uuid;
begin
  if actor is null or not(management or public.has_any_role(array['Sales'])) then
    raise exception 'Prospect discovery denied.' using errcode='42501';
  end if;

  if p_radius_meters not between 500 and 402336
     or length(btrim(p_location)) not between 2 and 120
     or length(coalesce(p_keyword,'')) > 80 then
    raise exception 'Invalid discovery search.';
  end if;

  if p_category not in(
    'Property Management / Multifamily',
    'Commercial Offices',
    'Post-Construction / Contractors',
    'Airbnb / Short-Term Rentals',
    'Restaurants / Hospitality',
    'Salons / Barbershops',
    'Gyms / Spas',
    'Recording / Production Facilities',
    'Luxury Property Care',
    'Pressure Washing Opportunities',
    'Other Commercial'
  ) then
    raise exception 'Unsupported discovery category.';
  end if;

  if management then
    if p_assigned_user_id is not null
       and not exists(
         select 1
         from public.user_profiles p
         where p.id=p_assigned_user_id
           and p.is_active
           and p.role='Sales'
       ) then
      raise exception 'Invalid Sales assignee.';
    end if;
  elsif p_assigned_user_id is distinct from actor then
    raise exception 'Sales discoveries must be self-assigned.' using errcode='42501';
  end if;

  if (
    select count(*)
    from public.prospect_discovery_runs
    where created_by=actor
      and created_at>now()-interval '15 minutes'
  ) >= 5 then
    raise exception 'Discovery rate limit reached. Try again later.' using errcode='P0001';
  end if;

  key:=encode(
    sha256(
      convert_to(
        lower(btrim(p_location))||'|'||
        p_radius_meters||'|'||
        p_category||'|'||
        lower(btrim(coalesce(p_keyword,''))),
        'UTF8'
      )
    ),
    'hex'
  );

  select id
  into cached
  from public.prospect_discovery_runs
  where search_key=key
    and created_by=actor
    and assigned_user_id is not distinct from p_assigned_user_id
    and status='Completed'
    and created_at>now()-interval '15 minutes'
  order by created_at desc
  limit 1;

  if cached is not null then
    return jsonb_build_object('runId',cached,'cached',true);
  end if;

  perform pg_advisory_xact_lock(867530903);

  if exists(
    select 1
    from public.prospect_discovery_runs
    where created_at>clock_timestamp()-interval '2 seconds'
  ) then
    raise exception 'Discovery provider is busy. Try again shortly.' using errcode='P0001';
  end if;

  insert into public.prospect_discovery_runs(
    request_id,
    location_query,
    radius_meters,
    category,
    keyword,
    assigned_user_id,
    search_key,
    created_by
  )
  values(
    p_request_id,
    btrim(p_location),
    p_radius_meters,
    p_category,
    nullif(btrim(p_keyword),''),
    p_assigned_user_id,
    key,
    actor
  )
  on conflict(created_by,request_id)
  do update set request_id=excluded.request_id
  returning id into created;

  return jsonb_build_object('runId',created,'cached',false);
end
$$;

revoke all on function public.begin_prospect_discovery(uuid,text,integer,text,text,uuid)
from public,anon,authenticated;

grant execute on function public.begin_prospect_discovery(uuid,text,integer,text,text,uuid)
to authenticated;

notify pgrst,'reload schema';

commit;
