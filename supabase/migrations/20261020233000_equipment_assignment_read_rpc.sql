begin;
create or replace function public.get_job_equipment_assignments(p_job_id uuid)
returns table(employee_id uuid,assigned_at timestamptz,assigned_by_user_id uuid)
language plpgsql security definer set search_path='' as $$
declare j public.jobs;
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 select * into j from public.jobs where id=p_job_id;
 if not found then raise exception 'Job not found.'; end if;
 if not (public.has_role('Master Admin') or public.has_any_role(array['Administrator','Manager'])
   or (j.assigned_crew_id is not null and public.is_assigned_to_crew(j.assigned_crew_id))
   or j.assigned_employee_id=public.current_employee_id()) then
   raise exception 'Equipment assignments access denied.';
 end if;
 return query select a.employee_id,a.assigned_at,a.assigned_by_user_id
 from public.job_equipment_assignments a where a.job_id=p_job_id and a.released_at is null
 order by a.assigned_at,a.employee_id;
end; $$;
revoke all on function public.get_job_equipment_assignments(uuid) from public,anon,authenticated;
grant execute on function public.get_job_equipment_assignments(uuid) to authenticated;
commit;