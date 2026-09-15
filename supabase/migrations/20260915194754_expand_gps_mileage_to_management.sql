-- Expand the existing Job GPS mileage workflow to management roles while
-- preserving field-user assignment restrictions and the normal mileage ledger.

begin;

do $$
begin
  if exists (
    select 1
    from public.job_mileage_trips
    where status = 'Active'
  ) then
    raise exception
      'Complete or cancel all active GPS trips before applying the management GPS expansion.';
  end if;
end
$$;

alter table public.job_mileage_trips
  add column user_id uuid references auth.users(id) on delete restrict;

alter table public.job_mileage_trips
  alter column employee_id drop not null;

create unique index job_gps_one_active_user
on public.job_mileage_trips(user_id)
where status = 'Active';

create unique index job_gps_one_trip_per_user_job
on public.job_mileage_trips(user_id, job_id)
where status <> 'Cancelled';

create or replace view public.authorized_vehicles_safe
with (security_barrier = true) as
select
  v.id, v.vehicle_number, v.nickname, v.year, v.make, v.model, v.color,
  v.license_plate, v.vehicle_type, v.status, v.assigned_employee_id,
  v.assigned_crew_id,
  coalesce(e.preferred_name, nullif(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '')) as assigned_employee_name,
  c.crew_name as assigned_crew_name,
  v.notes
from public.vehicles v
left join public.employees e on e.id = v.assigned_employee_id
left join public.crews c on c.id = v.assigned_crew_id
where v.archived_at is null
  and auth.uid() is not null
  and (
    public.has_any_role(array['Master Admin', 'Administrator', 'Manager'])
    or (
      public.has_any_role(array['Crew Lead', 'Scrub Technician'])
      and public.current_employee_id() is not null
      and (
        v.assigned_employee_id = public.current_employee_id()
        or public.is_assigned_to_crew(v.assigned_crew_id)
      )
    )
  );

revoke all on table public.authorized_vehicles_safe from public, anon, authenticated;
grant select on table public.authorized_vehicles_safe to authenticated;

