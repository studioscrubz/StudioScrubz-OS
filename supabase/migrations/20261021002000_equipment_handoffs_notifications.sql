begin;
create or replace function public.handoff_job_equipment(p_job_id uuid,p_from_employee_id uuid,p_to_employee_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare j public.jobs; a public.job_equipment_assignments; v_handoff uuid;
begin
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Document the equipment handoff reason.'; end if;
 if p_from_employee_id=p_to_employee_id then raise exception 'Handoff requires two different custodians.'; end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or j.status in ('Completed','Cancelled','Archived') then raise exception 'Active or planned job required.'; end if;
 if not(public.has_role('Master Admin') or exists(select 1 from public.crews c where c.id=j.assigned_crew_id and c.crew_lead_id=public.current_employee_id())) then raise exception 'Assigned Crew Lead or Master Admin required.'; end if;
 select * into a from public.job_equipment_assignments where job_id=p_job_id and employee_id=p_from_employee_id and released_at is null for update;
 if not found then raise exception 'Outgoing custodian is not assigned.'; end if;
 if not exists(select 1 from public.employees e where e.id=p_to_employee_id and e.archived_at is null and e.employment_status='Active' and (e.id=j.assigned_employee_id or exists(select 1 from public.crew_members cm where cm.crew_id=j.assigned_crew_id and cm.employee_id=e.id) or exists(select 1 from public.crews c where c.id=j.assigned_crew_id and c.crew_lead_id=e.id))) then raise exception 'Incoming custodian must be assigned to this job.'; end if;
 if exists(select 1 from public.job_equipment_clearances c where c.assignment_id=a.id and c.status<>'Cleared') then raise exception 'Resolve outgoing custodian clearance first.'; end if;
 if j.status='In Progress' and not exists(select 1 from public.job_equipment_clearances c where c.assignment_id=a.id and c.checkpoint='End Job' and c.status='Cleared') then raise exception 'Outgoing custodian must clear issued equipment before transfer.'; end if;
 update public.job_equipment_assignments set released_at=now(),released_by_user_id=auth.uid(),release_reason=p_reason where id=a.id;
 insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details) values(a.id,'Reassigned',auth.uid(),jsonb_build_object('to',p_to_employee_id,'reason',p_reason));
 if not exists(select 1 from public.job_equipment_assignments where job_id=p_job_id and employee_id=p_to_employee_id and released_at is null) then
   insert into public.job_equipment_assignments(job_id,employee_id,assigned_by_user_id) values(p_job_id,p_to_employee_id,auth.uid());
 end if;
 insert into public.job_equipment_handoffs(job_id,from_employee_id,to_employee_id,actor_user_id,reason) values(p_job_id,p_from_employee_id,p_to_employee_id,auth.uid(),p_reason) returning id into v_handoff;
 insert into public.job_equipment_notifications(job_id,employee_id,event_type,details) values(p_job_id,p_from_employee_id,'Equipment Released',jsonb_build_object('handoff',v_handoff)),(p_job_id,p_to_employee_id,'Equipment Handoff Pending',jsonb_build_object('handoff',v_handoff));
 return v_handoff;
end; $$;
revoke all on function public.handoff_job_equipment(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.handoff_job_equipment(uuid,uuid,uuid,text) to authenticated;
create or replace function public.get_my_equipment_notifications()
returns table(id uuid,job_id uuid,event_type text,created_at timestamptz,details jsonb)
language sql security definer set search_path='' as $$
select n.id,n.job_id,n.event_type,n.created_at,n.details from public.job_equipment_notifications n
where auth.uid() is not null and n.employee_id=public.current_employee_id() and n.read_at is null order by n.created_at desc limit 30;
$$;
revoke all on function public.get_my_equipment_notifications() from public,anon,authenticated;
grant execute on function public.get_my_equipment_notifications() to authenticated;
create or replace function public.acknowledge_equipment_handoff(p_handoff_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare h public.job_equipment_handoffs;
begin
 select * into h from public.job_equipment_handoffs where id=p_handoff_id for update;
 if not found or h.to_employee_id<>public.current_employee_id() then raise exception 'Incoming custodian authorization required.'; end if;
 if h.acknowledged_at is not null then return; end if;
 update public.job_equipment_handoffs set acknowledged_at=now(),acknowledged_by=auth.uid() where id=p_handoff_id;
 update public.job_equipment_notifications set read_at=now() where employee_id=h.to_employee_id and details->>'handoff'=p_handoff_id::text;
end; $$;
revoke all on function public.acknowledge_equipment_handoff(uuid) from public,anon,authenticated;
grant execute on function public.acknowledge_equipment_handoff(uuid) to authenticated;
commit;
