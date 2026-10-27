-- Automatic terminal mileage cleanup and assigned Crew Lead-only equipment custody.
-- Historical completed-job custody remains unchanged; active mismatches are reclaimed by the lead.

-- Close unfinished departure-only GPS trips when a Job reaches a terminal status.
-- No arrival position or mileage entry is fabricated and payroll is untouched.
create or replace function private.close_terminal_job_gps_mileage()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('Completed','Cancelled','Archived') or new.archived_at is not null then
    update public.job_mileage_trips trips
    set status='Cancelled',ended_at=coalesce(trips.ended_at,clock_timestamp()),updated_at=clock_timestamp()
    where trips.job_id=new.id and trips.status='Active'
      and trips.mileage_entry_id is null;
  end if;
  return new;
end;
$$;
revoke all on function private.close_terminal_job_gps_mileage() from public,anon,authenticated,service_role;
drop trigger if exists jobs_close_terminal_gps_mileage on public.jobs;
create trigger jobs_close_terminal_gps_mileage
after update of status,archived_at on public.jobs
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
  if auth.uid() is null or not exists(select 1 from public.crews c where c.id=j.assigned_crew_id
    and c.crew_lead_id=public.current_employee_id() and c.status='Active' and c.archived_at is null) then
    raise exception 'Assigned Crew Lead required.' using errcode='42501';
  end if;
  perform private.reconcile_job_equipment_responsibility_task(p_job_id,j.assigned_crew_id,auth.uid());
  if auth.uid() is null or not exists(select 1 from public.crews c where c.id=j.assigned_crew_id
    and c.crew_lead_id=public.current_employee_id() and c.status='Active' and c.archived_at is null) then
    raise exception 'Assigned Crew Lead required.' using errcode='42501';
  end if;
  perform private.reconcile_job_equipment_responsibility_task(p_job_id,j.assigned_crew_id,auth.uid());
  select * into task from public.job_equipment_responsibility_tasks where job_id=p_job_id for update;
  if not found or task.crew_id is distinct from j.assigned_crew_id or task.crew_lead_employee_id is null then
    raise exception 'An assigned crew with a Crew Lead is required.';
  end if;
  if auth.uid() is null or public.current_employee_id() is distinct from task.crew_lead_employee_id then
    raise exception 'Only the assigned Crew Lead may assign equipment responsibility.' using errcode='42501';
  end if;
  if chosen is distinct from task.crew_lead_employee_id then
    raise exception 'Only the assigned Crew Lead may hold equipment responsibility.' using errcode='42501';
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
  if auth.uid() is null or not exists(select 1 from public.crews c where c.id=j.assigned_crew_id
    and c.crew_lead_id=public.current_employee_id() and c.status='Active' and c.archived_at is null) then
    raise exception 'Assigned Crew Lead required.' using errcode='42501';
  end if;
  perform private.reconcile_job_equipment_responsibility_task(p_job_id,j.assigned_crew_id,auth.uid());
  if auth.uid() is null or not exists(select 1 from public.crews c where c.id=j.assigned_crew_id
    and c.crew_lead_id=public.current_employee_id() and c.status='Active' and c.archived_at is null) then
    raise exception 'Assigned Crew Lead required.' using errcode='42501';
  end if;
  perform private.reconcile_job_equipment_responsibility_task(p_job_id,j.assigned_crew_id,auth.uid());
  select * into task from public.job_equipment_responsibility_tasks where job_id=p_job_id for update;
  if not found or task.responsible_employee_id is null or task.status='Pending Assignment' then
    raise exception 'Select one responsible crew member before confirming.';
  end if;
  if auth.uid() is null or public.current_employee_id() is distinct from task.crew_lead_employee_id then
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

-- System reconciliation records a NULL actor, never impersonating a human.
alter table public.job_equipment_assignments alter column assigned_by_user_id drop not null;
alter table public.job_equipment_assignment_audit alter column actor_user_id drop not null;

create or replace function private.reconcile_job_equipment_responsibility_task(
  p_job_id uuid,p_assigned_crew_id uuid,p_actor_user_id uuid
) returns void language plpgsql security definer set search_path='' as $$
declare
  j public.jobs; t public.job_equipment_responsibility_tasks; lead_id uuid;
  a public.job_equipment_assignments; changed boolean; previous uuid;
