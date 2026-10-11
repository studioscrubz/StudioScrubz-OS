begin;

-- Keep the database as the authorization source of truth. A valid internal
-- event organizer must have both an active OS profile and an active,
-- unarchived employee linkage. Additive Sales eligibility remains supported.
create or replace function private.internal_schedule_access_level(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when profile.role in ('Master Admin', 'Administrator') then 'Management'
    when profile.role in ('Sales', 'Lead Representative')
      or private.is_eligible_lead_representative_employee(profile.employee_id)
      then 'Sales'
    else 'None'
  end
  from public.user_profiles profile
  join public.employees employee on employee.id = profile.employee_id
  where p_user_id is not null
    and profile.id = p_user_id
    and profile.is_active
    and employee.employment_status = 'Active'
    and employee.archived_at is null
$$;

revoke all on function private.internal_schedule_access_level(uuid)
from public, anon, authenticated, service_role;

create function public.get_current_internal_schedule_access_level()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then 'None'
    else coalesce(private.internal_schedule_access_level(auth.uid()), 'None')
  end
$$;

revoke all on function public.get_current_internal_schedule_access_level()
from public, anon, authenticated, service_role;
grant execute on function public.get_current_internal_schedule_access_level()
to authenticated;

create function public.get_internal_schedule_attendee_options()
returns table(id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    employee.id,
    coalesce(
      nullif(btrim(employee.preferred_name), ''),
      nullif(btrim(employee.first_name || ' ' || employee.last_name), ''),
      employee.employee_number
    )
  from public.employees employee
  where private.internal_schedule_access_level(auth.uid()) in ('Management', 'Sales')
    and employee.employment_status = 'Active'
    and employee.archived_at is null
    and private.internal_schedule_employee_is_authorized(employee.id)
  order by 2, employee.id
$$;

revoke all on function public.get_internal_schedule_attendee_options()
from public, anon, authenticated, service_role;
grant execute on function public.get_internal_schedule_attendee_options()
to authenticated;

notify pgrst, 'reload schema';

commit;
