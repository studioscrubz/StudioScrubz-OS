begin;

create or replace view public.messaging_user_directory_safe
with (security_barrier = true) as
select
  up.id,
  up.employee_id,
  up.display_name,
  up.email,
  up.role
from public.user_profiles up
where up.is_active = true
  and public.has_any_role(
    array[
      'Master Admin',
      'Administrator',
      'Manager',
      'Sales',
      'Crew Lead',
      'Scrub Technician'
    ]
  );

revoke all on table public.messaging_user_directory_safe
from public, anon, authenticated;

grant select on table public.messaging_user_directory_safe
to authenticated;

commit;