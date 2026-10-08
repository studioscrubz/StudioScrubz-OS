begin;

-- Master Admin may operate a valid scheduled walkthrough without becoming its
-- assignee. All existing status, scheduling, payload, and completion checks
-- remain in the delegated submit chain, and assigned_employee_id is unchanged.
create or replace function public.can_perform_scheduled_walkthrough(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.walkthroughs walkthrough
      where walkthrough.id = p_id
        and walkthrough.status = 'Scheduled'
        and walkthrough.archived_at is null
        and walkthrough.walkthrough_date is not null
        and walkthrough.walkthrough_time is not null
        and (
          public.is_master_admin()
          or (
            public.has_walkthrough_execution_role()
            and public.current_employee_id() is not null
            and walkthrough.assigned_employee_id = public.current_employee_id()
          )
        )
    );
$$;

revoke all on function public.can_perform_scheduled_walkthrough(uuid)
from public, anon, authenticated;
grant execute on function public.can_perform_scheduled_walkthrough(uuid)
to authenticated;

-- Service-specific walkthrough submitters are a versioned delegation chain.
-- Amend only their assignment guards; their validation and update bodies stay
-- authoritative and continue recording the authenticated actor via audit hooks.
do $migration$
declare
  function_row record;
  definition text;
  revised_definition text;
  employee_role_guard_count integer;
  short_role_guard_count integer;
  assignment_guard_count integer;
  assignment_guard_pattern constant text :=
    E'(?:\\mwalkthrough\\M|\\mw\\M|\\(\\s*(?:\\mwalkthrough\\M|\\mw\\M)\\s*\\))\\s*\\.\\s*assigned_employee_id\\s*(?:is\\s+distinct\\s+from|<>|!=)\\s*(?:\\memployee\\M|\\me\\M|\\(\\s*(?:\\memployee\\M|\\me\\M)\\s*\\))';
  is_known_wrapper boolean;
  is_known_guarded_implementation boolean;
  inspected_count integer := 0;
  rewritten_count integer := 0;
  wrapper_count integer := 0;
  guard_fixture text;
  rewritten_fixture text;
