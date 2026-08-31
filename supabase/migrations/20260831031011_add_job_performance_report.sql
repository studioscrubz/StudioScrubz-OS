-- Narrow, read-only management dataset for authoritative master Job duration.
begin;

create or replace function public.get_job_performance_rows(
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  id uuid, job_number text, client_id uuid, client_name text,
  property_id uuid, property_name text, service_name text, division text,
  scheduled_date date, operational_started_at timestamptz,
  operational_ended_at timestamptz, ended_business_date date,
  duration_seconds double precision
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
  if not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Job performance report permission denied.';
  end if;
  if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
    raise exception 'Report end date cannot be before start date.';
  end if;

  select coalesce(nullif(btrim(settings.timezone), ''), 'UTC')
  into v_timezone from public.business_settings settings order by settings.id limit 1;
  v_timezone := coalesce(v_timezone, 'UTC');
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'The configured business timezone is invalid.';
  end if;

  return query
  select job.id, job.job_number, job.client_id,
    coalesce(nullif(btrim(job.client_name), ''), 'Unnamed client'),
    job.property_id, coalesce(nullif(btrim(job.property_name), ''), 'Unnamed property'),
    coalesce(nullif(btrim(job.service_name), ''), 'Unspecified service'), job.division,
    job.scheduled_date, job.operational_started_at, job.operational_ended_at,
    (job.operational_ended_at at time zone v_timezone)::date,
    extract(epoch from (job.operational_ended_at - job.operational_started_at))::double precision
  from public.jobs job
  where job.status = 'Completed' and job.archived_at is null
    and job.operational_started_at is not null and job.operational_ended_at is not null
    and job.operational_ended_at >= job.operational_started_at
    and (p_start_date is null or (job.operational_ended_at at time zone v_timezone)::date >= p_start_date)
    and (p_end_date is null or (job.operational_ended_at at time zone v_timezone)::date <= p_end_date)
  order by job.operational_ended_at desc;
end;
$$;

revoke all on function public.get_job_performance_rows(date,date) from public, anon, authenticated;
grant execute on function public.get_job_performance_rows(date,date) to authenticated;
notify pgrst, 'reload schema';
commit;
