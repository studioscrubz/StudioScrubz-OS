-- StudioScrubz OS: narrow role visibility adjustments.
-- REVIEW ONLY. Do not execute automatically.
-- Run after role_permissions.sql.

-- Sales receives a directory-only projection. Pay, hire date, notes, and other
-- employee administration data are deliberately absent.
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

-- Crew Leads and Scrub Technicians receive only vehicles directly assigned to
-- their linked employee or to one of their crews. Administrative/financial
-- vehicle fields such as VIN, ownership, and odometer are not projected.
create or replace view public.authorized_vehicles_safe
with (security_barrier = true) as
select
  v.id, v.vehicle_number, v.nickname, v.year, v.make, v.model, v.color,
  v.license_plate, v.vehicle_type, v.status, v.assigned_employee_id,
  v.assigned_crew_id,
  coalesce(e.preferred_name, nullif(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '')) as assigned_employee_name,
  c.crew_name as assigned_crew_name,
  v.notes
from public.vehicles v
left join public.employees e on e.id = v.assigned_employee_id
left join public.crews c on c.id = v.assigned_crew_id
where v.archived_at is null
  and public.has_any_role(array['Crew Lead', 'Scrub Technician'])
  and public.current_employee_id() is not null
  and (
    v.assigned_employee_id = public.current_employee_id()
    or public.is_assigned_to_crew(v.assigned_crew_id)
  );

revoke all on table public.authorized_vehicles_safe from public, anon, authenticated;
grant select on table public.authorized_vehicles_safe to authenticated;

-- No vehicle or employee table privileges are granted. Writes remain governed
-- by the existing table RLS and scoped administrative RPCs.
