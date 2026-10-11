begin;

-- Allow both legacy and new visibility values during conversion.
alter table public.internal_schedule_events
drop constraint internal_schedule_events_visibility_check;

alter table public.internal_schedule_events
add constraint internal_schedule_events_visibility_check
check (
  visibility in (
    'Authorized attendees only',
    'Company-wide',
    'Management only',
    'Management Only',
    'Sales Visible'
  )
);

-- Preserve existing events while updating their visibility labels.
update public.internal_schedule_events
set visibility = case
  when visibility = 'Sales Visible' then 'Company-wide'
  when visibility = 'Management Only' then 'Management only'
  else visibility
end
where visibility in ('Sales Visible', 'Management Only');

-- Enforce only the three new values.
alter table public.internal_schedule_events
drop constraint internal_schedule_events_visibility_check;

alter table public.internal_schedule_events
add constraint internal_schedule_events_visibility_check
check (
  visibility in (
    'Authorized attendees only',
    'Company-wide',
    'Management only'
  )
);


-- Allow any active employee with an active OS account to be invited.
create or replace function private.internal_schedule_employee_is_authorized(
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.employees employee
    join public.user_profiles profile
      on profile.employee_id = employee.id
    where employee.id = p_employee_id
      and employee.employment_status = 'Active'
      and employee.archived_at is null
      and profile.is_active
  )
$function$;

commit;
