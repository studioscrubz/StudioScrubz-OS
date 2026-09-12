-- GPS mileage V1.
-- Review/apply separately; no existing lifecycle or mileage policies changed.

begin;

-- Install the existing assigned-vehicle projection as a GPS dependency.
-- Its original definition lives in the review-only role_visibility_adjustments.sql.
create or replace view public.authorized_vehicles_safe
with (security_barrier = true) as
select
  v.id,
  v.vehicle_number,
  v.nickname,
  v.year,
  v.make,
  v.model,
  v.color,
  v.license_plate,
  v.vehicle_type,
  v.status,
  v.assigned_employee_id,
  v.assigned_crew_id,
  coalesce(
    e.preferred_name,
    nullif(
      btrim(
        coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')
      ),
      ''
    )
  ) as assigned_employee_name,
  c.crew_name as assigned_crew_name,
  v.notes
from public.vehicles v
left join public.employees e
  on e.id = v.assigned_employee_id
left join public.crews c
  on c.id = v.assigned_crew_id
where v.archived_at is null
  and public.has_any_role(array['Crew Lead', 'Scrub Technician'])
  and public.current_employee_id() is not null
  and (
    v.assigned_employee_id = public.current_employee_id()
    or public.is_assigned_to_crew(v.assigned_crew_id)
  );

revoke all
on table public.authorized_vehicles_safe
from public, anon, authenticated;

grant select
on table public.authorized_vehicles_safe
to authenticated;


-- Company-controlled mileage rate.
alter table public.business_settings
add column mileage_rate numeric null
check (
  mileage_rate >= 0
  and mileage_rate < 'Infinity'::numeric
);


create function public.get_company_mileage_rate()
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.has_any_role(
      array['Master Admin', 'Administrator', 'Manager']
    )
  then
    raise exception 'Mileage rate access denied.'
      using errcode = '42501';
  end if;

  return (
    select mileage_rate
    from public.business_settings
    order by created_at, id
    limit 1
  );
end
$$;


