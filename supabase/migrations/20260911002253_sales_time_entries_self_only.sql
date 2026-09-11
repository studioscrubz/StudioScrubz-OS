-- Sales sees only entries belonging to the employee linked to auth.uid().
-- Preserve existing columns, view security options/grants, RPCs, and other roles.
-- Review and apply separately.
begin;

create or replace view public.time_entries_operational_safe with (security_barrier = true) as
select
  t.id,
  t.time_entry_number,
  t.employee_id,
  t.job_id,
  t.crew_id,
  t.work_date,
  t.clock_in,
  t.clock_out,
  t.break_minutes,
  t.regular_hours,
  t.overtime_hours,
  t.total_hours,
  t.entry_type,
  t.notes,
  t.status,
  t.approved_at,
  t.approved_by,
  t.created_at,
  t.updated_at,
  t.archived_at,
  coalesce(e.employee_number, 'Deleted Employee') as employee_number,
  coalesce(
    e.preferred_name,
    nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''),
    'Deleted Employee'
  ) as employee_name,
  j.job_number,
  c.crew_name
from public.time_entries t
left join public.employees e on e.id = t.employee_id
left join public.jobs j on j.id = t.job_id
left join public.crews c on c.id = t.crew_id
where public.has_any_role(array['Master Admin', 'Administrator', 'Manager'])
   or t.employee_id = public.current_employee_id()
   or (not public.has_role('Sales') and public.is_assigned_to_crew(t.crew_id));

commit;
