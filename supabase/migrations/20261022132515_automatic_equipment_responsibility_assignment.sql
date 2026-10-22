-- Automatic, single-owner equipment responsibility workflow for assigned crews.
begin;

create table public.job_equipment_responsibility_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete restrict,
  crew_id uuid references public.crews(id) on delete restrict,
  crew_lead_employee_id uuid references public.employees(id) on delete restrict,
  responsible_employee_id uuid references public.employees(id) on delete restrict,
  status text not null default 'Pending Assignment' check (status in (
    'Pending Assignment','Assigned','Check-Off In Progress','Check-Off Complete','Return Pending','Reconciled'
  )),
  revision integer not null default 1 check (revision > 0),
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'Pending Assignment' and responsible_employee_id is null and assigned_at is null)
    or (status <> 'Pending Assignment' and responsible_employee_id is not null and assigned_at is not null))
);

create table public.job_equipment_responsibility_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.job_equipment_responsibility_tasks(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete restrict,
  revision integer not null,
  event_type text not null check (event_type in ('Pending','Assigned','Reassigned','Status Changed','Crew Removed')),
  crew_id uuid references public.crews(id) on delete restrict,
  crew_lead_employee_id uuid references public.employees(id) on delete restrict,
  responsible_employee_id uuid references public.employees(id) on delete restrict,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  reason text not null,
  occurred_at timestamptz not null default now()
);
create index job_equipment_responsibility_events_job_idx
  on public.job_equipment_responsibility_events(job_id, occurred_at desc);

alter table public.job_equipment_responsibility_tasks enable row level security;
alter table public.job_equipment_responsibility_events enable row level security;
revoke all on public.job_equipment_responsibility_tasks, public.job_equipment_responsibility_events
  from public, anon, authenticated;
grant select, insert, update on public.job_equipment_responsibility_tasks to service_role;
grant select, insert on public.job_equipment_responsibility_events to service_role;
grant select on public.job_equipment_responsibility_tasks to authenticated;
create policy job_equipment_responsibility_tasks_authorized_read
on public.job_equipment_responsibility_tasks for select to authenticated using (
  auth.uid() is not null and (
    public.has_any_role(array['Master Admin','Administrator','Manager'])
    or public.current_employee_id()=crew_lead_employee_id
    or public.current_employee_id()=responsible_employee_id
  )
);
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='job_equipment_responsibility_tasks') then
    alter publication supabase_realtime add table public.job_equipment_responsibility_tasks;
  end if;
end $$;

create function private.protect_job_equipment_responsibility_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Equipment responsibility history is append-only.';
end; $$;
create trigger job_equipment_responsibility_events_append_only
before update or delete on public.job_equipment_responsibility_events
for each row execute function private.protect_job_equipment_responsibility_event();

create function private.reconcile_job_equipment_responsibility_task(
  p_job_id uuid, p_assigned_crew_id uuid, p_actor_user_id uuid
) returns void language plpgsql security definer set search_path='' as $$
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
  if retained_employee is not null and not (
    retained_employee=lead_id or exists(select 1 from public.crew_members cm
      where cm.crew_id=p_assigned_crew_id and cm.employee_id=retained_employee)
  ) then
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
  insert into public.job_equipment_responsibility_events(task_id,job_id,revision,event_type,crew_id,crew_lead_employee_id,responsible_employee_id,reason)
  values(current_task.id,p_job_id,next_revision,case when retained_employee is null then 'Pending' else 'Status Changed' end,
    p_assigned_crew_id,lead_id,retained_employee,'Crew or Crew Lead changed; responsibility revalidated');
end; $$;

create function private.sync_job_equipment_responsibility_task()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.reconcile_job_equipment_responsibility_task(new.id,new.assigned_crew_id,auth.uid());
  return new;
end; $$;

create function private.sync_crew_equipment_responsibility_tasks()
returns trigger language plpgsql security definer set search_path='' as $$
declare affected_job record;
begin
  if new.crew_lead_id is not distinct from old.crew_lead_id
    and new.status is not distinct from old.status
    and new.archived_at is not distinct from old.archived_at then
    return new;
  end if;
  for affected_job in
    select j.id,j.assigned_crew_id from public.jobs j
    where j.assigned_crew_id=new.id
  loop
    perform private.reconcile_job_equipment_responsibility_task(
      affected_job.id,affected_job.assigned_crew_id,auth.uid()
    );
  end loop;
  return new;
