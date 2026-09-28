begin;

-- Reuse the established active employee/profile eligibility projection for
-- Sales Assessment assignment. This changes option visibility only; it does
-- not grant Job assignment or broader employee-table access.
create or replace function public.get_eligible_job_tech_options()
returns table(employee_id uuid, display_name text, operational_role text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id,
    coalesce(
      nullif(btrim(e.preferred_name), ''),
      nullif(btrim(e.first_name || ' ' || e.last_name), ''),
      e.employee_number
    ),
    up.role
  from public.employees e
  join public.user_profiles up
    on up.employee_id = e.id
   and up.is_active
  where (select auth.uid()) is not null
    and public.has_any_role(array['Master Admin', 'Administrator', 'Manager', 'Sales'])
    and e.employment_status = 'Active'
    and e.archived_at is null
    and up.role in ('Scrub Technician', 'Crew Lead')
  order by 2, e.id;
$$;

revoke all on function public.get_eligible_job_tech_options()
from public, anon, authenticated;
grant execute on function public.get_eligible_job_tech_options()
to authenticated;

notify pgrst, 'reload schema';
commit;
