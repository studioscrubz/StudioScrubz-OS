-- Review/apply separately. Preserve the installed RPC's exact visibility rules.
begin;

alter function public.get_operational_jobs(date, date)
  rename to _get_operational_jobs_without_contact;
revoke all on function public._get_operational_jobs_without_contact(date, date)
  from public, anon, authenticated;

-- JSON rows retain the existing sanitized projection without changing the shared
-- view or the return types of Start/Join/other lifecycle functions.
create function public.get_operational_jobs(p_start date default null, p_end date default null)
returns setof jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(
    array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']
  ) then
    raise exception 'Job access is denied.';
  end if;

  return query
    select to_jsonb(job) || jsonb_build_object(
      'client_phone', contact.phone,
      'client_first_name', contact.first_name
    )
    from public._get_operational_jobs_without_contact(p_start, p_end) job
    left join public.clients contact on contact.id = job.client_id
      and public.has_any_role(array['Crew Lead','Scrub Technician'])
      and public.current_employee_id() is not null
      and public.is_assigned_to_crew(job.assigned_crew_id)
    order by job.created_at desc;
end;
$$;

revoke all on function public.get_operational_jobs(date, date) from public, anon, authenticated;
grant execute on function public.get_operational_jobs(date, date) to authenticated;
notify pgrst, 'reload schema';
commit;
