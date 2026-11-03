-- An authenticated custodian's successful End Job check-off is the final
-- equipment verification for that job in the SAME open work session.
-- Do not ask for an identical Final Sign Out submission later.
-- Keep unresolved/missing equipment and historical sessions blocked.
begin;

create or replace function public.get_my_pending_equipment_signouts()
returns table(job_id uuid, job_number text)
language sql stable security definer set search_path='' as $$
 select distinct j.id, j.job_number::text
 from public.job_equipment_assignments a
 join public.jobs j on j.id=a.job_id
 join public.employee_work_sessions s on s.employee_id=a.employee_id
    and s.status='Open' and s.clock_out is null
 where auth.uid() is not null
   and a.employee_id=public.current_employee_id()
   and a.released_at is null
   and j.status='Completed'
   and j.completed_at>=s.clock_in
   and not exists (
      select 1 from public.job_equipment_clearances c
      where c.assignment_id=a.id
        and c.status='Cleared'
        and c.submitted_at is not null
        and (
          (c.checkpoint='Final Sign Out' and c.work_session_id=s.id)
          or
          (c.checkpoint='End Job'
           and c.work_session_id is null
           and c.submitted_at>=s.clock_in
           and c.submitted_at<=j.completed_at)
        )
   )
 order by j.job_number::text;
$$;

create or replace function public.stop_my_work()
returns public.employee_work_sessions
language plpgsql security definer set search_path='' as $$
declare v_employee uuid; v_session public.employee_work_sessions; v_pending integer;
begin
 v_employee:=public.current_employee_id();
 if auth.uid() is null or v_employee is null then
   raise exception 'Authenticated employee required.';
 end if;
 select * into v_session
 from public.employee_work_sessions
 where employee_id=v_employee and status='Open' and clock_out is null
 order by clock_in desc limit 1 for update;
 if found then
   select count(*) into v_pending
   from public.job_equipment_assignments a
   join public.jobs j on j.id=a.job_id
   where a.employee_id=v_employee
     and a.released_at is null
     and j.operational_started_at is not null
     and j.status='Completed'
     and j.completed_at>=v_session.clock_in
     and not exists (
        select 1 from public.job_equipment_clearances c
        where c.assignment_id=a.id
          and c.status='Cleared'
          and c.submitted_at is not null
          and (
            (c.checkpoint='Final Sign Out' and c.work_session_id=v_session.id)
            or
            (c.checkpoint='End Job'
             and c.work_session_id is null
             and c.submitted_at>=v_session.clock_in
             and c.submitted_at<=j.completed_at)
          )
     );
   if v_pending>0 then
     raise exception '% job equipment clearance(s) required.',v_pending;
   end if;
 end if;
 return public.stop_my_work_before_equipment();
end;
$$;

revoke all on function public.get_my_pending_equipment_signouts() from public,anon,authenticated;
grant execute on function public.get_my_pending_equipment_signouts() to authenticated;
revoke all on function public.stop_my_work() from public,anon,authenticated;
grant execute on function public.stop_my_work() to authenticated;

notify pgrst, 'reload schema';
commit;
