-- Automatic terminal mileage cleanup and assigned Crew Lead-only equipment custody.
-- Historical completed-job custody remains unchanged; active mismatches are reclaimed by the lead.

-- Close unfinished departure-only GPS trips when a Job reaches a terminal status.
-- No arrival position or mileage entry is fabricated and payroll is untouched.
create or replace function private.close_terminal_job_gps_mileage()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('Completed','Cancelled','Archived')
     and old.status is distinct from new.status then
    update public.job_mileage_trips trips
    set status='Cancelled',ended_at=clock_timestamp(),updated_at=clock_timestamp()
    where trips.job_id=new.id and trips.status='Active'
      and trips.mileage_entry_id is null;
  end if;
  return new;
end;
$$;
revoke all on function private.close_terminal_job_gps_mileage() from public,anon,authenticated,service_role;
drop trigger if exists jobs_close_terminal_gps_mileage on public.jobs;
create trigger jobs_close_terminal_gps_mileage
after update of status on public.jobs
for each row execute function private.close_terminal_job_gps_mileage();


CREATE OR REPLACE FUNCTION public.set_job_equipment_responsibility(p_job_id uuid, p_employee_ids uuid[], p_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if chosen is distinct from task.crew_lead_employee_id then
    raise exception 'Only the assigned Crew Lead may hold equipment responsibility.' using errcode='42501';
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
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_job_equipment_responsibility(p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if task.responsible_employee_id is distinct from task.crew_lead_employee_id
     or task.crew_id is distinct from j.assigned_crew_id then
    raise exception 'Assigned Crew Lead must accept equipment responsibility first.';
  end if;
  if exists(select 1 from public.job_equipment_handoffs h where h.job_id=p_job_id and h.acknowledged_at is null) then
    raise exception 'Incoming custodians must acknowledge outstanding equipment handoffs before job start.';
  end if;
  update public.jobs set equipment_responsibility_confirmed_at=now(),
    equipment_responsibility_confirmed_by=auth.uid() where id=p_job_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.reconcile_job_equipment_responsibility_task(p_job_id uuid, p_assigned_crew_id uuid, p_actor_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  lead_id uuid;
  current_task public.job_equipment_responsibility_tasks;
  retained_employee uuid;
  next_revision integer;
begin
  if p_assigned_crew_id is not null then
    select c.crew_lead_id into lead_id from public.crews c
    where c.id=p_assigned_crew_id and c.archived_at is null and c.status='Active';
  end if;
  select * into current_task from public.job_equipment_responsibility_tasks
  where job_id=p_job_id for update;

  if p_assigned_crew_id is null or lead_id is null then
    if found then
      if exists (
        select 1 from public.job_equipment_assignments a
        join public.job_equipment_clearances cl on cl.assignment_id=a.id
        where a.job_id=p_job_id and a.released_at is null and cl.status<>'Cleared'
      ) then raise exception 'Resolve pending equipment clearance before removing the assigned crew or Crew Lead.'; end if;
      update public.job_equipment_assignments set released_at=now(),released_by_user_id=p_actor_user_id,
        release_reason='Crew or Crew Lead removed' where job_id=p_job_id and released_at is null;
      next_revision:=current_task.revision+1;
      update public.job_equipment_responsibility_tasks set crew_id=p_assigned_crew_id,
        crew_lead_employee_id=lead_id,responsible_employee_id=null,status='Pending Assignment',
        assigned_at=null,revision=next_revision,updated_at=now() where id=current_task.id;
      insert into public.job_equipment_responsibility_events(task_id,job_id,revision,event_type,crew_id,crew_lead_employee_id,reason)
      values(current_task.id,p_job_id,next_revision,'Crew Removed',p_assigned_crew_id,lead_id,'Assigned crew or Crew Lead removed');
    end if;
    return;
  end if;

  if not found then
    insert into public.job_equipment_responsibility_tasks(job_id,crew_id,crew_lead_employee_id)
    values(p_job_id,p_assigned_crew_id,lead_id) returning * into current_task;
    insert into public.job_equipment_responsibility_events(task_id,job_id,revision,event_type,crew_id,crew_lead_employee_id,reason)
    values(current_task.id,p_job_id,current_task.revision,'Pending',p_assigned_crew_id,lead_id,'Crew with Crew Lead assigned');
    return;
  end if;

  if current_task.crew_id is not distinct from p_assigned_crew_id
     and current_task.crew_lead_employee_id is not distinct from lead_id then return; end if;

  retained_employee:=current_task.responsible_employee_id;
  if retained_employee is not null and retained_employee is distinct from lead_id then
    if exists(select 1 from public.job_equipment_assignments a join public.job_equipment_clearances cl on cl.assignment_id=a.id
      where a.job_id=p_job_id and a.employee_id=retained_employee and a.released_at is null and cl.status<>'Cleared') then
      raise exception 'Resolve pending equipment clearance before assigning a different crew.';
    end if;
    update public.job_equipment_assignments set released_at=now(),released_by_user_id=p_actor_user_id,
      release_reason='Responsible employee is not assigned to the new crew'
      where job_id=p_job_id and employee_id=retained_employee and released_at is null;
    retained_employee:=null;
  end if;
  next_revision:=current_task.revision+1;
  update public.job_equipment_responsibility_tasks set crew_id=p_assigned_crew_id,
    crew_lead_employee_id=lead_id,responsible_employee_id=retained_employee,
    status=case when retained_employee is null then 'Pending Assignment' else current_task.status end,
    assigned_at=case when retained_employee is null then null else current_task.assigned_at end,
    revision=next_revision,updated_at=now() where id=current_task.id;
  update public.jobs set equipment_responsibility_confirmed_at=null,
    equipment_responsibility_confirmed_by=null where id=p_job_id;
  insert into public.job_equipment_responsibility_events(task_id,job_id,revision,event_type,crew_id,crew_lead_employee_id,responsible_employee_id,reason)
  values(current_task.id,p_job_id,next_revision,case when retained_employee is null then 'Pending' else 'Status Changed' end,
    p_assigned_crew_id,lead_id,retained_employee,'Crew or Crew Lead changed; responsibility revalidated');
end; $function$
;

CREATE OR REPLACE FUNCTION public.start_operational_job(p_job_id uuid)
 RETURNS public.jobs_operational_safe
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform private.require_job_start_gps(p_job_id);
 if not exists(select 1 from public.jobs j
    join public.job_equipment_responsibility_tasks t on t.job_id=j.id
    where j.id=p_job_id and t.crew_id=j.assigned_crew_id
      and t.crew_lead_employee_id is not null
      and t.responsible_employee_id=t.crew_lead_employee_id
      and j.equipment_responsibility_confirmed_at is not null) then
  raise exception 'Assigned Crew Lead must accept and confirm equipment responsibility before starting.';
 end if;
 return public.start_operational_job_before_equipment(p_job_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.start_operational_job_with_presence(p_job_id uuid, p_presence jsonb)
 RETURNS public.jobs_operational_safe
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform private.require_job_start_gps(p_job_id);
 if not exists(select 1 from public.jobs j
    join public.job_equipment_responsibility_tasks t on t.job_id=j.id
    where j.id=p_job_id and t.crew_id=j.assigned_crew_id
      and t.crew_lead_employee_id is not null
      and t.responsible_employee_id=t.crew_lead_employee_id
      and j.equipment_responsibility_confirmed_at is not null) then
  raise exception 'Assigned Crew Lead must accept and confirm equipment responsibility before starting.';
 end if;
 return public.start_operational_job_with_presence_before_equipment(p_job_id,p_presence);
end $function$
;

notify pgrst,'reload schema';
