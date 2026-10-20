-- Checkpoint enforcement. Run only after equipment tables and assignment RPC migrations.
begin;
create or replace function public.submit_job_equipment_clearance(
 p_job_id uuid,p_checkpoint text,p_items jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.job_equipment_assignments; c public.job_equipment_clearances; v_session uuid; v_item jsonb; v_name text; v_status text; v_kind text; v_id uuid; v_missing integer:=0; v_total integer:=0;
begin
 if auth.uid() is null or public.current_employee_id() is null then raise exception 'Authenticated employee required.'; end if;
 if p_checkpoint not in ('End Job','Final Sign Out') then raise exception 'Invalid equipment checkpoint.'; end if;
 select * into a from public.job_equipment_assignments where job_id=p_job_id and employee_id=public.current_employee_id() and released_at is null for update;
 if not found then raise exception 'You are not the assigned equipment custodian for this job.'; end if;
 if p_checkpoint='Final Sign Out' then
  select id into v_session from public.employee_work_sessions where employee_id=a.employee_id and status='Open' and clock_out is null order by clock_in desc limit 1;
  if v_session is null then raise exception 'An active work session is required for final equipment sign-out.'; end if;
 end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Complete the equipment checklist.'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) as x(value) group by x.value->>'name' having count(*)>1) then raise exception 'Duplicate checklist items are not allowed.'; end if;
 select * into c from public.job_equipment_clearances where assignment_id=a.id and checkpoint=p_checkpoint and work_session_id is not distinct from v_session for update;
 if found and c.submitted_at is not null then raise exception 'Equipment checkpoint already submitted; supervisor must resolve any missing items.'; end if;
 if found then
   -- Preserve resolved exception history; submitted checkpoints are immutable after an exception.
   if exists(select 1 from public.job_equipment_exceptions e join public.job_equipment_clearance_items i on i.id=e.clearance_item_id where i.clearance_id=c.id and e.resolved_at is null) then raise exception 'Missing equipment requires supervisor resolution before resubmission.'; end if;
   if exists(select 1 from public.job_equipment_clearance_items where clearance_id=c.id) then raise exception 'A submitted equipment checkpoint cannot be overwritten.'; end if;
 else
   insert into public.job_equipment_clearances(assignment_id,job_id,employee_id,work_session_id,checkpoint) values(a.id,p_job_id,a.employee_id,v_session,p_checkpoint) returning * into c;
 end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
   v_name:=nullif(btrim(v_item->>'name'),''); v_status:=v_item->>'status';v_kind:=v_item->>'kind';
   if v_name is null or v_status not in ('Checked','Not Needed','Missing') or v_kind not in ('Equipment','Supply') then raise exception 'Invalid equipment checklist item.'; end if;
   insert into public.job_equipment_clearance_items(clearance_id,item_name,item_kind,clearance_status,checked_at)
   values(c.id,v_name,v_kind,v_status,now()) returning id into v_id;
   if v_status='Missing' then
     if nullif(btrim(coalesce(v_item->>'description','')),'') is null then raise exception 'Missing equipment requires an explanation.'; end if;
     insert into public.job_equipment_exceptions(clearance_item_id,reported_by_user_id,description) values(v_id,auth.uid(),v_item->>'description');
     v_missing:=v_missing+1;
   end if;
   v_total:=v_total+1;
 end loop;
 update public.job_equipment_clearances set status=case when v_missing>0 then 'Exception Open' else 'Cleared' end,submitted_at=now(),cleared_at=case when v_missing=0 then now() else null end where id=c.id;
 return c.id;
end; $$;
revoke all on function public.submit_job_equipment_clearance(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.submit_job_equipment_clearance(uuid,text,jsonb) to authenticated;

create or replace function public.resolve_job_equipment_exception(p_exception_id uuid,p_resolution text)
returns void language plpgsql security definer set search_path='' as $$
declare v_clearance uuid;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Supervisor authorization required.'; end if;
 if nullif(btrim(coalesce(p_resolution,'')),'') is null then raise exception 'Resolution details required.'; end if;
 select i.clearance_id into v_clearance from public.job_equipment_exceptions e join public.job_equipment_clearance_items i on i.id=e.clearance_item_id where e.id=p_exception_id and e.resolved_at is null for update of e;
 if not found then raise exception 'Open equipment exception not found.'; end if;
 update public.job_equipment_exceptions set resolved_at=now(),resolved_by_user_id=auth.uid(),resolution=p_resolution where id=p_exception_id;
 if not exists(select 1 from public.job_equipment_exceptions e join public.job_equipment_clearance_items i on i.id=e.clearance_item_id where i.clearance_id=v_clearance and e.resolved_at is null) then
   update public.job_equipment_clearances set status='Cleared',cleared_at=now() where id=v_clearance;
 end if;
end; $$;
revoke all on function public.resolve_job_equipment_exception(uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_job_equipment_exception(uuid,text) to authenticated;

-- Rename legacy lifecycle routines, preserving their exact existing implementation.
alter function public.complete_in_progress_job(uuid) rename to complete_in_progress_job_before_equipment;
alter function public.stop_my_work() rename to stop_my_work_before_equipment;

create function public.complete_in_progress_job(p_job_id uuid)
returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
declare v_job public.jobs; v_unresolved integer;
begin
 select * into v_job from public.jobs where id=p_job_id for update;
 if not found then raise exception 'Job not found.'; end if;
 if v_job.status='In Progress' then
   select count(*) into v_unresolved from public.job_equipment_assignments a
   where a.job_id=p_job_id and a.released_at is null and not exists(
     select 1 from public.job_equipment_clearances c where c.assignment_id=a.id and c.checkpoint='End Job' and c.status='Cleared'
   );
   if v_unresolved>0 then raise exception '% equipment custodian(s) must complete End Job clearance.',v_unresolved; end if;
 end if;
 return public.complete_in_progress_job_before_equipment(p_job_id);
end; $$;
revoke all on function public.complete_in_progress_job(uuid) from public,anon,authenticated;
grant execute on function public.complete_in_progress_job(uuid) to authenticated;

create function public.stop_my_work()
returns public.employee_work_sessions language plpgsql security definer set search_path='' as $$
declare v_employee uuid; v_session public.employee_work_sessions; v_pending integer;
begin
 v_employee:=public.current_employee_id();
 if v_employee is null then raise exception 'Authenticated employee required.'; end if;
 select * into v_session from public.employee_work_sessions where employee_id=v_employee and status='Open' and clock_out is null order by clock_in desc limit 1 for update;
 if found then
   select count(*) into v_pending from public.job_equipment_assignments a
   join public.jobs j on j.id=a.job_id
   where a.employee_id=v_employee and a.released_at is null
   and j.operational_started_at is not null and j.status='Completed'
   and j.completed_at>=v_session.clock_in
   and not exists(select 1 from public.job_equipment_clearances c where c.assignment_id=a.id and c.checkpoint='Final Sign Out' and c.work_session_id=v_session.id and c.status='Cleared');
   if v_pending>0 then raise exception '% job equipment final sign-out clearance(s) required.',v_pending; end if;
 end if;
 return public.stop_my_work_before_equipment();
end; $$;
revoke all on function public.stop_my_work() from public,anon,authenticated;
grant execute on function public.stop_my_work() to authenticated;
commit;