begin;

-- Walkthrough execution is deliberately independent from the global role
-- inheritance in has_any_role().
create or replace function public.has_walkthrough_execution_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select profile.is_active
       and profile.role in ('Master Admin', 'Manager', 'Crew Lead')
       and profile.employee_id is not null
     from public.user_profiles profile
     where profile.id = (select auth.uid())),
    false
  );
$$;

revoke all on function public.has_walkthrough_execution_role()
from public, anon, authenticated;

create or replace function public.get_eligible_walkthrough_assignees()
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
    and profile.role in ('Master Admin', 'Manager', 'Crew Lead')
  order by 2, employee.id;
$$;

revoke all on function public.get_eligible_walkthrough_assignees()
from public, anon, authenticated;
grant execute on function public.get_eligible_walkthrough_assignees()
to authenticated;

create or replace function public.can_perform_scheduled_walkthrough(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and public.has_walkthrough_execution_role()
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

-- The service-specific submitters form a legacy delegation chain. Change only
-- their walkthrough-local role guards; all validation and update bodies stay
-- byte-for-byte otherwise unchanged.
do $migration$
declare
  function_row record;
  definition text;
  revised_definition text;
begin
  for function_row in
    select procedure.oid
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and (
        procedure.proname like 'get_assigned_field_walkthroughs%'
        or procedure.proname like 'submit_assigned_field_walkthrough%'
      )
  loop
    definition := pg_catalog.pg_get_functiondef(function_row.oid);
    revised_definition := replace(
      replace(
        definition,
        'public.has_any_role(array[''Crew Lead'',''Scrub Technician''])',
        'public.has_walkthrough_execution_role()'
      ),
      'public.has_any_role(array[''Crew Lead'', ''Scrub Technician''])',
      'public.has_walkthrough_execution_role()'
    );

    if revised_definition is distinct from definition then
      execute revised_definition;
    end if;
  end loop;
end;
$migration$;

create or replace function public.get_assigned_field_walkthroughs()
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
      and not public.has_walkthrough_execution_role()
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

create or replace function public.submit_assigned_field_walkthrough(
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
  if not public.can_perform_scheduled_walkthrough(p_id) then
    raise exception 'Scheduled assignment no longer available' using errcode = '42501';
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
