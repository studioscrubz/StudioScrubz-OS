-- Add management-only correction of authoritative master Job timestamps.
-- This function intentionally does not read or write employee time, presence,
-- invoices, payments, pricing, scheduling, or lifecycle status.
begin;

create or replace function public.correct_completed_job_master_time(
  p_job_id uuid,
  p_start_date date,
  p_start_time time without time zone,
  p_end_date date,
  p_end_time time without time zone
)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_job public.jobs;
  v_safe public.jobs_operational_safe;
  v_timezone text;
  v_started_at timestamptz;
  v_ended_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'An active authenticated profile is required.';
  end if;

  v_role := public.current_user_role();
  if v_role not in ('Master Admin','Administrator','Manager','Crew Lead') then
    raise exception 'Job time correction permission denied.';
  end if;

  if p_start_date is null or p_start_time is null
    or p_end_date is null or p_end_time is null
  then
    raise exception 'Job Start and Job End date and time are required.';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.archived_at is not null or v_job.status is distinct from 'Completed' then
    raise exception 'Master Job time corrections are available only for Completed Jobs.';
  end if;
  if v_role = 'Crew Lead'
    and (v_job.assigned_crew_id is null or not public.is_assigned_to_crew(v_job.assigned_crew_id))
  then
    raise exception 'The Job is not assigned to your crew.';
  end if;

  select coalesce(nullif(btrim(settings.timezone), ''), 'UTC')
  into v_timezone
  from public.business_settings settings
  order by settings.id
  limit 1;
  v_timezone := coalesce(v_timezone, 'UTC');
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'The configured business timezone is invalid.';
  end if;

  v_started_at := (p_start_date + p_start_time) at time zone v_timezone;
  v_ended_at := (p_end_date + p_end_time) at time zone v_timezone;
  if v_ended_at < v_started_at then
    raise exception 'Job End cannot be before Job Start.';
  end if;

  update public.jobs
  set operational_started_at = v_started_at,
    operational_ended_at = v_ended_at,
    completed_at = v_ended_at
  where id = v_job.id;

  select * into v_safe
  from public.jobs_operational_safe
  where id = v_job.id;
  if not found then raise exception 'Updated Job is outside your permitted scope.'; end if;
  return v_safe;
end;
$$;

revoke all on function public.correct_completed_job_master_time(uuid,date,time without time zone,date,time without time zone)
  from public, anon, authenticated;
grant execute on function public.correct_completed_job_master_time(uuid,date,time without time zone,date,time without time zone)
  to authenticated;

notify pgrst, 'reload schema';
commit;
