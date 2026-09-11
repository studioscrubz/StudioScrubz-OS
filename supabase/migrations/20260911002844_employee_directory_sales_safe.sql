-- Install the existing Sales-only directory projection. Review and apply separately.
begin;

create or replace view public.employee_directory_sales_safe
with (security_barrier = true) as
select
  e.id, e.employee_number, e.first_name, e.last_name, e.preferred_name,
  e.email, e.phone, e.department, e.job_title, e.employment_status,
  e.employment_type, e.created_at, e.updated_at, e.archived_at
from public.employees e
where public.has_role('Sales')
  and e.archived_at is null;

revoke all on table public.employee_directory_sales_safe from public, anon, authenticated;
grant select on table public.employee_directory_sales_safe to authenticated;

commit;
