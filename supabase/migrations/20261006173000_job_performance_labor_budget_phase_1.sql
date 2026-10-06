begin;

drop function if exists public.get_job_performance_rows(date,date);

-- Phase 1 — expose immutable/effective labor budget values
-- through the existing management Job Performance report.

create or replace function public.get_job_performance_rows(
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  id uuid,
  job_number text,
  client_id uuid,
  client_name text,
  property_id uuid,
  property_name text,
  service_name text,
  division text,
  scheduled_date date,
  operational_started_at timestamptz,
  operational_ended_at timestamptz,
  ended_business_date date,
  duration_seconds double precision,

  budgeted_labor_hours numeric,
  budgeted_crew_size integer,
  budgeted_estimated_duration numeric,

  effective_labor_hours numeric,
  effective_crew_size integer,
  effective_estimated_duration numeric,

  labor_budget_frozen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
begin
  if auth.uid() is null then
    raise exception 'An active authenticated profile is required.';
  end if;

  if not public.has_any_role(
    array['Master Admin','Administrator','Manager']
  ) then
    raise exception 'Job performance report permission denied.';
  end if;

  if p_start_date is not null
     and p_end_date is not null
     and p_end_date < p_start_date then
    raise exception 'Report end date cannot be before start date.';
  end if;

  select coalesce(
    nullif(btrim(settings.timezone), ''),
    'UTC'
  )
  into v_timezone
  from public.business_settings settings
  order by settings.id
  limit 1;

  v_timezone := coalesce(v_timezone, 'UTC');

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = v_timezone
  ) then
    raise exception 'The configured business timezone is invalid.';
  end if;

  return query
  select
    job.id,
    job.job_number,
    job.client_id,

    coalesce(
      nullif(btrim(job.client_name), ''),
      'Unnamed client'
    ),

    job.property_id,

    coalesce(
      nullif(btrim(job.property_name), ''),
      'Unnamed property'
    ),

    coalesce(
      nullif(btrim(job.service_name), ''),
      'Unspecified service'
    ),

    job.division,
    job.scheduled_date,
    job.operational_started_at,
    job.operational_ended_at,

    (job.operational_ended_at at time zone v_timezone)::date,

    extract(
      epoch from (
        job.operational_ended_at
        - job.operational_started_at
      )
    )::double precision,

    snapshot.budgeted_labor_hours,
    snapshot.recommended_crew_size,
    snapshot.estimated_duration,

    case
      when snapshot.job_id is null then null
      else greatest(
        snapshot.budgeted_labor_hours
        + coalesce(adjustment.labor_hours_delta, 0),
        0
      )
    end,

    case
      when snapshot.job_id is null then null
      else greatest(
        snapshot.recommended_crew_size
        + coalesce(adjustment.crew_size_delta, 0),
        0
      )::integer
    end,

    case
      when snapshot.job_id is null then null

      when snapshot.estimated_duration is null
           and coalesce(adjustment.duration_delta, 0) = 0
        then null

      else greatest(
        coalesce(snapshot.estimated_duration, 0)
        + coalesce(adjustment.duration_delta, 0),
        0
      )
    end,

    snapshot.frozen_at

  from public.jobs job

  left join public.job_labor_budget_snapshots snapshot
    on snapshot.job_id = job.id

  left join lateral (
    select
      coalesce(sum(a.labor_hours_delta), 0) as labor_hours_delta,
      coalesce(sum(a.crew_size_delta), 0)::integer as crew_size_delta,
      coalesce(sum(a.duration_delta), 0) as duration_delta
    from public.job_labor_budget_adjustments a
    where a.job_id = job.id
  ) adjustment on true

  where job.status = 'Completed'
    and job.archived_at is null
    and job.operational_started_at is not null
    and job.operational_ended_at is not null
    and job.operational_ended_at >= job.operational_started_at

    and (
      p_start_date is null
      or (
        job.operational_ended_at
        at time zone v_timezone
      )::date >= p_start_date
    )

    and (
      p_end_date is null
      or (
        job.operational_ended_at
        at time zone v_timezone
      )::date <= p_end_date
    )

  order by job.operational_ended_at desc;
end;
$$;

revoke all
on function public.get_job_performance_rows(date,date)
from public, anon, authenticated;

grant execute
on function public.get_job_performance_rows(date,date)
to authenticated;

notify pgrst, 'reload schema';

commit;