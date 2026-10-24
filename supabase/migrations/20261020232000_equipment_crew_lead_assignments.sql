-- Crew Lead advance equipment assignments, with Master Admin override.
begin;
create or replace function public.set_job_equipment_responsibility(
 p_job_id uuid, p_employee_ids uuid[], p_reason text default null
) returns integer language plpgsql security definer set search_path='' as $$
declare j public.jobs; v_actor uuid := auth.uid(); v_employee uuid; v_count integer:=0; v_existing public.job_equipment_assignments; v_master boolean;
begin
 if v_actor is null then raise exception 'Authentication required.'; end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') then
  raise exception 'Equipment assignments require an active or planned Job.';
 end if;
 v_master := public.has_role('Master Admin');
 if not v_master and not (
   public.has_role('Crew Lead') and j.assigned_crew_id is not null and
   exists(select 1 from public.crews c where c.id=j.assigned_crew_id and c.crew_lead_id=public.current_employee_id() and c.archived_at is null and c.status='Active')
 ) then raise exception 'Only the assigned Crew Lead or Master Admin may assign equipment responsibility.'; end if;
 if p_employee_ids is null then raise exception 'Explicit custodian selection is required (empty array means none).'; end if;
 if exists(select 1 from unnest(p_employee_ids) e where e is null) or
    (select count(distinct e) from unnest(p_employee_ids) e) <> cardinality(p_employee_ids) then
   raise exception 'Equipment custodians must be unique valid employees.';
 end if;
 if exists(
   select 1 from unnest(p_employee_ids) e
   where not exists (
     select 1 from public.employees emp
     where emp.id=e and emp.archived_at is null and emp.employment_status='Active'
       and (emp.id=j.assigned_employee_id or
         (j.assigned_crew_id is not null and
           (exists(select 1 from public.crew_members cm where cm.crew_id=j.assigned_crew_id and cm.employee_id=e)
            or exists(select 1 from public.crews c where c.id=j.assigned_crew_id and c.crew_lead_id=e))))
   )
 ) then raise exception 'All equipment custodians must be active workers assigned to this Job.'; end if;
 -- Do not allow a custodian with unresolved or pending clearance to be silently removed.
 if exists(
   select 1 from public.job_equipment_assignments a
   where a.job_id=p_job_id and a.released_at is null
     and not (a.employee_id=any(p_employee_ids))
     and (exists(select 1 from public.job_equipment_clearances cl where cl.assignment_id=a.id and cl.status<>'Cleared') or (j.status='In Progress' and not exists(select 1 from public.job_equipment_clearances cl where cl.assignment_id=a.id and cl.checkpoint='End Job' and cl.status='Cleared')))
 ) then raise exception 'Resolve pending equipment clearance before releasing a custodian.'; end if;
 for v_existing in select * from public.job_equipment_assignments
   where job_id=p_job_id and released_at is null and not(employee_id=any(p_employee_ids)) for update loop
   update public.job_equipment_assignments set released_at=now(),released_by_user_id=v_actor,release_reason=coalesce(nullif(btrim(p_reason),''),'Crew Lead reassignment') where id=v_existing.id;
   insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details)
   values(v_existing.id,case when v_master then 'Master Admin Override' else 'Released' end,v_actor,jsonb_build_object('reason',coalesce(p_reason,'')));
 end loop;
 foreach v_employee in array p_employee_ids loop
   if not exists(select 1 from public.job_equipment_assignments where job_id=p_job_id and employee_id=v_employee and released_at is null) then
     insert into public.job_equipment_assignments(job_id,employee_id,assigned_by_user_id)
     values(p_job_id,v_employee,v_actor) returning * into v_existing;
     insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details)
     values(v_existing.id,case when v_master then 'Master Admin Override' else 'Assigned' end,v_actor,jsonb_build_object('reason',coalesce(p_reason,'')));
   end if;
   v_count:=v_count+1;
 end loop;
 return v_count;
end; $$;
revoke all on function public.set_job_equipment_responsibility(uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.set_job_equipment_responsibility(uuid,uuid[],text) to authenticated;
commit;