create or replace function public.start_job_gps_trip(
  p_job_id uuid,
  p_vehicle_id uuid,
  p_position jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_role text := public.current_user_role();
  e uuid := public.current_employee_id();
  management boolean := public.has_any_role(array['Master Admin', 'Administrator', 'Manager']);
  t public.job_mileage_trips;
  notification jsonb;
begin
  if caller_id is null
    or caller_role not in ('Master Admin', 'Administrator', 'Manager', 'Crew Lead', 'Scrub Technician')
    or not exists (
      select 1 from public.get_operational_job_ids(null, null) permitted
      where permitted = p_job_id
    )
    or (
      not management
      and (
        e is null
        or not exists (
          select 1 from public.jobs j
          where j.id = p_job_id
            and public.is_assigned_to_crew(j.assigned_crew_id)
        )
      )
    )
  then
    raise exception 'GPS mileage access denied.' using errcode = '42501';
  end if;

  perform 1 from auth.users where id = caller_id for update;

  select * into t
  from public.job_mileage_trips
  where user_id = caller_id
    and job_id = p_job_id
    and status <> 'Cancelled'
  for update;

  if found then
    return jsonb_build_object('trip', to_jsonb(t), 'initiated', false);
  end if;

  if exists (
    select 1 from public.job_mileage_trips
    where user_id = caller_id and status = 'Active'
  ) then
    raise exception 'Another GPS trip is active. Open that Job to arrive or cancel it first.';
  end if;

  perform public.validate_job_gps_position(p_position);

  perform 1
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.status = 'Active'
    and v.archived_at is null
    and (
      management
      or v.assigned_employee_id = e
      or public.is_assigned_to_crew(v.assigned_crew_id)
    )
  for share;

  if not found then
    if management then
      raise exception 'Select an active vehicle.';
    end if;
    raise exception 'Select an active vehicle assigned to you or your crew.';
  end if;

  notification := public.initiate_job_on_my_way(p_job_id);

  insert into public.job_mileage_trips (
    job_id, user_id, employee_id, vehicle_id,
    start_latitude, start_longitude, start_accuracy
  ) values (
    p_job_id, caller_id, e, p_vehicle_id,
    (p_position ->> 'latitude')::double precision,
    (p_position ->> 'longitude')::double precision,
    (p_position ->> 'accuracy')::double precision
  ) returning * into t;

  return jsonb_build_object('trip', to_jsonb(t), 'initiated', notification -> 'initiated');
end
$$;

create or replace function public.finish_job_gps_trip(
  p_id uuid,
  p_position jsonb
)
returns public.job_mileage_trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.job_mileage_trips;
  j public.jobs;
  miles numeric;
  rate numeric;
  entry_id uuid;
  lat double precision;
  lon double precision;
  a double precision;
  zone text;
begin
  select * into t from public.job_mileage_trips where id = p_id for update;

  if not found
    or t.user_id is distinct from auth.uid()
    or not public.can_read_job_gps(t.job_id, t.employee_id)
  then
    raise exception 'GPS mileage access denied.' using errcode = '42501';
  end if;

  if t.status = 'Completed' then return t; end if;
  if t.status <> 'Active' then raise exception 'Cancelled GPS trips cannot be completed.'; end if;

  perform public.validate_job_gps_position(p_position);
  select * into j from public.jobs where id = t.job_id;

  lat := (p_position ->> 'latitude')::double precision;
  lon := (p_position ->> 'longitude')::double precision;
  a := power(sin(radians(lat - t.start_latitude) / 2), 2)
    + cos(radians(t.start_latitude)) * cos(radians(lat))
    * power(sin(radians(lon - t.start_longitude) / 2), 2);
  miles := round((3958.7613 * 2 * asin(sqrt(least(1.0, greatest(0.0, a)))))::numeric, 2);

  select b.mileage_rate, coalesce(b.timezone, 'America/Los_Angeles')
  into rate, zone
  from public.business_settings b
  order by b.created_at, b.id
  limit 1;

  insert into public.mileage_entries (
    mileage_number, trip_date, vehicle_id, employee_id, crew_id, job_id,
    client_id, property_id, trip_purpose, start_location, end_location,
    miles, round_trip, business_use, mileage_rate, deductible_amount, notes
  ) values (
    'GPS-' || t.id::text,
    (clock_timestamp() at time zone coalesce(zone, 'America/Los_Angeles'))::date,
    t.vehicle_id, t.employee_id, j.assigned_crew_id, j.id,
    j.client_id, j.property_id, 'Travel to Job ' || j.job_number,
    'GPS departure', 'GPS arrival', miles, false, true, rate,
    round(miles * coalesce(rate, 0), 2),
    'GPS-estimated straight-line distance - not driven road mileage.'
  ) returning id into entry_id;

  update public.job_mileage_trips
  set status = 'Completed', ended_at = clock_timestamp(),
    end_latitude = lat, end_longitude = lon,
    end_accuracy = (p_position ->> 'accuracy')::double precision,
    estimated_miles = miles, mileage_rate_snapshot = rate,
    mileage_entry_id = entry_id, updated_at = clock_timestamp()
  where id = t.id
  returning * into t;

  return t;
end
$$;

create or replace function public.cancel_job_gps_trip(p_id uuid)
returns public.job_mileage_trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.job_mileage_trips;
begin
  select * into t from public.job_mileage_trips where id = p_id for update;

  if not found
    or t.user_id is distinct from auth.uid()
    or not public.can_read_job_gps(t.job_id, t.employee_id)
  then
    raise exception 'GPS mileage access denied.' using errcode = '42501';
  end if;

  if t.status = 'Cancelled' then return t; end if;
  if t.status <> 'Active' then raise exception 'Completed GPS trips cannot be cancelled.'; end if;

  update public.job_mileage_trips
  set status = 'Cancelled', ended_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = t.id
  returning * into t;
  return t;
end
$$;

revoke all on function
  public.start_job_gps_trip(uuid, uuid, jsonb),
  public.finish_job_gps_trip(uuid, jsonb),
  public.cancel_job_gps_trip(uuid)
from public, anon, authenticated;

grant execute on function
  public.start_job_gps_trip(uuid, uuid, jsonb),
  public.finish_job_gps_trip(uuid, jsonb),
  public.cancel_job_gps_trip(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
