begin;

-- The active-presence projection already limits its output to display-safe
-- identity and session fields. Give Scrub Technicians the same global active
-- staff visibility already granted to Crew Leads without changing directory
-- access or the definition of an open session.
create or replace function public.get_active_employee_work_sessions()
returns table(
  id uuid,
  employee_id uuid,
  clock_in timestamptz,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  employee_number text,
  employee_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select session.id,
    session.employee_id,
    session.clock_in,
    session.status,
    session.created_at,
    session.updated_at,
    employee.employee_number,
    coalesce(
      employee.preferred_name,
      nullif(btrim(employee.first_name || ' ' || employee.last_name), ''),
      'Employee'
    )
  from public.employee_work_sessions session
  join public.employees employee on employee.id = session.employee_id
  where session.status = 'Open'
    and session.clock_out is null
    and (
      public.has_any_role(array[
        'Master Admin',
        'Administrator',
        'Manager',
        'Crew Lead',
        'Scrub Technician'
      ])
      or session.employee_id = public.current_employee_id()
    )
  order by session.clock_in;
$$;

revoke all on function public.get_active_employee_work_sessions()
from public, anon, authenticated;
grant execute on function public.get_active_employee_work_sessions()
to authenticated;

notify pgrst, 'reload schema';
commit;