end; $$;

create trigger sync_job_equipment_responsibility_task
after insert or update of assigned_crew_id on public.jobs
for each row execute function private.sync_job_equipment_responsibility_task();

create trigger sync_crew_equipment_responsibility_tasks
after update of crew_lead_id,status,archived_at on public.crews
for each row execute function private.sync_crew_equipment_responsibility_tasks();

-- Backfill existing eligible planned and active jobs without changing their lifecycle.
insert into public.job_equipment_responsibility_tasks(job_id,crew_id,crew_lead_employee_id,responsible_employee_id,status,assigned_at)
select j.id,j.assigned_crew_id,c.crew_lead_id,a.employee_id,
  case when a.employee_id is null then 'Pending Assignment' else 'Assigned' end,a.assigned_at
from public.jobs j join public.crews c on c.id=j.assigned_crew_id and c.archived_at is null and c.status='Active' and c.crew_lead_id is not null
left join lateral (select x.employee_id,x.assigned_at from public.job_equipment_assignments x
  where x.job_id=j.id and x.released_at is null order by x.assigned_at limit 1) a on true
where j.archived_at is null and j.status not in ('Completed','Cancelled','Archived')
on conflict(job_id) do nothing;
insert into public.job_equipment_responsibility_events(task_id,job_id,revision,event_type,crew_id,crew_lead_employee_id,responsible_employee_id,reason)
select t.id,t.job_id,t.revision,case when t.responsible_employee_id is null then 'Pending' else 'Assigned' end,
  t.crew_id,t.crew_lead_employee_id,t.responsible_employee_id,'Existing job responsibility imported'
from public.job_equipment_responsibility_tasks t
where not exists(select 1 from public.job_equipment_responsibility_events e where e.task_id=t.id);

create or replace function public.set_job_equipment_responsibility(
 p_job_id uuid, p_employee_ids uuid[], p_reason text default null
) returns integer language plpgsql security definer set search_path='' as $$
declare j public.jobs; task public.job_equipment_responsibility_tasks; chosen uuid; actor uuid:=auth.uid(); old_employee uuid; assignment public.job_equipment_assignments;
begin
 if actor is null then raise exception 'Authentication required.'; end if;
 if p_employee_ids is null or cardinality(p_employee_ids)<>1 or p_employee_ids[1] is null then
   raise exception 'Select exactly one responsible crew member.';
 end if;
 chosen:=p_employee_ids[1];
 select * into j from public.jobs where id=p_job_id for update;
 if not found or j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') then raise exception 'Equipment responsibility requires an active or planned Job.'; end if;
 select * into task from public.job_equipment_responsibility_tasks where job_id=p_job_id for update;
 if not found or task.crew_id is distinct from j.assigned_crew_id or task.crew_lead_employee_id is null then raise exception 'An assigned crew with a Crew Lead is required.'; end if;
 if not (public.has_role('Master Admin') or (public.has_role('Crew Lead') and public.current_employee_id()=task.crew_lead_employee_id)) then
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
 select * into assignment from public.job_equipment_assignments where job_id=p_job_id and employee_id=chosen and released_at is null;
 if not found then
   insert into public.job_equipment_assignments(job_id,employee_id,assigned_by_user_id) values(p_job_id,chosen,actor) returning * into assignment;
   insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details)
   values(assignment.id,case when public.has_role('Master Admin') then 'Master Admin Override' else 'Assigned' end,actor,jsonb_build_object('reason',coalesce(p_reason,'')));
 end if;
 if old_employee is distinct from chosen or task.status='Pending Assignment' then
   update public.job_equipment_responsibility_tasks set responsible_employee_id=chosen,status='Assigned',
     assigned_at=now(),revision=revision+1,updated_at=now() where id=task.id returning * into task;
   insert into public.job_equipment_responsibility_events(task_id,job_id,revision,event_type,crew_id,crew_lead_employee_id,responsible_employee_id,actor_user_id,reason)
   values(task.id,p_job_id,task.revision,case when old_employee is null then 'Assigned' else 'Reassigned' end,
     task.crew_id,task.crew_lead_employee_id,chosen,actor,coalesce(nullif(btrim(p_reason),''),'Crew Lead designation'));
 end if;
 update public.jobs set equipment_responsibility_confirmed_at=null,equipment_responsibility_confirmed_by=null where id=p_job_id;
 return 1;
