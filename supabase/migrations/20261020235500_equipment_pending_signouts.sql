begin;
create or replace function public.get_my_pending_equipment_signouts()
returns table(job_id uuid,job_number text) language sql security definer set search_path='' as $$
 select distinct j.id,j.job_number::text
 from public.job_equipment_assignments a
 join public.jobs j on j.id=a.job_id
 join public.employee_work_sessions s on s.employee_id=a.employee_id and s.status='Open' and s.clock_out is null
 where auth.uid() is not null and a.employee_id=public.current_employee_id()
   and a.released_at is null and j.status='Completed' and j.completed_at>=s.clock_in
   and not exists(select 1 from public.job_equipment_clearances c where c.assignment_id=a.id
     and c.checkpoint='Final Sign Out' and c.work_session_id=s.id and c.status='Cleared')
 order by j.job_number::text;
$$;
revoke all on function public.get_my_pending_equipment_signouts() from public,anon,authenticated;
grant execute on function public.get_my_pending_equipment_signouts() to authenticated;
commit;