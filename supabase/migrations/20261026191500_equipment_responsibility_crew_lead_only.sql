-- Narrow responsibility designation and confirmation authorization to the job's assigned Crew Lead.
create or replace function public.set_job_equipment_responsibility(
  p_job_id uuid, p_employee_ids uuid[], p_reason text default null
) returns integer language plpgsql security definer set search_path='' as $$
declare
  j public.jobs; task public.job_equipment_responsibility_tasks; chosen uuid;
  actor uuid:=auth.uid(); old_employee uuid; assignment public.job_equipment_assignments;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if p_employee_ids is null or cardinality(p_employee_ids)<>1 or p_employee_ids[1] is null then
    raise exception 'Select exactly one responsible crew member.';
  end if;
  chosen:=p_employee_ids[1];
  select * into j from public.jobs where id=p_job_id for update;
  if not found or j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') then
    raise exception 'Equipment responsibility requires an active or planned Job.';
  end if;
  select * into task from public.job_equipment_responsibility_tasks where job_id=p_job_id for update;
  if not found or task.crew_id is distinct from j.assigned_crew_id or task.crew_lead_employee_id is null then
    raise exception 'An assigned crew with a Crew Lead is required.';
  end if;
  if not (public.current_employee_id()=task.crew_lead_employee_id) then
    raise exception 'Only the assigned Crew Lead may assign equipment responsibility.' using errcode='42501';
  end if;
  if not exists(select 1 from public.employees e where e.id=chosen and e.archived_at is null and e.employment_status='Active'
    and (e.id=task.crew_lead_employee_id or exists(select 1 from public.crew_members cm where cm.crew_id=task.crew_id and cm.employee_id=e.id))) then
    raise exception 'The responsible employee must be an active member of the assigned crew.';
  end if;
  old_employee:=task.responsible_employee_id;
  if old_employee is not null and old_employee<>chosen and exists(
    select 1 from public.job_equipment_assignments a join public.job_equipment_clearances cl on cl.assignment_id=a.id
      where a.job_id=p_job_id and a.employee_id=old_employee and a.released_at is null and cl.status<>'Cleared'
  ) then raise exception 'Resolve pending equipment clearance before reassigning responsibility.'; end if;
  if old_employee is not null and old_employee<>chosen then
    update public.job_equipment_assignments set released_at=now(),released_by_user_id=actor,
      release_reason=coalesce(nullif(btrim(p_reason),''),'Equipment responsibility reassigned')
      where job_id=p_job_id and employee_id=old_employee and released_at is null;
  end if;
  select * into assignment from public.job_equipment_assignments
    where job_id=p_job_id and employee_id=chosen and released_at is null;
  if not found then
    insert into public.job_equipment_assignments(job_id,employee_id,assigned_by_user_id)
      values(p_job_id,chosen,actor) returning * into assignment;
    insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details)
      values(assignment.id,'Assigned',
        actor,jsonb_build_object('reason',coalesce(p_reason,'')));
  end if;
  if old_employee is distinct from chosen or task.status='Pending Assignment' then
    update public.job_equipment_responsibility_tasks set responsible_employee_id=chosen,status='Assigned',
      assigned_at=now(),revision=revision+1,updated_at=now() where id=task.id returning * into task;
    insert into public.job_equipment_responsibility_events(
      task_id,job_id,revision,event_type,crew_id,crew_lead_employee_id,responsible_employee_id,actor_user_id,reason
    ) values(task.id,p_job_id,task.revision,case when old_employee is null then 'Assigned' else 'Reassigned' end,
      task.crew_id,task.crew_lead_employee_id,chosen,actor,
      coalesce(nullif(btrim(p_reason),''),'Crew Lead designation'));
  end if;
  update public.jobs set equipment_responsibility_confirmed_at=null,
    equipment_responsibility_confirmed_by=null where id=p_job_id;
  return 1;
end;
$$;

create or replace function public.confirm_job_equipment_responsibility(p_job_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs; task public.job_equipment_responsibility_tasks;
begin
  select * into j from public.jobs where id=p_job_id for update;
  if not found or j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') then
    raise exception 'Active job required.';
  end if;
  select * into task from public.job_equipment_responsibility_tasks where job_id=p_job_id for update;
  if not found or task.responsible_employee_id is null or task.status='Pending Assignment' then
    raise exception 'Select one responsible crew member before confirming.';
  end if;
  if not (public.current_employee_id()=task.crew_lead_employee_id) then
    raise exception 'Assigned Crew Lead required.' using errcode='42501';
  end if;
  if exists(select 1 from public.job_equipment_handoffs h where h.job_id=p_job_id and h.acknowledged_at is null) then
    raise exception 'Incoming custodians must acknowledge outstanding equipment handoffs before job start.';
  end if;
  update public.jobs set equipment_responsibility_confirmed_at=now(),
    equipment_responsibility_confirmed_by=auth.uid() where id=p_job_id;
end;
$$;

notify pgrst,'reload schema';
