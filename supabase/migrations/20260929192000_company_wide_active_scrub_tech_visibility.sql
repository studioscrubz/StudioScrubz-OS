-- Company-wide Active Scrub Technician visibility
--
-- Purpose:
-- Give every authenticated StudioScrubz user access to one safe,
-- authoritative list of active Scrub Technicians.
--
-- Source of truth:
-- public.employees
--
-- Active Scrub Technician means:
--   department = 'Scrub Technicians'
--   employment_status = 'Active'
--   archived_at IS NULL
--
-- This function intentionally excludes compensation, notes,
-- hire date, and other management-only employee information.

create or replace function public.get_active_scrub_technicians()
returns table (
  id uuid,
  employee_number text,
  first_name text,
  last_name text,
  preferred_name text,
  email text,
  phone text,
  department text,
  job_title text,
  employment_status text,
  employment_type text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.employee_number,
    e.first_name,
    e.last_name,
    e.preferred_name,
    e.email,
    e.phone,
    e.department::text,
    e.job_title,
    e.employment_status::text,
    e.employment_type::text
  from public.employees as e
  where auth.uid() is not null
    and e.department = 'Scrub Technicians'
    and e.employment_status = 'Active'
    and e.archived_at is null
  order by e.last_name, e.first_name;
$$;

revoke all on function public.get_active_scrub_technicians()
from public;

revoke all on function public.get_active_scrub_technicians()
from anon;

grant execute on function public.get_active_scrub_technicians()
to authenticated;