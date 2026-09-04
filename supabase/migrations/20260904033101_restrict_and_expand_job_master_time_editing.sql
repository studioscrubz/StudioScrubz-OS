-- Restrict authoritative Job timestamp edits to active Master Admins and make
-- the existing correction path available for Jobs in every lifecycle status.
-- Employee time entries, payroll, scheduling, pricing, and Job status are not changed.
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
  v_job public.jobs;
  v_safe public.jobs_operational_safe;
  v_timezone text;
  v_started_at timestamptz;
  v_ended_at timestamptz;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_profiles profile
    where profile.id = auth.uid()
      and profile.is_active
      and profile.role = 'Master Admin'
  ) then
    raise exception 'Only an active Master Admin can edit Job actual time.';
  end if;

  if p_start_date is null or p_start_time is null then
    raise exception 'Job Start date and time are required.';
  end if;
  if (p_end_date is null) <> (p_end_time is null) then
    raise exception 'Job End date and time must be entered together.';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.status = 'Completed' and (p_end_date is null or p_end_time is null) then
    raise exception 'Job End date and time are required for Completed Jobs.';
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
  if p_end_date is not null then
    v_ended_at := (p_end_date + p_end_time) at time zone v_timezone;
    if v_ended_at < v_started_at then
      raise exception 'Job End cannot be before Job Start.';
    end if;
  end if;

  update public.jobs
  set operational_started_at = v_started_at,
    operational_ended_at = v_ended_at,
    completed_at = case when v_job.status = 'Completed' then v_ended_at else completed_at end
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
