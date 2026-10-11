create or replace function public.get_calendar_completed_history()
returns setof jsonb language plpgsql stable security definer set search_path to ''
as $function$
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician','Sales']) then
    raise exception 'Schedule access is denied.' using errcode='42501';
  end if;
  return query select to_jsonb(j) from public.jobs_operational_safe j
    where j.archived_at is null and j.status='Completed' and j.scheduled_date is not null
      and public.is_job_financially_handed_off(j.id)
      and (public.has_role('Master Admin') or public.has_role('Administrator') or public.has_role('Sales')
        or public.can_access_job_assignment(j.assigned_employee_id,j.assigned_crew_id))
    order by j.scheduled_date desc;
end;
$function$;
revoke all on function public.get_calendar_completed_history() from public, anon;
grant execute on function public.get_calendar_completed_history() to authenticated;