begin
  select * into j from public.jobs where id=p_job_id for update;
  if not found or j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') then return; end if;
  if p_assigned_crew_id is distinct from j.assigned_crew_id then raise exception 'Crew assignment changed; reload the job.'; end if;
  select c.crew_lead_id into lead_id from public.crews c join public.employees e on e.id=c.crew_lead_id
    where c.id=j.assigned_crew_id and c.status='Active' and c.archived_at is null
      and e.archived_at is null and e.employment_status='Active';
  select * into t from public.job_equipment_responsibility_tasks where job_id=p_job_id for update;
  if not found then
    if lead_id is null then return; end if;
    insert into public.job_equipment_responsibility_tasks(job_id,crew_id,crew_lead_employee_id)
      values(p_job_id,j.assigned_crew_id,lead_id) returning * into t;
  end if;
  previous:=t.responsible_employee_id;
  changed:=t.crew_id is distinct from j.assigned_crew_id or t.crew_lead_employee_id is distinct from lead_id
    or t.responsible_employee_id is distinct from lead_id
    or exists(select 1 from public.job_equipment_assignments x where x.job_id=p_job_id and x.released_at is null and x.employee_id is distinct from lead_id)
    or (lead_id is not null and not exists(select 1 from public.job_equipment_assignments x where x.job_id=p_job_id and x.released_at is null and x.employee_id=lead_id));
  if not changed then return; end if;
  if exists(select 1 from public.job_equipment_handoffs h where h.job_id=p_job_id and h.acknowledged_at is null)
    or exists(select 1 from public.job_equipment_assignments x where x.job_id=p_job_id and x.released_at is null and x.employee_id is distinct from lead_id
      and (exists(select 1 from public.job_equipment_clearances cl where cl.assignment_id=x.id and cl.status<>'Cleared')
        or (j.status='In Progress' and not exists(select 1 from public.job_equipment_clearances cl where cl.assignment_id=x.id and cl.checkpoint='End Job' and cl.status='Cleared')))) then
    raise exception 'Resolve pending equipment clearance or handoff before changing Crew Lead responsibility.';
  end if;
  for a in select * from public.job_equipment_assignments where job_id=p_job_id and released_at is null and employee_id is distinct from lead_id for update loop
    update public.job_equipment_assignments set released_at=now(),released_by_user_id=p_actor_user_id,
      release_reason='Assigned Crew Lead policy reconciliation' where id=a.id;
    insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details)
      values(a.id,'Released',p_actor_user_id,jsonb_build_object('reason','Assigned Crew Lead policy reconciliation','system',p_actor_user_id is null));
  end loop;
  if lead_id is not null and not exists(select 1 from public.job_equipment_assignments where job_id=p_job_id and employee_id=lead_id and released_at is null) then
    insert into public.job_equipment_assignments(job_id,employee_id,assigned_by_user_id) values(p_job_id,lead_id,p_actor_user_id) returning * into a;
    insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details)
      values(a.id,'Assigned',p_actor_user_id,jsonb_build_object('reason','Assigned Crew Lead policy reconciliation','system',p_actor_user_id is null));
  end if;
  update public.job_equipment_responsibility_tasks set crew_id=j.assigned_crew_id,crew_lead_employee_id=lead_id,
    responsible_employee_id=lead_id,status=case when lead_id is null then 'Pending Assignment' else 'Assigned' end,
    assigned_at=case when lead_id is null then null else now() end,revision=revision+1,updated_at=now()
    where id=t.id returning * into t;
  update public.jobs set equipment_responsibility_confirmed_at=null,equipment_responsibility_confirmed_by=null where id=p_job_id;
  insert into public.job_equipment_responsibility_events(task_id,job_id,revision,event_type,crew_id,crew_lead_employee_id,responsible_employee_id,actor_user_id,reason)
    values(t.id,p_job_id,t.revision,case when lead_id is null then 'Crew Removed' when previous is null then 'Assigned' else 'Reassigned' end,
      t.crew_id,lead_id,lead_id,p_actor_user_id,'Assigned Crew Lead policy reconciliation; confirmation required');
end; $$;

