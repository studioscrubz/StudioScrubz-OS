begin;

alter function public.get_assigned_field_walkthroughs()
  rename to get_assigned_field_walkthroughs_restaurant_phase_20260928;

revoke all on function
  public.get_assigned_field_walkthroughs_restaurant_phase_20260928()
from public, anon, authenticated;

create function public.get_assigned_field_walkthroughs()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with projected as (
    select
      item.value,
      item.ordinality
    from jsonb_array_elements(
      public.get_assigned_field_walkthroughs_restaurant_phase_20260928()
    ) with ordinality as item(value, ordinality)
  ),
  current_employee as (
    select public.current_employee_id() as employee_id
  )
  select coalesce(
    jsonb_agg(
      projected.value ||
      jsonb_build_object(
        'isAssignedEmployee',
        walkthrough.assigned_employee_id is not distinct from current_employee.employee_id
      )
      order by projected.ordinality
    ),
    '[]'::jsonb
  )
  from projected
  join public.walkthroughs walkthrough
    on walkthrough.id = (projected.value->>'id')::uuid
  cross join current_employee;
$function$;

revoke all on function public.get_assigned_field_walkthroughs()
from public, anon, authenticated;

grant execute on function public.get_assigned_field_walkthroughs()
to authenticated;

notify pgrst, 'reload schema';

commit;