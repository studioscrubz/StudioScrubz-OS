begin;

-- An employee's displayed department is not an authorization or eligibility
-- boundary. Additional operational roles preserve independent responsibilities
-- when the displayed department changes.
create table public.employee_operational_roles (
  employee_id uuid not null references public.employees(id) on delete restrict,
  operational_role text not null check (
    operational_role in ('Scrub Technician', 'Sales Representative')
  ),
  effective_at timestamptz not null default transaction_timestamp(),
  assigned_at timestamptz not null default transaction_timestamp(),
  assigned_by_user_id uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  note text,
  primary key (employee_id, operational_role),
  check (revoked_at is null or revoked_at >= assigned_at)
);

create index employee_operational_roles_active_role_idx
  on public.employee_operational_roles(operational_role, employee_id)
  where revoked_at is null;

alter table public.employee_operational_roles enable row level security;
revoke all on table public.employee_operational_roles
from public, anon, authenticated;

create or replace function private.employee_has_operational_role(
  p_employee_id uuid,
  p_operational_role text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_employee_id is not null
    and exists (
      select 1
      from public.employees employee
      where employee.id = p_employee_id
        and employee.employment_status = 'Active'
        and employee.archived_at is null
        and (
          (p_operational_role = 'Scrub Technician'
            and employee.department = 'Scrub Technicians')
          or (p_operational_role = 'Sales Representative'
            and employee.department = 'Lead Representative')
          or exists (
            select 1
            from public.employee_operational_roles assignment
            where assignment.employee_id = employee.id
              and assignment.operational_role = p_operational_role
              and assignment.effective_at <= transaction_timestamp()
              and assignment.revoked_at is null
          )
        )
    );
$$;

revoke all on function private.employee_has_operational_role(uuid, text)
from public, anon, authenticated;

-- Fail closed if a future migration changes any technician eligibility body.
do $migration$
declare
  function_row record;
  definition text;
  revised_definition text;
  guard_count integer;
  inspected_count integer := 0;
begin
  for function_row in
    select procedure.oid, procedure.proname
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'get_active_employee_work_sessions',
        'get_active_scrub_technicians',
        'get_eligible_job_tech_options',
        'is_eligible_job_tech',
        'start_operational_job_with_presence'
      ])
  loop
    inspected_count := inspected_count + 1;
    definition := pg_catalog.pg_get_functiondef(function_row.oid);
    guard_count := regexp_count(
      definition,
      E'(?:employee|e)\\.department\\s*=\\s*''Scrub Technicians''',
      1,
      'i'
    );

    if guard_count <> 1 then
      raise exception
        'Refusing to replace %. Expected exactly one Scrub Technician department guard; found %.',
        function_row.proname,
        guard_count;
    end if;

    revised_definition := regexp_replace(
      definition,
      E'employee\\.department\\s*=\\s*''Scrub Technicians''',
      'private.employee_has_operational_role(employee.id, ''Scrub Technician'')',
      'gi'
    );
    revised_definition := regexp_replace(
      revised_definition,
      E'e\\.department\\s*=\\s*''Scrub Technicians''',
      'private.employee_has_operational_role(e.id, ''Scrub Technician'')',
      'gi'
    );

    if revised_definition is not distinct from definition
      or revised_definition ~* E'(?:employee|e)\\.department\\s*=\\s*''Scrub Technicians'''
      or regexp_count(
        revised_definition,
        E'private\\.employee_has_operational_role\\((?:employee|e)\\.id,\\s*''Scrub Technician''\\)',
        1,
        'i'
      ) <> 1
    then
      raise exception 'Refusing to replace %. Technician eligibility rewrite failed.', function_row.proname;
    end if;

    execute revised_definition;
  end loop;

  if inspected_count <> 5 then
    raise exception 'Technician eligibility audit failed: inspected % functions.', inspected_count;
  end if;
end;
$migration$;

create or replace function private.is_eligible_lead_representative_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.employee_has_operational_role(
    p_employee_id,
    'Sales Representative'
  );
$$;

revoke all on function private.is_eligible_lead_representative_employee(uuid)
from public, anon, authenticated;

create or replace function public.is_current_lead_representative_eligible()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles profile
    where profile.id = auth.uid()
      and profile.is_active
      and private.is_eligible_lead_representative_employee(profile.employee_id)
  );
$$;

revoke all on function public.is_current_lead_representative_eligible()
from public, anon, authenticated;
grant execute on function public.is_current_lead_representative_eligible()
to authenticated;