CREATE OR REPLACE FUNCTION public.start_operational_job(p_job_id uuid)
 RETURNS public.jobs_operational_safe
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform 1 from public.jobs where id=p_job_id for update;
 perform private.require_job_start_gps(p_job_id);
 if not exists(select 1 from public.jobs j
    join public.job_equipment_responsibility_tasks t on t.job_id=j.id
    join public.crews c on c.id=j.assigned_crew_id and c.status='Active' and c.archived_at is null
    where j.id=p_job_id and t.crew_id=j.assigned_crew_id
      and t.crew_lead_employee_id=c.crew_lead_id
      and exists(select 1 from public.job_equipment_assignments a where a.job_id=j.id and a.employee_id=c.crew_lead_id and a.released_at is null)
      and not exists(select 1 from public.job_equipment_assignments a where a.job_id=j.id and a.employee_id<>c.crew_lead_id and a.released_at is null)
      and exists(select 1 from public.user_profiles u where u.id=j.equipment_responsibility_confirmed_by and u.employee_id=c.crew_lead_id)
      and not exists(select 1 from public.job_equipment_handoffs h where h.job_id=j.id and h.acknowledged_at is null)
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
 perform 1 from public.jobs where id=p_job_id for update;
 perform private.require_job_start_gps(p_job_id);
 if not exists(select 1 from public.jobs j
    join public.job_equipment_responsibility_tasks t on t.job_id=j.id
    join public.crews c on c.id=j.assigned_crew_id and c.status='Active' and c.archived_at is null
    where j.id=p_job_id and t.crew_id=j.assigned_crew_id
      and t.crew_lead_employee_id=c.crew_lead_id
      and exists(select 1 from public.job_equipment_assignments a where a.job_id=j.id and a.employee_id=c.crew_lead_id and a.released_at is null)
      and not exists(select 1 from public.job_equipment_assignments a where a.job_id=j.id and a.employee_id<>c.crew_lead_id and a.released_at is null)
      and exists(select 1 from public.user_profiles u where u.id=j.equipment_responsibility_confirmed_by and u.employee_id=c.crew_lead_id)
      and not exists(select 1 from public.job_equipment_handoffs h where h.job_id=j.id and h.acknowledged_at is null)
      and t.responsible_employee_id=t.crew_lead_employee_id
      and j.equipment_responsibility_confirmed_at is not null) then
  raise exception 'Assigned Crew Lead must accept and confirm equipment responsibility before starting.';
 end if;
 return public.start_operational_job_with_presence_before_equipment(p_job_id,p_presence);
end $function$
;


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
  if not(exists(select 1 from public.crews c
    where c.id=j.assigned_crew_id and c.crew_lead_id=public.current_employee_id() and c.crew_lead_id=p_to_employee_id and c.archived_at is null and c.status='Active')) then
    raise exception 'Only the assigned Crew Lead can receive an equipment handoff.' using errcode='42501';
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
  perform private.reconcile_job_equipment_responsibility_task(p_job_id,j.assigned_crew_id,auth.uid());
  insert into public.job_equipment_handoffs(job_id,from_employee_id,to_employee_id,actor_user_id,reason)
    values(p_job_id,p_from_employee_id,p_to_employee_id,auth.uid(),p_reason) returning id into v_handoff;
  insert into public.job_equipment_notifications(job_id,employee_id,event_type,details)
    values(p_job_id,p_from_employee_id,'Equipment Released',jsonb_build_object('handoff',v_handoff)),
      (p_job_id,p_to_employee_id,'Equipment Handoff Pending',jsonb_build_object('handoff',v_handoff));
  -- Task synchronization is performed before creating the pending handoff.
  return v_handoff;
end;
$$;

create or replace function public.start_job_gps_trip(p_job_id uuid,p_vehicle_id uuid,p_position jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller_id uuid:=auth.uid(); caller_role text:=public.current_user_role(); e uuid:=public.current_employee_id();
 management boolean:=public.has_any_role(array['Master Admin','Administrator','Manager']); t public.job_mileage_trips; notification jsonb;
begin
 if caller_id is null or caller_role not in ('Master Admin','Administrator','Manager','Crew Lead','Scrub Technician')
  or not public.can_access_job(p_job_id) then raise exception 'GPS mileage access denied.' using errcode='42501'; end if;
 perform 1 from public.jobs where id=p_job_id and archived_at is null and status not in ('Completed','Cancelled','Archived') for update;
 if not found then raise exception 'Active or planned job required for GPS departure.'; end if;
 perform 1 from auth.users where id=caller_id for update;
 select * into t from public.job_mileage_trips where user_id=caller_id and job_id=p_job_id and status<>'Cancelled' for update;
 if found then return jsonb_build_object('trip',to_jsonb(t),'initiated',false); end if;
 if exists(select 1 from public.job_mileage_trips where user_id=caller_id and status='Active') then
  raise exception 'Another GPS trip is active. Open that Job to arrive or cancel it first.'; end if;
 perform public.validate_job_gps_position(p_position);
 perform 1 from public.vehicles v where v.id=p_vehicle_id and v.status='Active' and v.archived_at is null
  and (management or v.assigned_employee_id=e or public.is_assigned_to_crew(v.assigned_crew_id)) for share;
 if not found then
  if management then raise exception 'Select an active vehicle.'; end if;
  raise exception 'Select an active vehicle assigned to you or your crew.';
 end if;
 notification:=public.initiate_job_on_my_way(p_job_id);
 insert into public.job_mileage_trips(job_id,user_id,employee_id,vehicle_id,start_latitude,start_longitude,start_accuracy)
 values(p_job_id,caller_id,e,p_vehicle_id,(p_position->>'latitude')::double precision,(p_position->>'longitude')::double precision,(p_position->>'accuracy')::double precision)
 returning * into t;
 return jsonb_build_object('trip',to_jsonb(t),'initiated',notification->'initiated');
end $$;

-- Enforce the policy even through older authorized assignment/start entrypoints.
create or replace function private.guard_lead_equipment_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.released_at is null and not exists(select 1 from public.jobs j
    join public.crews c on c.id=j.assigned_crew_id
    where j.id=new.job_id and j.archived_at is null and j.status not in ('Completed','Cancelled','Archived')
      and c.crew_lead_id=new.employee_id and c.status='Active' and c.archived_at is null) then
    raise exception 'Only the assigned Crew Lead may hold active equipment responsibility.';
  end if;
  return new;
end; $$;
create trigger guard_lead_equipment_assignment before insert or update of employee_id,job_id,released_at
on public.job_equipment_assignments for each row execute function private.guard_lead_equipment_assignment();

create or replace function private.guard_lead_equipment_job_start()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='In Progress' and old.status is distinct from new.status and not exists(
    select 1 from public.crews c join public.job_equipment_responsibility_tasks t on t.job_id=new.id
    join public.user_profiles u on u.id=new.equipment_responsibility_confirmed_by
    where c.id=new.assigned_crew_id and c.status='Active' and c.archived_at is null
      and t.crew_id=c.id and t.crew_lead_employee_id=c.crew_lead_id
      and t.responsible_employee_id=c.crew_lead_id and u.employee_id=c.crew_lead_id
      and new.equipment_responsibility_confirmed_at is not null
      and exists(select 1 from public.job_equipment_assignments a where a.job_id=new.id and a.employee_id=c.crew_lead_id and a.released_at is null)
      and not exists(select 1 from public.job_equipment_assignments a where a.job_id=new.id and a.employee_id<>c.crew_lead_id and a.released_at is null)
      and not exists(select 1 from public.job_equipment_handoffs h where h.job_id=new.id and h.acknowledged_at is null)
  ) then raise exception 'Assigned Crew Lead must accept and confirm equipment responsibility before starting.'; end if;
  return new;
end; $$;
create trigger guard_lead_equipment_job_start before update of status on public.jobs
for each row execute function private.guard_lead_equipment_job_start();
revoke all on function private.guard_lead_equipment_assignment(),private.guard_lead_equipment_job_start(),
  private.reconcile_job_equipment_responsibility_task(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Backfill only unfinished jobs. Unsafe custody remains intact and gets a durable resolution flag.
do $$ declare j record; t public.job_equipment_responsibility_tasks;
begin
  for j in select id,assigned_crew_id from public.jobs where archived_at is null and status not in ('Completed','Cancelled','Archived') order by id loop
    begin
      perform private.reconcile_job_equipment_responsibility_task(j.id,j.assigned_crew_id,null);
    exception when raise_exception then
      select * into t from public.job_equipment_responsibility_tasks where job_id=j.id;
      if t.id is null then raise; end if;
      insert into public.job_equipment_responsibility_events(task_id,job_id,revision,event_type,crew_id,crew_lead_employee_id,responsible_employee_id,reason)
        values(t.id,j.id,t.revision,'Status Changed',t.crew_id,t.crew_lead_employee_id,t.responsible_employee_id,'RESOLUTION REQUIRED: '||sqlerrm);
      raise warning 'Equipment responsibility resolution required for job %: %',j.id,sqlerrm;
    end;
  end loop;
end; $$;

-- Catch existing departure-only stale trips without touching cancelled/completed history.
update public.job_mileage_trips t set status='Cancelled',ended_at=coalesce(t.ended_at,now()),updated_at=now()
from public.jobs j where j.id=t.job_id and (j.status in ('Completed','Cancelled','Archived') or j.archived_at is not null)
  and t.status='Active' and t.mileage_entry_id is null;
notify pgrst,'reload schema';
