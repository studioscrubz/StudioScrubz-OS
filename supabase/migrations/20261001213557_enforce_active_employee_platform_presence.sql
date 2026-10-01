begin;

create or replace function public.start_my_work()
returns public.employee_work_sessions
language plpgsql
security definer
set search_path=''
as $$
declare
  v_employee_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'An active authenticated profile is required.' using errcode='42501';
  end if;

  v_employee_id:=public.current_employee_id();
  if v_employee_id is null then
    raise exception 'Your user profile must be linked to an active Employee.' using errcode='42501';
  end if;

  perform 1
  from public.employees employee
  where employee.id=v_employee_id
    and employee.employment_status='Active'
    and employee.archived_at is null;

  if not found then
    raise exception 'Platform presence requires an active, non-archived Employee.' using errcode='42501';
  end if;

  return public.ensure_employee_platform_active(v_employee_id);
end
$$;

revoke all on function public.start_my_work() from public,anon,authenticated;
grant execute on function public.start_my_work() to authenticated;

notify pgrst,'reload schema';
commit;
