-- Final production activation for Equipment & Supplies Accountability.
-- Crew leadership is derived from the assigned crew, allowing multi-role
-- employees to retain field authority without granting cross-job access.
begin;

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
  if not (public.has_role('Master Admin') or public.current_employee_id()=task.crew_lead_employee_id) then
    raise exception 'Only the assigned Crew Lead or Master Admin may assign equipment responsibility.' using errcode='42501';
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
      values(assignment.id,case when public.has_role('Master Admin') then 'Master Admin Override' else 'Assigned' end,
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
  if not (public.has_role('Master Admin') or public.current_employee_id()=task.crew_lead_employee_id) then
    raise exception 'Assigned Crew Lead or Master Admin required.' using errcode='42501';
  end if;
  if exists(select 1 from public.job_equipment_handoffs h where h.job_id=p_job_id and h.acknowledged_at is null) then
    raise exception 'Incoming custodians must acknowledge outstanding equipment handoffs before job start.';
  end if;
  update public.jobs set equipment_responsibility_confirmed_at=now(),
    equipment_responsibility_confirmed_by=auth.uid() where id=p_job_id;
end;
$$;

create or replace function public.handoff_job_equipment(
  p_job_id uuid,p_from_employee_id uuid,p_to_employee_id uuid,p_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.jobs; a public.job_equipment_assignments; v_handoff uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Document the equipment handoff reason.'; end if;
  if p_from_employee_id=p_to_employee_id then raise exception 'Handoff requires two different custodians.'; end if;
  select * into j from public.jobs where id=p_job_id for update;
  if not found or j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') then
    raise exception 'Active or planned job required.';
  end if;
  if not(public.has_role('Master Admin') or exists(select 1 from public.crews c
    where c.id=j.assigned_crew_id and c.crew_lead_id=public.current_employee_id())) then
    raise exception 'Assigned Crew Lead or Master Admin required.' using errcode='42501';
  end if;
  select * into a from public.job_equipment_assignments
    where job_id=p_job_id and employee_id=p_from_employee_id and released_at is null for update;
  if not found then raise exception 'Outgoing custodian is not assigned.'; end if;
  if not exists(select 1 from public.employees e where e.id=p_to_employee_id
    and e.archived_at is null and e.employment_status='Active'
    and (e.id=j.assigned_employee_id
      or exists(select 1 from public.crew_members cm where cm.crew_id=j.assigned_crew_id and cm.employee_id=e.id)
      or exists(select 1 from public.crews c where c.id=j.assigned_crew_id and c.crew_lead_id=e.id))) then
    raise exception 'Incoming custodian must be assigned to this job.';
  end if;
  if exists(select 1 from public.job_equipment_clearances c where c.assignment_id=a.id and c.status<>'Cleared') then
    raise exception 'Resolve outgoing custodian clearance first.';
  end if;
  if j.status='In Progress' and not exists(select 1 from public.job_equipment_clearances c
    where c.assignment_id=a.id and c.checkpoint='End Job' and c.status='Cleared') then
    raise exception 'Outgoing custodian must clear issued equipment before transfer.';
  end if;
  update public.job_equipment_assignments set released_at=now(),released_by_user_id=auth.uid(),
    release_reason=p_reason where id=a.id;
  insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details)
    values(a.id,'Reassigned',auth.uid(),jsonb_build_object('to',p_to_employee_id,'reason',p_reason));
  if not exists(select 1 from public.job_equipment_assignments
    where job_id=p_job_id and employee_id=p_to_employee_id and released_at is null) then
    insert into public.job_equipment_assignments(job_id,employee_id,assigned_by_user_id)
      values(p_job_id,p_to_employee_id,auth.uid());
  end if;
  insert into public.job_equipment_handoffs(job_id,from_employee_id,to_employee_id,actor_user_id,reason)
    values(p_job_id,p_from_employee_id,p_to_employee_id,auth.uid(),p_reason) returning id into v_handoff;
  insert into public.job_equipment_notifications(job_id,employee_id,event_type,details)
    values(p_job_id,p_from_employee_id,'Equipment Released',jsonb_build_object('handoff',v_handoff)),
      (p_job_id,p_to_employee_id,'Equipment Handoff Pending',jsonb_build_object('handoff',v_handoff));
  return v_handoff;
end;
$$;

-- Activate the lifecycle gates only with the matching application release.
create or replace function public.start_operational_job(p_job_id uuid)
returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.jobs where id=p_job_id
    and equipment_responsibility_confirmed_at is not null) then
    raise exception 'Crew Lead must assign and confirm an equipment custodian before starting.';
  end if;
  return public.start_operational_job_before_equipment(p_job_id);
end;
$$;

create or replace function public.start_operational_job_with_presence(p_job_id uuid,p_presence jsonb)
returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.jobs where id=p_job_id
    and equipment_responsibility_confirmed_at is not null) then
    raise exception 'Crew Lead must assign and confirm an equipment custodian before starting.';
  end if;
  return public.start_operational_job_with_presence_before_equipment(p_job_id,p_presence);
end;
$$;

revoke all on function public.set_job_equipment_responsibility(uuid,uuid[],text),
  public.confirm_job_equipment_responsibility(uuid),
  public.handoff_job_equipment(uuid,uuid,uuid,text),
  public.start_operational_job(uuid),
  public.start_operational_job_with_presence(uuid,jsonb)
from public,anon,authenticated;
grant execute on function public.set_job_equipment_responsibility(uuid,uuid[],text),
  public.confirm_job_equipment_responsibility(uuid),
  public.handoff_job_equipment(uuid,uuid,uuid,text),
  public.start_operational_job(uuid),
  public.start_operational_job_with_presence(uuid,jsonb)
to authenticated;

notify pgrst,'reload schema';
commit;
