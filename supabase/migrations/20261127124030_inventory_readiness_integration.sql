-- Extends existing custody and clearance; inspection history retains its own requirements snapshot.
create table public.technician_kit_definitions (
 id text primary key, name text not null, service_names text[] not null default '{}', version integer not null default 1 check(version>0)
);
insert into public.technician_kit_definitions values
 ('standard','Standard Cleaning',array['Standard Cleaning','Residential Standard Cleaning'],1),
 ('deep','Deep Cleaning',array['Deep Cleaning','Residential Deep Cleaning'],1),
 ('move-in-out','Move-In/Out',array['Move-In/Out','Move-In/Out Cleaning','Move In/Out Cleaning'],1);
create table public.technician_kit_members (
 kit_id text not null references public.technician_kit_definitions(id),
 item_key text not null references public.technician_kit_standard_items(item_key),
 minimum_quantity numeric not null check(minimum_quantity>0), primary key(kit_id,item_key)
);
insert into public.technician_kit_members
select d.id,i.item_key,case when i.kit='essentials' then 1 else i.target end
from public.technician_kit_definitions d cross join public.technician_kit_standard_items i
where i.parent_key is null and (i.kit in ('essentials','standard') or (d.id<>'standard' and i.kit='deep'));
create table public.job_inventory_kit_scope (
 job_id uuid primary key references public.jobs(id), kit_id text references public.technician_kit_definitions(id),
 specialty_items text[] not null default '{}', updated_by uuid not null references public.user_profiles(id),updated_at timestamptz not null default now()
);
create table public.job_inventory_inspections (
 inspection_sequence bigint generated always as identity unique, id uuid primary key,job_id uuid not null references public.jobs(id),employee_id uuid not null references public.employees(id),
 actor uuid not null references public.user_profiles(id), work_session_id uuid not null references public.employee_work_sessions(id),
 payroll_entry_id uuid not null references public.time_entries(id),
 requirements jsonb not null,results jsonb not null,ready boolean not null,created_at timestamptz not null default now()
);
create index job_inventory_inspection_job on public.job_inventory_inspections(job_id,created_at desc);
do $$ declare t text; begin
 foreach t in array array['technician_kit_definitions','technician_kit_members','job_inventory_kit_scope','job_inventory_inspections'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create trigger inventory_audit after insert or update or delete on public.%I for each row execute function private.inventory_audit()',t);
 end loop;
end $$;
create policy inventory_kits_read on public.technician_kit_definitions for select to authenticated using(private.inventory_employee() or private.inventory_manager());
create policy inventory_members_read on public.technician_kit_members for select to authenticated using(private.inventory_employee() or private.inventory_manager());
create policy inventory_scope_read on public.job_inventory_kit_scope for select to authenticated using((private.inventory_employee() and public.can_access_job(job_id)) or private.inventory_manager());
create policy inventory_inspections_read on public.job_inventory_inspections for select to authenticated using(private.inventory_manager() or (private.inventory_employee() and employee_id=public.current_employee_id()));

create function private.inventory_job_worker(p_job uuid) returns uuid language sql stable security definer set search_path='' as $$
 select case when j.assigned_crew_id is null then j.assigned_employee_id else j.assigned_crew_lead_id end
 from public.jobs j where j.id=p_job and j.archived_at is null and j.status not in ('Completed','Cancelled','Archived')
$$;
revoke all on function private.inventory_job_worker(uuid) from public,anon,authenticated;
create function private.inventory_job_requirements(p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_kit text; specialties text[]; result jsonb; begin
 select s.kit_id,s.specialty_items into v_kit,specialties from public.job_inventory_kit_scope s where s.job_id=p_job;
 if v_kit is null then
 select d.id into v_kit from public.technician_kit_definitions d join public.jobs_operational_safe j on j.id=p_job and j.division='Residential' and j.service_name=any(d.service_names);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('key',x.key,'name',x.name,'minimum',x.minimum,'target',x.target,'threshold',x.threshold,'unit',x.unit,'version',x.version) order by x.key),'[]'::jsonb) into result from (
 select i.item_key as key,i.item_name as name,coalesce(m.minimum_quantity,i.target) as minimum,i.target,i.restock_at as threshold,i.unit,i.standard_version as version
 from public.technician_kit_standard_items i left join public.technician_kit_members m on m.item_key=i.item_key and m.kit_id=v_kit
 where (m.item_key is not null or i.item_key=any(coalesce(specialties,'{}'))) and i.item_key<>'microfiber'
 union all
 select i.item_key,i.item_name,1,i.target,i.restock_at,i.unit,i.standard_version from public.technician_kit_standard_items i
 where i.stock_state='clean' and exists(select 1 from public.technician_kit_members where kit_id=v_kit and item_key='microfiber')
 union all
 select 'catalog:'||c.item_name,c.item_name,1,1,null,'each','existing-catalog'
 from public.get_job_equipment_catalog(p_job) c where v_kit is null
 union all select 'safety:labels','Chemical containers correctly identified and labeled',1,1,null,'confirmation','1'
 union all select 'safety:function','Equipment functional and safe for this assignment',1,1,null,'confirmation','1'
 union all select 'safety:adequate','Supplies sufficient for assigned scope of work',1,1,null,'confirmation','1'
 ) x;
 return result;