create function public.set_company_mileage_rate(p_rate numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.has_any_role(
      array['Master Admin', 'Administrator', 'Manager']
    )
  then
    raise exception 'Mileage rate access denied.'
      using errcode = '42501';
  end if;

  if p_rate is not null
    and not (
      p_rate >= 0
      and p_rate < 'Infinity'::numeric
    )
  then
    raise exception 'Mileage rate must be nonnegative and finite.';
  end if;

  update public.business_settings
  set
    mileage_rate = p_rate,
    updated_at = clock_timestamp()
  where id = (
    select id
    from public.business_settings
    order by created_at, id
    limit 1
  );

  if not found then
    raise exception 'Business settings have not been configured.';
  end if;
end
$$;


-- Persisted GPS trip.
create table public.job_mileage_trips (
  id uuid primary key default gen_random_uuid(),

  job_id uuid not null
    references public.jobs(id)
    on delete restrict,

  employee_id uuid not null
    references public.employees(id)
    on delete restrict,

  vehicle_id uuid not null
    references public.vehicles(id)
    on delete restrict,

  status text not null default 'Active'
    check (
      status in ('Active', 'Completed', 'Cancelled')
    ),

  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,

  start_latitude double precision not null
    check (start_latitude between -90 and 90),

  start_longitude double precision not null
    check (start_longitude between -180 and 180),

  start_accuracy double precision not null
    check (start_accuracy between 0 and 100),

  end_latitude double precision
    check (end_latitude between -90 and 90),

  end_longitude double precision
    check (end_longitude between -180 and 180),

  end_accuracy double precision
    check (end_accuracy between 0 and 100),

  distance_method text not null default 'gps_straight_line_v1'
    check (
      distance_method = 'gps_straight_line_v1'
    ),

  estimated_miles numeric
    check (
      estimated_miles >= 0
      and estimated_miles < 'Infinity'::numeric
    ),

  mileage_rate_snapshot numeric
    check (
      mileage_rate_snapshot >= 0
      and mileage_rate_snapshot < 'Infinity'::numeric
    ),

  mileage_entry_id uuid unique
    references public.mileage_entries(id)
    on delete restrict,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  check (
    (
      status = 'Active'
      and ended_at is null
      and mileage_entry_id is null
    )
    or
    (
      status = 'Cancelled'
      and ended_at is not null
      and mileage_entry_id is null
    )
    or
    (
      status = 'Completed'
      and ended_at is not null
      and mileage_entry_id is not null
      and end_latitude is not null
      and end_longitude is not null
      and end_accuracy is not null
      and estimated_miles is not null
    )
  )
);


-- One active GPS trip at a time per employee.
create unique index job_gps_one_active_employee
on public.job_mileage_trips(employee_id)
where status = 'Active';


-- One successful/non-cancelled GPS trip per employee per Job.
create unique index job_gps_one_trip_per_job
on public.job_mileage_trips(employee_id, job_id)
where status <> 'Cancelled';


create index job_gps_job
on public.job_mileage_trips(job_id);


-- Historical/read authorization.
--
-- IMPORTANT:
-- Reading an existing GPS trip does NOT require the Job to still be
-- operational. This allows an employee to continue seeing mileage after
-- the Job has been completed.
create function public.can_read_job_gps(
  p_job_id uuid,
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and (
      public.has_any_role(
        array['Master Admin', 'Administrator', 'Manager']
      )
      or (
        public.has_any_role(
          array['Crew Lead', 'Scrub Technician']
        )
        and p_employee_id = public.current_employee_id()
        and exists (
          select 1
          from public.jobs j
          where j.id = p_job_id
            and public.is_assigned_to_crew(j.assigned_crew_id)
        )
      )
    );
$$;


alter table public.job_mileage_trips
enable row level security;


revoke all
on public.job_mileage_trips
from public, anon, authenticated;


grant select
on public.job_mileage_trips
to authenticated;


create policy job_gps_read
on public.job_mileage_trips
for select
to authenticated
using (
  public.can_read_job_gps(job_id, employee_id)
);


-- Validate browser GPS position.
create function public.validate_job_gps_position(
  p_position jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  k text;
  captured timestamptz;
begin
  if jsonb_typeof(p_position) is distinct from 'object' then
    raise exception 'GPS position is required.';
  end if;

  foreach k in array array[
    'latitude',
    'longitude',
    'accuracy'
  ]
  loop
    if jsonb_typeof(p_position -> k) is distinct from 'number' then
      raise exception 'Invalid GPS position.';
    end if;
  end loop;

  if not (
    (p_position ->> 'latitude')::double precision
      between -90 and 90
    and
    (p_position ->> 'longitude')::double precision
      between -180 and 180
    and
    (p_position ->> 'accuracy')::double precision
      between 0 and 100
  )
  then
    raise exception
      'GPS coordinates must be valid and accurate within 100 meters.';
  end if;

  captured :=
    (p_position ->> 'capturedAt')::timestamptz;

  if captured is null
    or not isfinite(captured)
    or captured < clock_timestamp() - interval '60 seconds'
    or captured > clock_timestamp() + interval '10 seconds'
  then
    raise exception
      'GPS position is outdated. Please retry.';
  end if;
end
$$;


-- Read GPS trips for a Job.
create function public.get_job_gps_trips(
  p_job_id uuid
)
returns setof public.job_mileage_trips
language sql
stable
security definer
set search_path = ''
as $$
  select t.*
  from public.job_mileage_trips t
  where t.job_id = p_job_id
    and public.can_read_job_gps(
      t.job_id,
      t.employee_id
    )
  order by
    t.created_at desc,
    t.id;
$$;


-- Start or recover a GPS trip.
create function public.start_job_gps_trip(
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
  e uuid := public.current_employee_id();
  t public.job_mileage_trips;
  notification jsonb;
begin

  -- Starting a new GPS trip is stricter than reading historical mileage.
  --
  -- Employee must:
  -- 1. Be a field employee.
  -- 2. Be assigned to the Job crew.
  -- 3. Have current operational access to the Job.
  if e is null
    or not public.has_any_role(
      array['Crew Lead', 'Scrub Technician']
    )
    or not exists (
      select 1
      from public.jobs j
      where j.id = p_job_id
        and public.is_assigned_to_crew(
          j.assigned_crew_id
        )
    )
    or not exists (
      select 1
      from public.get_operational_job_ids(
        null,
        null
      ) permitted
      where permitted = p_job_id
    )
  then
    raise exception
      'GPS mileage access denied.'
      using errcode = '42501';
  end if;


  -- Serialize starts for this employee, including starts
  -- from multiple browser tabs or different Jobs.
  perform 1
  from public.employees
  where id = e
  for update;


  -- Recover an existing non-cancelled trip for this Job
  -- instead of creating a duplicate.
  select *
  into t
  from public.job_mileage_trips
  where employee_id = e
    and job_id = p_job_id
    and status <> 'Cancelled'
  for update;


  if found then
    return jsonb_build_object(
      'trip',
      to_jsonb(t),
      'initiated',
      false
    );
  end if;


  -- An employee can only have one active GPS trip at a time.
  if exists (
    select 1
    from public.job_mileage_trips
    where employee_id = e
      and status = 'Active'
  )
  then
    raise exception
      'Another GPS trip is active. Open that Job to arrive or cancel it first.';
  end if;


  perform public.validate_job_gps_position(
    p_position
  );


  -- Vehicle must be active and assigned either directly
  -- to the employee or to their crew.
  perform 1
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.status = 'Active'
    and v.archived_at is null
    and (
      v.assigned_employee_id = e
      or public.is_assigned_to_crew(
        v.assigned_crew_id
      )
    )
  for share;


  if not found then
    raise exception
      'Select an active vehicle assigned to you or your crew.';
  end if;


  -- Preserve the existing On My Way workflow/SMS behavior.
  notification :=
    public.initiate_job_on_my_way(
      p_job_id
    );


  insert into public.job_mileage_trips (
    job_id,
    employee_id,
    vehicle_id,
    start_latitude,
    start_longitude,
    start_accuracy
  )
  values (
    p_job_id,
    e,
    p_vehicle_id,
    (p_position ->> 'latitude')::double precision,
    (p_position ->> 'longitude')::double precision,
    (p_position ->> 'accuracy')::double precision
  )
  returning *
  into t;


  return jsonb_build_object(
    'trip',
    to_jsonb(t),
    'initiated',
    notification -> 'initiated'
  );
end
$$;


-- Finish GPS trip and atomically create mileage entry.
create function public.finish_job_gps_trip(
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

  select *
  into t
  from public.job_mileage_trips
  where id = p_id
  for update;


  if not found
    or t.employee_id
      is distinct from public.current_employee_id()
    or not public.can_read_job_gps(
      t.job_id,
      t.employee_id
    )
  then
    raise exception
      'GPS mileage access denied.'
      using errcode = '42501';
  end if;


  -- Idempotency:
  -- If Arrived was already completed successfully,
  -- return the existing completed trip.
  if t.status = 'Completed' then
    return t;
  end if;


  if t.status <> 'Active' then
    raise exception
      'Cancelled GPS trips cannot be completed.';
  end if;


  perform public.validate_job_gps_position(
    p_position
  );


  select *
  into j
  from public.jobs
  where id = t.job_id;


  lat :=
    (p_position ->> 'latitude')::double precision;

  lon :=
    (p_position ->> 'longitude')::double precision;


  -- Haversine formula using mean Earth radius in miles.
  --
  -- IMPORTANT:
  -- This is straight-line geographic distance.
  -- It is NOT road/route distance.
  a :=
    power(
      sin(
        radians(
          lat - t.start_latitude
        ) / 2
      ),
      2
    )
    +
    cos(
      radians(t.start_latitude)
    )
    *
    cos(
      radians(lat)
    )
    *
    power(
      sin(
        radians(
          lon - t.start_longitude
        ) / 2
      ),
      2
    );


  miles :=
    round(
      (
        3958.7613
        * 2
        * asin(
          sqrt(
            least(
              1.0,
              greatest(
                0.0,
                a
              )
            )
          )
        )
      )::numeric,
      2
    );


  -- Snapshot current company mileage rate and timezone.
  select
    b.mileage_rate,
    coalesce(
      b.timezone,
      'America/Los_Angeles'
    )
  into
    rate,
    zone
  from public.business_settings b
  order by
    b.created_at,
    b.id
  limit 1;


  -- Create the normal mileage entry.
  insert into public.mileage_entries (
    mileage_number,
    trip_date,
    vehicle_id,
    employee_id,
    crew_id,
    job_id,
    client_id,
    property_id,
    trip_purpose,
    start_location,
    end_location,
    miles,
    round_trip,
    business_use,
    mileage_rate,
    deductible_amount,
    notes
  )
  values (
    'GPS-' || t.id::text,

    (
      clock_timestamp()
      at time zone coalesce(
        zone,
        'America/Los_Angeles'
      )
    )::date,

    t.vehicle_id,
    t.employee_id,
    j.assigned_crew_id,
    j.id,
    j.client_id,
    j.property_id,

    'Travel to Job ' || j.job_number,

    'GPS departure',
    'GPS arrival',

    miles,
    false,
    true,

    rate,

    round(
      miles * coalesce(rate, 0),
      2
    ),

    'GPS-estimated straight-line distance - not driven road mileage.'
  )
  returning id
  into entry_id;


  -- Only mark trip completed after mileage entry was created.
  -- If the insert above fails, this transaction rolls back
  -- and ARRIVED can be safely retried.
  update public.job_mileage_trips
  set
    status = 'Completed',
    ended_at = clock_timestamp(),

    end_latitude = lat,
    end_longitude = lon,
    end_accuracy =
      (p_position ->> 'accuracy')::double precision,

    estimated_miles = miles,
    mileage_rate_snapshot = rate,

    mileage_entry_id = entry_id,
    updated_at = clock_timestamp()

  where id = t.id

  returning *
  into t;


  return t;
end
$$;


-- Cancel an active GPS trip without creating mileage.
create function public.cancel_job_gps_trip(
  p_id uuid
)
returns public.job_mileage_trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.job_mileage_trips;
begin

  select *
  into t
  from public.job_mileage_trips
  where id = p_id
  for update;


  if not found
    or t.employee_id
      is distinct from public.current_employee_id()
    or not public.can_read_job_gps(
      t.job_id,
      t.employee_id
    )
  then
    raise exception
      'GPS mileage access denied.'
      using errcode = '42501';
  end if;


  if t.status = 'Cancelled' then
    return t;
  end if;


  if t.status <> 'Active' then
    raise exception
      'Completed GPS trips cannot be cancelled.';
  end if;


  update public.job_mileage_trips
  set
    status = 'Cancelled',
    ended_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = t.id
  returning *
  into t;


  return t;
end
$$;


-- Narrow Job GPS mileage reader.
--
-- This allows field users to see mileage generated by GPS
-- without receiving broad access to the manual mileage system.
create function public.get_job_gps_mileage(
  p_job_id uuid
)
returns table (
  id uuid,
  trip_date date,
  miles numeric,
  trip_purpose text,
  vehicle_label text,
  employee_name text,
  deductible_amount numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.trip_date,
    m.miles,
    m.trip_purpose,

    coalesce(
      nullif(v.nickname, ''),
      v.vehicle_number
    ) as vehicle_label,

    coalesce(
      nullif(e.preferred_name, ''),
      e.first_name || ' ' || e.last_name
    ) as employee_name,

    m.deductible_amount

  from public.job_mileage_trips t

  join public.mileage_entries m
    on m.id = t.mileage_entry_id

  join public.vehicles v
    on v.id = t.vehicle_id

  join public.employees e
    on e.id = t.employee_id

  where t.job_id = p_job_id
    and t.status = 'Completed'
    and m.status = 'Active'
    and m.archived_at is null
    and public.can_read_job_gps(
      t.job_id,
      t.employee_id
    );
$$;


-- Lock down helper and GPS RPC execution.
revoke all
on function
  public.get_company_mileage_rate(),
  public.set_company_mileage_rate(numeric),
  public.can_read_job_gps(uuid, uuid),
  public.validate_job_gps_position(jsonb),
  public.get_job_gps_trips(uuid),
  public.start_job_gps_trip(uuid, uuid, jsonb),
  public.finish_job_gps_trip(uuid, jsonb),
  public.cancel_job_gps_trip(uuid),
  public.get_job_gps_mileage(uuid)
from public, anon, authenticated;


grant execute
on function
  public.get_company_mileage_rate(),
  public.set_company_mileage_rate(numeric),
  public.can_read_job_gps(uuid, uuid),
  public.get_job_gps_trips(uuid),
  public.start_job_gps_trip(uuid, uuid, jsonb),
  public.finish_job_gps_trip(uuid, jsonb),
  public.cancel_job_gps_trip(uuid),
  public.get_job_gps_mileage(uuid)
to authenticated;


notify pgrst, 'reload schema';

commit;