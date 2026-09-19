create or replace view public.employee_directory_company_safe
with (security_barrier=true) as
select
  e.id,
  e.employee_number,
  e.first_name,
  e.last_name,
  e.preferred_name,
  e.email,
  e.phone,
  e.department,
  e.job_title,
  e.employment_status,
  e.employment_type,
  e.created_at,
  e.updated_at,
  e.archived_at
from public.employees as e
where e.archived_at is null
  and public.has_any_role(array[
    'Master Admin',
    'Administrator',
    'Manager',
    'Sales',
    'Crew Lead',
    'Scrub Technician'
  ]::text[]);

revoke all on table public.employee_directory_company_safe
from public, anon, authenticated;

grant select on table public.employee_directory_company_safe
to authenticated;
