begin;

-- Return one viewer-independent, display-safe presence projection for the
-- authoritative Active Scrub Technician roster. Payroll and HR fields remain
-- inaccessible; only an open platform session is exposed here.
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
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null
    or not public.has_any_role(array[
      'Master Admin',
      'Administrator',
      'Manager',
      'Sales',
      'Crew Lead',
      'Scrub Technician'
    ]) then
    raise exception 'Active technician presence access is denied.' using errcode = '42501';
  end if;

  return query
  select
    session.id,
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
    and employee.department = 'Scrub Technicians'
    and employee.employment_status = 'Active'
    and employee.archived_at is null
  order by session.clock_in;
end;
$function$;

revoke all on function public.get_active_employee_work_sessions()
from public, anon, authenticated;
grant execute on function public.get_active_employee_work_sessions()
to authenticated;

notify pgrst, 'reload schema';
commit;