create or replace function public.get_lead_representatives(p_estimate_id uuid default null)
returns table(id uuid, display_name text, is_active boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_id uuid;
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin', 'Administrator', 'Sales'])
  then
    raise exception 'Lead Representative lookup access denied.' using errcode = '42501';
  end if;

  select estimate.lead_representative_id into selected_id
  from public.estimates estimate
  where estimate.id = p_estimate_id;

  return query
  select employee.id,
    coalesce(
      nullif(btrim(employee.preferred_name), ''),
      btrim(employee.first_name || ' ' || employee.last_name)
    ),
    private.is_eligible_lead_representative_employee(employee.id)
  from public.employees employee
  where private.is_eligible_lead_representative_employee(employee.id)
    or employee.id = selected_id
  order by 2, employee.id;
end;
$$;

create or replace function public.validate_estimate_lead_representative()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.lead_representative_id is not distinct from old.lead_representative_id
  then
    return new;
  end if;
  if new.lead_representative_id is null then return new; end if;
  if auth.role() is distinct from 'service_role' and (
    auth.uid() is null
    or not public.has_any_role(array['Master Admin', 'Administrator', 'Sales'])
  ) then
    raise exception 'Lead Representative selection access denied.' using errcode = '42501';
  end if;
  if not private.is_eligible_lead_representative_employee(new.lead_representative_id) then
    raise exception 'Select an active Lead Representative or None / Direct Lead.';
  end if;
  return new;
end;
$$;

create or replace function public.get_prospect_assignees()
returns table(id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id,
    coalesce(nullif(btrim(profile.display_name), ''), profile.email, 'Sales User')
  from public.user_profiles profile
  where (select auth.uid()) is not null
    and public.has_any_role(array['Master Admin', 'Administrator', 'Manager'])
    and profile.is_active
    and (
      profile.role = 'Sales'
      or private.is_eligible_lead_representative_employee(profile.employee_id)
    )
  order by 2, 1;
$$;

create or replace function public.get_public_lead_representatives()
returns table(id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select employee.id,
    coalesce(
      nullif(btrim(employee.preferred_name), ''),
      btrim(employee.first_name || ' ' || employee.last_name)
    )
  from public.employees employee
  where private.is_eligible_lead_representative_employee(employee.id)
  order by 2, employee.id;
$$;

create or replace function public.is_public_lead_representative(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_eligible_lead_representative_employee(p_employee_id);
$$;

revoke all on function public.get_public_lead_representatives(),
  public.is_public_lead_representative(uuid)
from public, anon, authenticated;
grant execute on function public.get_public_lead_representatives(),
  public.is_public_lead_representative(uuid)
to service_role;

create or replace function public.create_lead_commission_payout_adjustment(
  p_lead_representative_id uuid,
  p_amount numeric,
  p_reason text,
  p_effective_at timestamptz default now(),
  p_reference text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  adjustment_id uuid;
  representative_name text;
begin
  if not private.is_lead_commission_payout_admin() then
    raise exception 'Payout adjustment permission denied.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount = 0 or p_amount <> round(p_amount, 2) then
    raise exception 'A non-zero, cent-precision adjustment amount is required.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'An adjustment reason is required.';
  end if;
  select coalesce(
    nullif(btrim(employee.preferred_name), ''),
    nullif(btrim(concat_ws(' ', employee.first_name, employee.last_name)), ''),
    employee.employee_number
  ) into representative_name
  from public.employees employee
  where employee.id = p_lead_representative_id
    and (
      private.is_eligible_lead_representative_employee(employee.id)
      or exists (
        select 1 from public.lead_commission_ledger entry
        where entry.lead_representative_id = employee.id
      )
    );
  if representative_name is null then
    raise exception 'Lead Representative employee not found.';
  end if;
  insert into public.lead_commission_payout_adjustments(
    lead_representative_id, amount, reason, reference, note, effective_at,
    representative_name_snapshot, actor_user_id
  ) values (
    p_lead_representative_id, round(p_amount, 2), btrim(p_reason),
    nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), p_effective_at,
    representative_name, auth.uid()
  ) returning id into adjustment_id;
  return adjustment_id;
end;
$$;

-- Keep payout management's existing payload and authorization intact; amend
-- only the representative eligibility predicate.
do $migration$
declare
  definition text;
  revised_definition text;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid) into definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'get_lead_commission_payout_management'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = '';

  if definition is null
    or regexp_count(
      definition,
      E'employee\\.department\\s*=\\s*''Lead Representative''\\s+and\\s+employee\\.archived_at\\s+is\\s+null',
      1,
      'i'
    ) <> 1
  then
    raise exception 'Refusing to replace payout management. Expected eligibility predicate was not found exactly once.';
  end if;

  revised_definition := regexp_replace(
    definition,
    E'employee\\.department\\s*=\\s*''Lead Representative''\\s+and\\s+employee\\.archived_at\\s+is\\s+null',
    'private.is_eligible_lead_representative_employee(employee.id)',
    'i'
  );

  if revised_definition is not distinct from definition
    or regexp_count(
      revised_definition,
      E'private\\.is_eligible_lead_representative_employee\\(employee\\.id\\)',
      1,
      'i'
    ) <> 1
  then
    raise exception 'Refusing to replace payout management. Eligibility rewrite failed.';
  end if;

  execute revised_definition;
end;
$migration$;

-- Assign both independent operational capabilities to the existing account.
-- This neither changes the employee department nor the Master Admin profile.
do $migration$
declare
  target_employee_id constant uuid := '3383bcb5-d1a3-4a78-8602-9585d7940047'::uuid;
  target_profile_id constant uuid := '763825e5-9cf1-47a9-b238-bb8348793924'::uuid;
begin
  if not exists (
    select 1
    from public.employees employee
    join public.user_profiles profile on profile.employee_id = employee.id
    where employee.id = target_employee_id
      and profile.id = target_profile_id
      and lower(profile.email) = 'krisg@studioscrubz.com'
      and profile.role = 'Master Admin'
      and profile.is_active
  ) then
    raise exception 'Refusing operational-role assignment: the confirmed existing Master Admin employee linkage was not found.';
  end if;

  insert into public.employee_operational_roles(
    employee_id, operational_role, effective_at, note
  ) values
    (target_employee_id, 'Scrub Technician', transaction_timestamp(),
      'Preserve existing technician operations independently of displayed department.'),
    (target_employee_id, 'Sales Representative', transaction_timestamp(),
      'Commission-eligible Sales responsibility; no retroactive commission generation.')
  on conflict (employee_id, operational_role) do update
  set revoked_at = null,
      effective_at = public.employee_operational_roles.effective_at,
      note = excluded.note;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