end; $$;

create or replace function public.confirm_job_equipment_responsibility(p_job_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs; task public.job_equipment_responsibility_tasks;
begin
 select * into j from public.jobs where id=p_job_id for update;
 select * into task from public.job_equipment_responsibility_tasks where job_id=p_job_id for update;
 if not found or task.responsible_employee_id is null or task.status='Pending Assignment' then raise exception 'Select one responsible crew member before confirming.'; end if;
 if j.status in ('Completed','Cancelled','Archived') then raise exception 'Active job required.'; end if;
 if not (public.has_role('Master Admin') or (public.has_role('Crew Lead') and public.current_employee_id()=task.crew_lead_employee_id)) then raise exception 'Assigned Crew Lead or Master Admin required.' using errcode='42501'; end if;
 if exists(select 1 from public.job_equipment_handoffs h where h.job_id=p_job_id and h.acknowledged_at is null) then raise exception 'Incoming custodians must acknowledge outstanding equipment handoffs before job start.'; end if;
 update public.jobs set equipment_responsibility_confirmed_at=now(),equipment_responsibility_confirmed_by=auth.uid() where id=p_job_id;
end; $$;

create function public.get_job_equipment_responsibility(p_job_id uuid)
returns table(task_id uuid,crew_id uuid,crew_lead_employee_id uuid,responsible_employee_id uuid,responsible_name text,status text,revision integer,assigned_at timestamptz,updated_at timestamptz)
language sql security definer set search_path='' as $$
select t.id,t.crew_id,t.crew_lead_employee_id,t.responsible_employee_id,
 coalesce(nullif(btrim(e.preferred_name),''),nullif(btrim(concat_ws(' ',e.first_name,e.last_name)),'')),t.status,t.revision,t.assigned_at,t.updated_at
from public.job_equipment_responsibility_tasks t join public.jobs j on j.id=t.job_id
left join public.employees e on e.id=t.responsible_employee_id
where t.job_id=p_job_id and auth.uid() is not null and (
 public.has_any_role(array['Master Admin','Administrator','Manager']) or j.assigned_employee_id=public.current_employee_id() or public.is_assigned_to_crew(j.assigned_crew_id));
$$;

create function public.get_my_equipment_responsibility_tasks()
returns table(task_id uuid,job_id uuid,job_number text,crew_id uuid,crew_lead_employee_id uuid,responsible_employee_id uuid,status text,revision integer,assigned_at timestamptz,created_at timestamptz,updated_at timestamptz)
language sql security definer set search_path='' as $$
select t.id,t.job_id,j.job_number,t.crew_id,t.crew_lead_employee_id,t.responsible_employee_id,t.status,t.revision,t.assigned_at,t.created_at,t.updated_at
from public.job_equipment_responsibility_tasks t join public.jobs j on j.id=t.job_id
where auth.uid() is not null and j.archived_at is null and j.status not in ('Cancelled','Archived')
and (public.has_role('Master Admin') or public.current_employee_id() in (t.crew_lead_employee_id,t.responsible_employee_id));
$$;

create or replace function public.save_job_equipment_checklist_progress(p_job_id uuid,p_checkpoint text,p_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.job_equipment_assignments; c public.job_equipment_clearances; v_session uuid; v_item jsonb; v_name text; v_status text; v_kind text;
begin
 if auth.uid() is null or public.current_employee_id() is null then raise exception 'Authenticated employee required.'; end if;
 if p_checkpoint not in ('End Job','Final Sign Out') then raise exception 'Invalid equipment checkpoint.'; end if;
 select * into a from public.job_equipment_assignments where job_id=p_job_id and employee_id=public.current_employee_id() and released_at is null for update;
 if not found then raise exception 'You are not the assigned equipment custodian for this job.' using errcode='42501'; end if;
 if p_checkpoint='Final Sign Out' then select id into v_session from public.employee_work_sessions where employee_id=a.employee_id and status='Open' and clock_out is null order by clock_in desc limit 1; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Equipment checklist progress is required.'; end if;
 select * into c from public.job_equipment_clearances where assignment_id=a.id and checkpoint=p_checkpoint and work_session_id is not distinct from v_session for update;
 if found and c.submitted_at is not null then raise exception 'A submitted equipment checkpoint cannot be changed.'; end if;
 if not found then insert into public.job_equipment_clearances(assignment_id,job_id,employee_id,work_session_id,checkpoint) values(a.id,p_job_id,a.employee_id,v_session,p_checkpoint) returning * into c; end if;
 delete from public.job_equipment_clearance_items where clearance_id=c.id;
 for v_item in select value from jsonb_array_elements(p_items) loop
   v_name:=nullif(btrim(v_item->>'name'),'');v_status:=coalesce(v_item->>'status','Pending');v_kind:=v_item->>'kind';
   if v_name is null or v_status not in ('Pending','Checked','Not Needed','Missing') or v_kind not in ('Equipment','Supply') then raise exception 'Invalid equipment checklist item.'; end if;
   insert into public.job_equipment_clearance_items(clearance_id,item_name,item_kind,clearance_status,checked_at)
   values(c.id,v_name,v_kind,v_status,case when v_status='Pending' then null else now() end);
 end loop;
 update public.job_equipment_responsibility_tasks set status='Check-Off In Progress',updated_at=now()
 where job_id=p_job_id and responsible_employee_id=a.employee_id and status='Assigned';
 return c.id;
end; $$;

create function public.get_my_job_equipment_checklist(p_job_id uuid,p_checkpoint text)
returns table(name text,kind text,status text,description text,submitted boolean)
language sql security definer set search_path='' as $$
select i.item_name,i.item_kind,i.clearance_status,
 (select e.description from public.job_equipment_exceptions e where e.clearance_item_id=i.id order by e.reported_at desc limit 1),c.submitted_at is not null
from public.job_equipment_assignments a join public.job_equipment_clearances c on c.assignment_id=a.id
join public.job_equipment_clearance_items i on i.clearance_id=c.id
where a.job_id=p_job_id and a.employee_id=public.current_employee_id() and a.released_at is null
and c.checkpoint=p_checkpoint and auth.uid() is not null order by i.id;
$$;

-- Draft items may be replaced until submission; preserve submitted evidence.
create or replace function public.submit_job_equipment_clearance(p_job_id uuid,p_checkpoint text,p_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.job_equipment_assignments;c public.job_equipment_clearances;v_session uuid;v_item jsonb;v_name text;v_status text;v_kind text;v_id uuid;v_missing integer:=0;
begin
 if auth.uid() is null or public.current_employee_id() is null then raise exception 'Authenticated employee required.'; end if;
 if p_checkpoint not in ('End Job','Final Sign Out') then raise exception 'Invalid equipment checkpoint.'; end if;
 select * into a from public.job_equipment_assignments where job_id=p_job_id and employee_id=public.current_employee_id() and released_at is null for update;
 if not found then raise exception 'You are not the assigned equipment custodian for this job.' using errcode='42501'; end if;
 if p_checkpoint='Final Sign Out' then select id into v_session from public.employee_work_sessions where employee_id=a.employee_id and status='Open' and clock_out is null order by clock_in desc limit 1; if v_session is null then raise exception 'An active work session is required for final equipment sign-out.'; end if; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Complete the equipment checklist.'; end if;
 select * into c from public.job_equipment_clearances where assignment_id=a.id and checkpoint=p_checkpoint and work_session_id is not distinct from v_session for update;
 if found and c.submitted_at is not null then raise exception 'Equipment checkpoint already submitted.'; end if;
 if not found then insert into public.job_equipment_clearances(assignment_id,job_id,employee_id,work_session_id,checkpoint) values(a.id,p_job_id,a.employee_id,v_session,p_checkpoint) returning * into c; end if;
 delete from public.job_equipment_clearance_items where clearance_id=c.id;
 for v_item in select value from jsonb_array_elements(p_items) loop
   v_name:=nullif(btrim(v_item->>'name'),'');v_status:=v_item->>'status';v_kind:=v_item->>'kind';
   if v_name is null or v_status not in ('Checked','Not Needed','Missing') or v_kind not in ('Equipment','Supply') then raise exception 'Verify every equipment checklist item.'; end if;
   insert into public.job_equipment_clearance_items(clearance_id,item_name,item_kind,clearance_status,checked_at) values(c.id,v_name,v_kind,v_status,now()) returning id into v_id;
   if v_status='Missing' then if nullif(btrim(coalesce(v_item->>'description','')),'') is null then raise exception 'Missing or damaged equipment requires an explanation.'; end if; insert into public.job_equipment_exceptions(clearance_item_id,reported_by_user_id,description) values(v_id,auth.uid(),v_item->>'description');v_missing:=v_missing+1; end if;
 end loop;
 update public.job_equipment_clearances set status=case when v_missing>0 then 'Exception Open' else 'Cleared' end,submitted_at=now(),cleared_at=case when v_missing=0 then now() else null end where id=c.id;
 update public.job_equipment_responsibility_tasks set status=case when p_checkpoint='Final Sign Out' and v_missing=0 then 'Reconciled' when p_checkpoint='Final Sign Out' then 'Return Pending' else 'Check-Off Complete' end,updated_at=now()
 where job_id=p_job_id and responsible_employee_id=a.employee_id;
 return c.id;
end; $$;

create or replace function public.resolve_job_equipment_exception(p_exception_id uuid,p_resolution text)
returns void language plpgsql security definer set search_path='' as $$
declare v_clearance public.job_equipment_clearances;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Supervisor authorization required.' using errcode='42501'; end if;
 if nullif(btrim(coalesce(p_resolution,'')),'') is null then raise exception 'Resolution details required.'; end if;
 select c.* into v_clearance from public.job_equipment_exceptions e join public.job_equipment_clearance_items i on i.id=e.clearance_item_id join public.job_equipment_clearances c on c.id=i.clearance_id where e.id=p_exception_id and e.resolved_at is null for update of e;
 if not found then raise exception 'Open equipment exception not found.'; end if;
 update public.job_equipment_exceptions set resolved_at=now(),resolved_by_user_id=auth.uid(),resolution=p_resolution where id=p_exception_id;
 if not exists(select 1 from public.job_equipment_exceptions e join public.job_equipment_clearance_items i on i.id=e.clearance_item_id where i.clearance_id=v_clearance.id and e.resolved_at is null) then
   update public.job_equipment_clearances set status='Cleared',cleared_at=now() where id=v_clearance.id;
   if v_clearance.checkpoint='Final Sign Out' then update public.job_equipment_responsibility_tasks set status='Reconciled',updated_at=now() where job_id=v_clearance.job_id and responsible_employee_id=v_clearance.employee_id; end if;
 end if;
end; $$;

create function private.update_equipment_task_for_job_status()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='Completed' and old.status is distinct from new.status then
   update public.job_equipment_responsibility_tasks set status='Return Pending',updated_at=now()
   where job_id=new.id and responsible_employee_id is not null and status<>'Reconciled';
 end if;
 return new;
end; $$;
create trigger update_equipment_task_for_job_status after update of status on public.jobs
for each row execute function private.update_equipment_task_for_job_status();

revoke all on function public.set_job_equipment_responsibility(uuid,uuid[],text),
 public.confirm_job_equipment_responsibility(uuid),public.get_job_equipment_responsibility(uuid),
 public.get_my_equipment_responsibility_tasks(),public.save_job_equipment_checklist_progress(uuid,text,jsonb),
 public.get_my_job_equipment_checklist(uuid,text) from public,anon,authenticated;
grant execute on function public.set_job_equipment_responsibility(uuid,uuid[],text),
 public.confirm_job_equipment_responsibility(uuid),public.get_job_equipment_responsibility(uuid),
 public.get_my_equipment_responsibility_tasks(),public.save_job_equipment_checklist_progress(uuid,text,jsonb),
 public.get_my_job_equipment_checklist(uuid,text) to authenticated;
revoke all on function private.protect_job_equipment_responsibility_event(),
 private.reconcile_job_equipment_responsibility_task(uuid,uuid,uuid),
 private.sync_job_equipment_responsibility_task(),private.sync_crew_equipment_responsibility_tasks(),
 private.update_equipment_task_for_job_status() from public,anon,authenticated;

-- Trigger helpers from the earlier equipment migration are not API surfaces.
revoke all on function public.equipment_assignment_changed(),public.equipment_assignment_released()
from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
