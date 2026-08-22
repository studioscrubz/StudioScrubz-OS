-- StudioScrubz OS Backlog V2-004B Phase A: scoped reader RPCs.
-- REVIEW ONLY. Run manually in the Supabase SQL editor before deploying the
-- application changes that use these RPCs.
--
-- This phase deliberately leaves all existing safe-view options and grants in
-- place so the current production application and the new application can both
-- operate during the deployment transition.

create or replace function public.get_business_settings_public()
returns setof public.business_settings_public
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.current_user_role() is null then
    raise exception 'Authentication is required.';
  end if;
  return query select settings.* from public.business_settings_public settings;
end;
$$;

create or replace function public.get_business_settings_workflow()
returns setof public.business_settings_workflow
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then
    raise exception 'Business settings workflow access is denied.';
  end if;
  return query select settings.* from public.business_settings_workflow settings;
end;
$$;

create or replace function public.get_employee_directory()
returns setof public.employee_directory_safe
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then
    raise exception 'Employee directory access is denied.';
  end if;
  return query select employee.* from public.employee_directory_safe employee order by employee.last_name;
end;
$$;

create or replace function public.get_crew_directory()
returns setof public.crew_directory_safe
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then
    raise exception 'Crew directory access is denied.';
  end if;
  return query select crew.* from public.crew_directory_safe crew order by crew.crew_name;
end;
$$;

create or replace function public.get_crew_members_directory()
returns setof public.crew_members_directory_safe
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then
    raise exception 'Crew member directory access is denied.';
  end if;
  return query select member.* from public.crew_members_directory_safe member;
end;
$$;

create or replace function public.get_operational_time_entries()
returns setof public.time_entries_operational_safe
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician','Sales']) then
    raise exception 'Time entry access is denied.';
  end if;
  return query select entry.* from public.time_entries_operational_safe entry order by entry.clock_in desc;
end;
$$;

-- Preserve the existing result shape and active-job filters while adding an
-- explicit authenticated-role boundary to the established operational reader.
create or replace function public.get_operational_jobs(
  p_start date default null,
  p_end date default null
)
returns setof public.jobs_operational_safe
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then
    raise exception 'Job access is denied.';
  end if;
  return query
    select job.*
    from public.jobs_operational_safe job
    where job.archived_at is null
      and job.status in ('Ready to Schedule','Scheduled','Crew Assigned','In Progress','Completed','Cancelled')
      and (p_start is null or job.scheduled_date >= p_start)
      and (p_end is null or job.scheduled_date <= p_end)
    order by job.created_at desc;
end;
$$;

revoke all on function public.get_business_settings_public() from public, anon, authenticated;
revoke all on function public.get_business_settings_workflow() from public, anon, authenticated;
revoke all on function public.get_employee_directory() from public, anon, authenticated;
revoke all on function public.get_crew_directory() from public, anon, authenticated;
revoke all on function public.get_crew_members_directory() from public, anon, authenticated;
revoke all on function public.get_operational_time_entries() from public, anon, authenticated;
revoke all on function public.get_operational_jobs(date, date) from public, anon, authenticated;

grant execute on function public.get_business_settings_public() to authenticated;
grant execute on function public.get_business_settings_workflow() to authenticated;
grant execute on function public.get_employee_directory() to authenticated;
grant execute on function public.get_crew_directory() to authenticated;
grant execute on function public.get_crew_members_directory() to authenticated;
grant execute on function public.get_operational_time_entries() to authenticated;
grant execute on function public.get_operational_jobs(date, date) to authenticated;

notify pgrst, 'reload schema';