end $$;
revoke all on function private.inventory_job_requirements(uuid) from public,anon,authenticated;
create function public.inventory_job_requirements(p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if not private.inventory_manager() and not (private.inventory_employee() and public.current_employee_id()=private.inventory_job_worker(p_job)) then raise exception 'Assigned equipment verifier required' using errcode='42501'; end if;
 return private.inventory_job_requirements(p_job);
end $$;
create function public.inventory_set_job_scope(p_job uuid,p_kit text,p_specialties text[]) returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.inventory_manager() then raise exception 'Inventory manager required' using errcode='42501'; end if;
 if exists(select 1 from unnest(p_specialties) k where not exists(select 1 from public.technician_kit_standard_items i where i.item_key=k and i.kit='specialty' and i.parent_key is null and i.item_key not like 'bulk_%')) then raise exception 'Invalid specialty requirement'; end if;
 insert into public.job_inventory_kit_scope(job_id,kit_id,specialty_items,updated_by) values(p_job,p_kit,p_specialties,auth.uid())
 on conflict(job_id) do update set kit_id=excluded.kit_id,specialty_items=excluded.specialty_items,updated_by=auth.uid(),updated_at=now();
 update public.jobs set equipment_responsibility_confirmed_at=null,equipment_responsibility_confirmed_by=null where id=p_job;
end $$;
create function public.inventory_begin_preparation(p_job uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare payroll public.time_entries; crew uuid; begin
 if not private.inventory_employee() or public.current_employee_id() is distinct from private.inventory_job_worker(p_job) then raise exception 'Assigned verifier required' using errcode='42501'; end if;
 select assigned_crew_id into crew from public.jobs where id=p_job for update;
 perform public.ensure_employee_platform_active(public.current_employee_id());
 payroll:=public.open_job_payroll_entry(p_job,public.current_employee_id(),crew,now());
 insert into public.technician_inventory_audit(table_name,record_id,actor,after_row) values('inventory_paid_preparation',p_job::text,auth.uid(),jsonb_build_object('payroll_entry_id',payroll.id));
 return payroll.id;
end $$;
create function public.inventory_end_preparation(p_job uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.inventory_employee() or public.current_employee_id() is distinct from private.inventory_job_worker(p_job) then raise exception 'Assigned verifier required' using errcode='42501'; end if;
 perform id from public.jobs where id=p_job and status in ('Scheduled','Crew Assigned') for update;
 if not found then raise exception 'Use the existing end-job procedure for a started job'; end if;
 if exists(select 1 from public.time_entries where job_id=p_job and status='Open' and clock_out is null and archived_at is null and employee_id<>public.current_employee_id()) then raise exception 'Management must reconcile other open job payroll entries'; end if;
 perform public.close_job_payroll_entries(p_job,now());
 update public.jobs set equipment_responsibility_confirmed_at=null,equipment_responsibility_confirmed_by=null where id=p_job;
end $$;
revoke all on function public.inventory_begin_preparation(uuid),public.inventory_end_preparation(uuid) from public,anon,authenticated;
grant execute on function public.inventory_begin_preparation(uuid),public.inventory_end_preparation(uuid) to authenticated;
create function public.inventory_submit_inspection(p_id uuid,p_job uuid,p_requirements jsonb,p_results jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare expected jsonb; req jsonb; entry jsonb; session_id uuid; payroll_id uuid; passed boolean:=true; previous public.job_inventory_inspections; quantity numeric; begin
 if not private.inventory_employee() or public.current_employee_id() is distinct from private.inventory_job_worker(p_job) then raise exception 'Assigned verifier required' using errcode='42501'; end if;
 perform id from public.jobs where id=p_job for update;
 perform pg_advisory_xact_lock(hashtextextended('inspection:'||p_id::text,0));
 select * into previous from public.job_inventory_inspections where id=p_id;
 if found then
 if previous.job_id<>p_job or previous.actor<>auth.uid() or previous.requirements<>p_requirements or previous.results<>p_results then raise exception 'Inspection key already used'; end if;
 return previous.ready;
 end if;
 select id into session_id from public.employee_work_sessions where employee_id=public.current_employee_id() and clock_out is null order by clock_in desc limit 1;
 if session_id is null then raise exception 'Clock in for compensated preparation before checking equipment'; end if;
 select id into payroll_id from public.time_entries where employee_id=public.current_employee_id() and job_id=p_job and status='Open' and clock_out is null and archived_at is null order by clock_in desc limit 1;
 if payroll_id is null then raise exception 'Begin paid equipment preparation; platform presence alone is not payable'; end if;
 expected:=public.inventory_job_requirements(p_job);
 if expected<>p_requirements then raise exception 'Kit requirements changed. Reload the checklist'; end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)<>jsonb_array_length(expected) or
 (select count(distinct x->>'key') from jsonb_array_elements(p_results) x)<>jsonb_array_length(expected) then raise exception 'Complete each mandatory item exactly once'; end if;
 for req in select * from jsonb_array_elements(expected) loop
 select x into entry from jsonb_array_elements(p_results) x where x->>'key'=req->>'key';
 if entry is null or entry->>'status' is null or entry->>'status' not in ('checked','missing','insufficient','damaged','defective') then raise exception 'Mandatory items cannot be marked Not Needed'; end if;
 if entry->>'status'<>'checked' then
 passed:=false;
 if nullif(btrim(entry->>'notes'),'') is null then raise exception 'Describe each equipment exception'; end if;
 else
 quantity:=(entry->>'quantity')::numeric;
 if quantity is null or quantity::text in ('NaN','Infinity','-Infinity') or quantity<(req->>'minimum')::numeric then passed:=false; end if;
 end if;
 end loop;
 if exists(select 1 from public.technician_equipment_assets a join public.technician_inventory_locations l on l.id=a.location_id
 join public.jobs j on j.id=p_job where (l.employee_id=public.current_employee_id() or l.crew_id=j.assigned_crew_id)
 and a.condition in ('needs_maintenance','out_of_service','missing')) then passed:=false; end if;
 insert into public.job_inventory_inspections(id,job_id,employee_id,actor,work_session_id,payroll_entry_id,requirements,results,ready)
 values(p_id,p_job,public.current_employee_id(),auth.uid(),session_id,payroll_id,expected,p_results,passed);
 update public.jobs set equipment_responsibility_confirmed_at=null,equipment_responsibility_confirmed_by=null where id=p_job;
 return passed;
end $$;
revoke all on function public.inventory_job_requirements(uuid),public.inventory_set_job_scope(uuid,text,text[]),public.inventory_submit_inspection(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.inventory_job_requirements(uuid),public.inventory_set_job_scope(uuid,text,text[]),public.inventory_submit_inspection(uuid,uuid,jsonb,jsonb) to authenticated;

-- Keep all established handoff and crew custody authorization in the original implementation.
alter function public.confirm_job_equipment_responsibility(uuid) rename to confirm_job_equipment_responsibility_before_inventory;
revoke all on function public.confirm_job_equipment_responsibility_before_inventory(uuid) from public,anon,authenticated;
create function public.confirm_job_equipment_responsibility(p_job_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare latest public.job_inventory_inspections; j public.jobs; assignment_id uuid; begin
 if not private.inventory_employee() or public.current_employee_id() is distinct from private.inventory_job_worker(p_job_id) then raise exception 'Assigned verifier required' using errcode='42501'; end if;
 perform id from public.jobs where id=p_job_id for update;
 select i.* into latest from public.job_inventory_inspections i join public.employee_work_sessions s on s.id=i.work_session_id and s.clock_out is null
 where i.job_id=p_job_id and i.employee_id=public.current_employee_id() order by i.inspection_sequence desc limit 1;
 if latest.id is null or not latest.ready or latest.requirements<>public.inventory_job_requirements(p_job_id) then raise exception 'Complete a safe, current equipment inspection during paid working time'; end if;
 select * into j from public.jobs where id=p_job_id;
 if j.assigned_crew_id is not null then
 perform public.confirm_job_equipment_responsibility_before_inventory(p_job_id);
 else
 if exists(select 1 from public.job_equipment_handoffs where job_id=p_job_id and acknowledged_at is null) then raise exception 'Acknowledge outstanding equipment handoffs first'; end if;
 if exists(select 1 from public.job_equipment_assignments where job_id=p_job_id and employee_id<>j.assigned_employee_id and released_at is null) then raise exception 'Resolve existing custody before solo assignment'; end if;
 select id into assignment_id from public.job_equipment_assignments where job_id=p_job_id and employee_id=j.assigned_employee_id and released_at is null;
 if assignment_id is null then
 insert into public.job_equipment_assignments(job_id,employee_id,assigned_by_user_id) values(p_job_id,j.assigned_employee_id,auth.uid()) returning id into assignment_id;
 insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details) values(assignment_id,'Assigned',auth.uid(),jsonb_build_object('reason','Solo technician accepted equipment custody after inspection'));
 end if;
 insert into public.job_equipment_responsibility_tasks(job_id,responsible_employee_id,status,assigned_at) values(p_job_id,j.assigned_employee_id,'Assigned',now())
 on conflict(job_id) do update set responsible_employee_id=excluded.responsible_employee_id,status='Assigned',assigned_at=now(),revision=public.job_equipment_responsibility_tasks.revision+1,updated_at=now();
 update public.jobs set equipment_responsibility_confirmed_at=now(),equipment_responsibility_confirmed_by=auth.uid() where id=p_job_id;
 end if;
end $$;
revoke all on function public.confirm_job_equipment_responsibility(uuid) from public,anon,authenticated;
grant execute on function public.confirm_job_equipment_responsibility(uuid) to authenticated;
create function private.inventory_require_ready(p_job uuid) returns void language plpgsql security definer set search_path='' as $$
declare worker uuid:=private.inventory_job_worker(p_job); latest public.job_inventory_inspections; begin
 if auth.uid() is null or worker is null then raise exception 'Active assigned job required' using errcode='42501'; end if;
 select i.* into latest from public.job_inventory_inspections i join public.employee_work_sessions s on s.id=i.work_session_id and s.clock_out is null
 where i.job_id=p_job and i.employee_id=worker order by i.inspection_sequence desc limit 1;
 if latest.id is null or not latest.ready then raise exception 'Assigned verifier must complete equipment inspection before start'; end if;
 if latest.requirements<>private.inventory_job_requirements(p_job) then raise exception 'Kit requirements changed; repeat inspection'; end if;
 if not exists(select 1 from public.jobs where id=p_job and equipment_responsibility_confirmed_at>=latest.created_at) then raise exception 'Equipment custody confirmation required after inspection'; end if;
 if exists(select 1 from public.technician_equipment_assets a join public.technician_inventory_locations l on l.id=a.location_id join public.jobs j on j.id=p_job
 where (l.employee_id=worker or l.crew_id=j.assigned_crew_id) and a.condition in ('needs_maintenance','out_of_service','missing')) then raise exception 'Resolve unsafe or missing assigned equipment before start'; end if;
end $$;
revoke all on function private.inventory_require_ready(uuid) from public,anon,authenticated;
alter function public.start_operational_job(uuid) rename to start_operational_job_before_inventory;
alter function public.start_operational_job_with_presence(uuid,jsonb) rename to start_operational_job_with_presence_before_inventory;
revoke all on function public.start_operational_job_before_inventory(uuid),public.start_operational_job_with_presence_before_inventory(uuid,jsonb) from public,anon,authenticated;
create function public.start_operational_job(p_job_id uuid) returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$ begin
 perform id from public.jobs where id=p_job_id for update;
 perform private.inventory_require_ready(p_job_id);
 if exists(select 1 from public.jobs where id=p_job_id and assigned_crew_id is null and assigned_employee_id=public.current_employee_id()) then
 perform private.require_job_start_gps(p_job_id);
 return public.start_operational_job_before_equipment(p_job_id);
 end if;
 return public.start_operational_job_before_inventory(p_job_id);
end $$;
create function public.start_operational_job_with_presence(p_job_id uuid,p_presence jsonb) returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$ begin
 perform id from public.jobs where id=p_job_id for update;
 perform private.inventory_require_ready(p_job_id);
 return public.start_operational_job_with_presence_before_inventory(p_job_id,p_presence);
end $$;
revoke all on function public.start_operational_job(uuid),public.start_operational_job_with_presence(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.start_operational_job(uuid),public.start_operational_job_with_presence(uuid,jsonb) to authenticated;
-- The GPS gate retains shared-building geofence resolution and its existing radius/time checks.
create or replace function private.require_job_start_gps(p_job_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_lead uuid; v_property uuid; v_check public.jobsite_arrival_checks;
begin
 select case when j.assigned_crew_id is null then j.assigned_employee_id else t.crew_lead_employee_id end,j.property_id into v_lead,v_property
 from public.jobs j left join public.job_equipment_responsibility_tasks t on t.job_id=j.id
 where j.id=p_job_id and j.archived_at is null;
 if v_lead is null or v_property is null then raise exception 'Assigned verifier and linked property are required before job start'; end if;
 if not exists(select 1 from private.resolve_jobsite_geofence(v_property)) then raise exception 'Property GPS must be registered before starting this job'; end if;
 select * into v_check from public.jobsite_arrival_checks c where c.job_id=p_job_id and c.employee_id=v_lead order by c.checked_at desc,c.id desc limit 1;
 if v_check.id is null or v_check.result<>'Within Radius' or v_check.checked_at<now()-interval '12 hours' then raise exception 'Assigned verifier must verify arrival on-site using GPS before starting'; end if;
end $$;
revoke all on function private.require_job_start_gps(uuid) from public,anon,authenticated;
create or replace function private.guard_lead_equipment_assignment() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.released_at is null and not exists(select 1 from public.jobs j left join public.crews c on c.id=j.assigned_crew_id
 where j.id=new.job_id and j.archived_at is null and j.status not in ('Completed','Cancelled','Archived') and
 ((j.assigned_crew_id is not null and c.crew_lead_id=new.employee_id and c.status='Active' and c.archived_at is null)
 or (j.assigned_crew_id is null and j.assigned_employee_id=new.employee_id))) then raise exception 'Only the assigned Crew Lead or individually assigned technician may hold equipment custody'; end if;
 return new;
end $$;
create or replace function private.guard_lead_equipment_job_start() returns trigger language plpgsql security definer set search_path='' as $$
declare worker uuid; begin
 if new.status='In Progress' and old.status is distinct from new.status then
 perform private.inventory_require_ready(new.id);
 worker:=private.inventory_job_worker(new.id);
 if not exists(select 1 from public.job_equipment_responsibility_tasks t join public.user_profiles u on u.id=new.equipment_responsibility_confirmed_by
 where t.job_id=new.id and t.responsible_employee_id=worker and u.employee_id=worker and new.equipment_responsibility_confirmed_at is not null
 and ((new.assigned_crew_id is null and new.assigned_employee_id=worker and t.crew_id is null)
 or exists(select 1 from public.crews c where c.id=new.assigned_crew_id and c.status='Active' and c.archived_at is null
 and c.crew_lead_id=worker and t.crew_id=c.id and t.crew_lead_employee_id=worker))
 and exists(select 1 from public.job_equipment_assignments a where a.job_id=new.id and a.employee_id=worker and a.released_at is null)
 and not exists(select 1 from public.job_equipment_assignments a where a.job_id=new.id and a.employee_id<>worker and a.released_at is null)
 and not exists(select 1 from public.job_equipment_handoffs h where h.job_id=new.id and h.acknowledged_at is null)) then raise exception 'Assigned verifier must confirm equipment custody before starting'; end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_lead_equipment_assignment(),private.guard_lead_equipment_job_start() from public,anon,authenticated;
notify pgrst,'reload schema';

