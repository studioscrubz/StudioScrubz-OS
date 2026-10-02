begin;

-- Managers inherit every database authorization check that names Crew Lead.
-- Existing Manager permissions remain intact because their native role still
-- matches all existing Manager checks.
create or replace function public.has_any_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.current_user_role() = any(p_roles)
    or (
      public.current_user_role() = 'Manager'
      and 'Crew Lead' = any(p_roles)
    ),
    false
  )
$$;

revoke all on function public.has_any_role(text[])
from public, anon;
grant execute on function public.has_any_role(text[])
to authenticated;

-- Walkthrough assignment is intentionally separate from Job technician
-- eligibility. Scrub Technicians remain eligible for their normal Job work.
create function public.get_eligible_walkthrough_assignees()
returns table(employee_id uuid, display_name text, operational_role text)
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
    ),
    profile.role
  from public.employees employee
  join public.user_profiles profile
    on profile.employee_id = employee.id
   and profile.is_active
  where (select auth.uid()) is not null
    and public.has_any_role(array['Master Admin', 'Administrator', 'Manager', 'Sales'])
    and employee.employment_status = 'Active'
    and employee.archived_at is null
    and profile.role in ('Manager', 'Crew Lead')
  order by 2, employee.id;
$$;

revoke all on function public.get_eligible_walkthrough_assignees()
from public, anon, authenticated;
grant execute on function public.get_eligible_walkthrough_assignees()
to authenticated;

-- This helper controls assigned walkthrough reads and uploads. Historical
-- attribution is retained, but only Managers and Crew Leads may execute it.
create or replace function public.can_perform_scheduled_walkthrough(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and public.current_user_role() in ('Manager', 'Crew Lead')
    and public.current_employee_id() is not null
    and exists (
      select 1
      from public.walkthroughs walkthrough
      where walkthrough.id = p_id
        and walkthrough.status = 'Scheduled'
        and walkthrough.archived_at is null
        and walkthrough.walkthrough_date is not null
        and walkthrough.walkthrough_time is not null
        and walkthrough.assigned_employee_id = public.current_employee_id()
    );
$$;

revoke all on function public.can_perform_scheduled_walkthrough(uuid)
from public, anon, authenticated;
grant execute on function public.can_perform_scheduled_walkthrough(uuid)
to authenticated;

-- Keep the complete established service-specific projection/validation chain,
-- but expose it through a new strict role boundary.
alter function public.get_assigned_field_walkthroughs()
rename to get_assigned_field_walkthroughs_before_manager_transition_20261002;

revoke all on function public.get_assigned_field_walkthroughs_before_manager_transition_20261002()
from public, anon, authenticated;

create function public.get_assigned_field_walkthroughs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or (
      public.current_user_role() <> 'Master Admin'
      and (
        public.current_user_role() not in ('Manager', 'Crew Lead')
        or public.current_employee_id() is null
      )
    )
  then
    raise exception 'Field access denied' using errcode = '42501';
  end if;

  return public.get_assigned_field_walkthroughs_before_manager_transition_20261002();
end;
$$;

revoke all on function public.get_assigned_field_walkthroughs()
from public, anon, authenticated;
grant execute on function public.get_assigned_field_walkthroughs()
to authenticated;

alter function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
rename to submit_assigned_field_walkthrough_before_manager_transition_20261002;

revoke all on function public.submit_assigned_field_walkthrough_before_manager_transition_20261002(uuid, jsonb, boolean)
from public, anon, authenticated;

create function public.submit_assigned_field_walkthrough(
  p_id uuid,
  p_measurements jsonb,
  p_complete boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or public.current_employee_id() is null
    or public.current_user_role() not in ('Manager', 'Crew Lead')
  then
    raise exception 'Field access denied' using errcode = '42501';
  end if;

  perform public.submit_assigned_field_walkthrough_before_manager_transition_20261002(
    p_id,
    p_measurements,
    p_complete
  );
end;
$$;

revoke all on function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
from public, anon, authenticated;
grant execute on function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
to authenticated;

notify pgrst, 'reload schema';

commit;
