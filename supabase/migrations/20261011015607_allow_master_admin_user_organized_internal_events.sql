begin;

alter table public.internal_schedule_events
alter column organizer_employee_id drop not null;

-- Master Admin authorization belongs to the active OS account. Every other
-- internal-event role continues to require an active, unarchived employee.
create or replace function private.internal_schedule_access_level(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when profile.role = 'Master Admin' then 'Management'
    when employee.id is null
      or employee.employment_status <> 'Active'
      or employee.archived_at is not null
      then 'None'
    when profile.role = 'Administrator' then 'Management'
    when profile.role in ('Sales', 'Lead Representative')
      or private.is_eligible_lead_representative_employee(profile.employee_id)
      then 'Sales'
    else 'None'
  end
  from public.user_profiles profile
  left join public.employees employee on employee.id = profile.employee_id
  where p_user_id is not null
    and profile.id = p_user_id
    and profile.is_active
$$;

revoke all on function private.internal_schedule_access_level(uuid)
from public, anon, authenticated, service_role;

create or replace function private.internal_schedule_organizer_is_valid(
  p_user_id uuid,
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles profile
    left join public.employees employee on employee.id = profile.employee_id
    where profile.id = p_user_id
      and profile.is_active
      and private.internal_schedule_access_level(profile.id) in ('Management', 'Sales')
      and (
        (profile.role = 'Master Admin' and p_employee_id is null)
        or (
          profile.employee_id = p_employee_id
          and employee.employment_status = 'Active'
          and employee.archived_at is null
        )
      )
  )
$$;

revoke all on function private.internal_schedule_organizer_is_valid(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function private.prepare_internal_schedule_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone_row
    where timezone_row.name = new.timezone
  ) then
    raise exception 'Select a valid IANA timezone.' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' and (
    new.organizer_user_id is distinct from old.organizer_user_id
    or new.organizer_employee_id is distinct from old.organizer_employee_id
  ) then
    raise exception 'An internal event organizer cannot be changed.'
      using errcode = '23514';
  end if;

  if not private.internal_schedule_organizer_is_valid(
    new.organizer_user_id,
    new.organizer_employee_id
  ) then
    raise exception 'Select an active authorized internal-event organizer.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := transaction_timestamp();
  end if;
  new.updated_at := transaction_timestamp();
  return new;
end;
$$;

revoke all on function private.prepare_internal_schedule_event()
from public, anon, authenticated, service_role;

drop policy "Management creates internal events"
on public.internal_schedule_events;
create policy "Management creates internal events"
on public.internal_schedule_events
for insert to authenticated
with check (
  private.current_internal_schedule_access_level() = 'Management'
  and organizer_user_id = (select auth.uid())
);

notify pgrst, 'reload schema';

commit;