begin
  -- Regression fixtures cover the exact guard forms used across the stored
  -- submitter bodies, including PostgreSQL composite-field rendering and both
  -- long and short local-variable names. Each must be recognized once and the
  -- original predicate must survive byte-for-byte inside the new wrapper.
  -- Canonical result: not public.is_master_admin() and walkthrough.assigned_employee_id is distinct from employee
  -- Short-name result: not public.is_master_admin() and w.assigned_employee_id is distinct from e
  foreach guard_fixture in array array[
    'walkthrough.assigned_employee_id is distinct from employee',
    'w.assigned_employee_id is distinct from employee',
    'w.assigned_employee_id is distinct from e',
    '(walkthrough).assigned_employee_id IS DISTINCT FROM (employee)',
    '(w) . assigned_employee_id <> employee',
    '(w).assigned_employee_id != (e)'
  ]
  loop
    if regexp_count(guard_fixture, assignment_guard_pattern, 1, 'i') <> 1 then
      raise exception 'Assignment-guard regression fixture was not recognized: %', guard_fixture;
    end if;

    rewritten_fixture := regexp_replace(
      guard_fixture,
      assignment_guard_pattern,
      E'(not public.is_master_admin() and \\&)',
      'gi'
    );

    if rewritten_fixture <> '(not public.is_master_admin() and ' || guard_fixture || ')'
      or regexp_count(rewritten_fixture, assignment_guard_pattern, 1, 'i') <> 1
    then
      raise exception 'Assignment-guard regression fixture was rewritten unsafely: %', guard_fixture;
    end if;
  end loop;

  for function_row in
    select procedure.oid, procedure.proname
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname like 'submit_assigned_field_walkthrough%'
  loop
    inspected_count := inspected_count + 1;
    definition := pg_catalog.pg_get_functiondef(function_row.oid);
    revised_definition := definition;
    employee_role_guard_count := regexp_count(
      definition,
      E'\\memployee\\M\\s+is\\s+null\\s+or\\s+not\\s+public\\.has_walkthrough_execution_role\\(\\)',
      1,
      'i'
    );
    short_role_guard_count := regexp_count(
      definition,
      E'\\me\\M\\s+is\\s+null\\s+or\\s+not\\s+public\\.has_walkthrough_execution_role\\(\\)',
      1,
      'i'
    );
    assignment_guard_count := regexp_count(
      definition,
      assignment_guard_pattern,
      1,
      'i'
    );
    is_known_wrapper := function_row.proname = any(array[
      'submit_assigned_field_walkthrough',
      'submit_assigned_field_walkthrough_before_live_pricing_20261005',
      'submit_assigned_field_walkthrough_standard_phase_20260928'
    ]);
    is_known_guarded_implementation := function_row.proname = any(array[
      'submit_assigned_field_walkthrough_assignment_guarded_20260928',
      'submit_assigned_field_walkthrough_barber_phase_20260928',
      'submit_assigned_field_walkthrough_before_manager_transition_202',
      'submit_assigned_field_walkthrough_commercial_phase_20260928',
      'submit_assigned_field_walkthrough_common_areas_phase_20260928',
      'submit_assigned_field_walkthrough_deep_phase_20260928',
      'submit_assigned_field_walkthrough_event_phase_20260928',
      'submit_assigned_field_walkthrough_move_phase_20260928',
      'submit_assigned_field_walkthrough_office_phase_20260928',
      'submit_assigned_field_walkthrough_retail_phase_20260928',
      'submit_assigned_field_walkthrough_warehouse_phase_20260928'
    ]);

    if not is_known_wrapper and not is_known_guarded_implementation then
      raise exception
        'Refusing to replace unexpected walkthrough submitter %.',
        function_row.proname;
    end if;

    if definition !~* 'security definer'
      or definition !~* 'set search_path to '''''
    then
      raise exception
        'Refusing to replace %. Expected SECURITY DEFINER and an empty search_path.',
        function_row.proname;
    end if;

    if is_known_wrapper then
      if employee_role_guard_count + short_role_guard_count
          + assignment_guard_count <> 0
      then
        raise exception
          'Known walkthrough wrapper % unexpectedly contains a direct role or assignment guard.',
          function_row.proname;
      end if;
      wrapper_count := wrapper_count + 1;
      continue;
    end if;

    if assignment_guard_count <> 1
      or employee_role_guard_count > 1
      or short_role_guard_count > 1
      or employee_role_guard_count + short_role_guard_count > 1
    then
      raise exception
        'Refusing to replace %. Expected exactly one audited assignment-denial guard and at most one role guard; found employee role %, e role %, assignment %.',
        function_row.proname,
        employee_role_guard_count,
        short_role_guard_count,
        assignment_guard_count;
    end if;

    revised_definition := regexp_replace(
      revised_definition,
      E'\\memployee\\M\\s+is\\s+null\\s+or\\s+not\\s+public\\.has_walkthrough_execution_role\\(\\)',
      '(not public.is_master_admin() and (employee is null or not public.has_walkthrough_execution_role()))',
      'gi'
    );
    revised_definition := regexp_replace(
      revised_definition,
      E'\\me\\M\\s+is\\s+null\\s+or\\s+not\\s+public\\.has_walkthrough_execution_role\\(\\)',
      '(not public.is_master_admin() and (e is null or not public.has_walkthrough_execution_role()))',
      'gi'
    );
    -- Preserve the exact audited predicate (including its operator, aliases,
    -- parentheses, and spacing) and add only the Master Admin bypass.
    revised_definition := regexp_replace(
      revised_definition,
      assignment_guard_pattern,
      E'(not public.is_master_admin() and \\&)',
      'gi'
    );

    if revised_definition is not distinct from definition
      or (
        assignment_guard_count = 1
        and regexp_count(
          revised_definition,
          E'\\(not\\s+public\\.is_master_admin\\(\\)\\s+and\\s+(?:\\mwalkthrough\\M|\\mw\\M|\\(\\s*(?:\\mwalkthrough\\M|\\mw\\M)\\s*\\))\\s*\\.\\s*assigned_employee_id\\s*(?:is\\s+distinct\\s+from|<>|!=)\\s*(?:\\memployee\\M|\\me\\M|\\(\\s*(?:\\memployee\\M|\\me\\M)\\s*\\))\\)',
          1,
          'i'
        ) <> 1
      )
      or (
        employee_role_guard_count = 1
        and regexp_count(
          revised_definition,
          E'\\(not\\s+public\\.is_master_admin\\(\\)\\s+and\\s+\\(employee\\s+is\\s+null\\s+or\\s+not\\s+public\\.has_walkthrough_execution_role\\(\\)\\)\\)',
          1,
          'i'
        ) <> 1
      )
      or (
        short_role_guard_count = 1
        and regexp_count(
          revised_definition,
          E'\\(not\\s+public\\.is_master_admin\\(\\)\\s+and\\s+\\(e\\s+is\\s+null\\s+or\\s+not\\s+public\\.has_walkthrough_execution_role\\(\\)\\)\\)',
          1,
          'i'
        ) <> 1
      )
      -- Token counts are regression guards for the former overlapping-replace
      -- bug: `e` must never match inside `employee`, and `w` must never match
      -- inside `walkthrough`.
      or regexp_count(definition, E'\\memployee\\M', 1, 'i')
          <> regexp_count(revised_definition, E'\\memployee\\M', 1, 'i')
      or regexp_count(definition, E'\\me\\M', 1, 'i')
          <> regexp_count(revised_definition, E'\\me\\M', 1, 'i')
      or regexp_count(definition, E'\\mwalkthrough\\M', 1, 'i')
          <> regexp_count(revised_definition, E'\\mwalkthrough\\M', 1, 'i')
      or regexp_count(definition, E'\\mw\\M', 1, 'i')
          <> regexp_count(revised_definition, E'\\mw\\M', 1, 'i')
      or revised_definition ~* E'\\memploy\\s*\\(not\\s+public\\.is_master_admin'
      or regexp_count(revised_definition, assignment_guard_pattern, 1, 'i') <> 1
    then
      raise exception
        'Refusing to replace %. Guard rewrite was incomplete or corrupted an identifier.',
        function_row.proname;
    end if;

    execute revised_definition;
    rewritten_count := rewritten_count + 1;
  end loop;

  if inspected_count <> 14
    or wrapper_count <> 3
    or rewritten_count <> 11
  then
    raise exception
      'Walkthrough submitter audit failed: inspected %, wrappers %, rewritten %.',
      inspected_count,
      wrapper_count,
      rewritten_count;
  end if;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
