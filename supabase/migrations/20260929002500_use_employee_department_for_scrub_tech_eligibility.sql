begin;

create or replace function public.get_eligible_job_tech_options()
returns table(
  employee_id uuid,
  display_name text,
  operational_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    coalesce(
      nullif(btrim(e.preferred_name), ''),
      nullif(btrim(e.first_name || ' ' || e.last_name), ''),
      e.employee_number
    ),
    'Scrub Technician'::text
  from public.employees e
  where (select auth.uid()) is not null
    and public.has_any_role(
      array['Master Admin', 'Administrator', 'Manager', 'Sales']
    )
    and e.employment_status = 'Active'
    and e.archived_at is null
    and e.department = 'Scrub Technicians'
  order by 2, e.id;
$$;

revoke all on function public.get_eligible_job_tech_options()
from public, anon, authenticated;

grant execute on function public.get_eligible_job_tech_options()
to authenticated;


create or replace function public.is_eligible_job_tech(
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_employee_id is not null
    and exists (
      select 1
      from public.employees e
      where e.id = p_employee_id
        and e.employment_status = 'Active'
        and e.archived_at is null
        and e.department = 'Scrub Technicians'
    );
$$;

revoke all on function public.is_eligible_job_tech(uuid)
from public, anon, authenticated;

grant execute on function public.is_eligible_job_tech(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;