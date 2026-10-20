begin;
alter table public.jobs add column if not exists equipment_responsibility_confirmed_at timestamptz;
alter table public.jobs add column if not exists equipment_responsibility_confirmed_by uuid;
create unique index if not exists equipment_clearance_one_end_job on public.job_equipment_clearances(assignment_id,checkpoint) where work_session_id is null;
create table public.job_equipment_handoffs (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.jobs(id),
 from_employee_id uuid references public.employees(id),
 to_employee_id uuid not null references public.employees(id),
 actor_user_id uuid not null,
 reason text not null check(length(btrim(reason))>0),
 acknowledged_at timestamptz,
 acknowledged_by uuid,
 created_at timestamptz not null default now()
);
alter table public.job_equipment_handoffs enable row level security;
revoke all on public.job_equipment_handoffs from public,anon,authenticated;
create table public.job_equipment_notifications (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.jobs(id),
 employee_id uuid not null references public.employees(id),
 event_type text not null,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 read_at timestamptz
);
alter table public.job_equipment_notifications enable row level security;
revoke all on public.job_equipment_notifications from public,anon,authenticated;
create or replace function public.equipment_assignment_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.jobs set equipment_responsibility_confirmed_at=null,equipment_responsibility_confirmed_by=null where id=new.job_id;
 insert into public.job_equipment_notifications(job_id,employee_id,event_type,details)
 values(new.job_id,new.employee_id,'Equipment Assigned',jsonb_build_object('assignment_id',new.id));
 return new;
end; $$;
create trigger equipment_assignment_changed after insert on public.job_equipment_assignments
for each row execute function public.equipment_assignment_changed();
create or replace function public.confirm_job_equipment_responsibility(p_job_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs;
begin
 select * into j from public.jobs where id=p_job_id for update;
 if not found or j.status in ('Completed','Cancelled','Archived') then raise exception 'Active job required.'; end if;
 if not (public.has_role('Master Admin') or (public.has_role('Crew Lead') and exists(select 1 from public.crews c where c.id=j.assigned_crew_id and c.crew_lead_id=public.current_employee_id()))) then raise exception 'Assigned Crew Lead or Master Admin required.'; end if;
 update public.jobs set equipment_responsibility_confirmed_at=now(),equipment_responsibility_confirmed_by=auth.uid() where id=p_job_id;
end; $$;
revoke all on function public.confirm_job_equipment_responsibility(uuid) from public,anon,authenticated;
grant execute on function public.confirm_job_equipment_responsibility(uuid) to authenticated;
alter function public.start_operational_job(uuid) rename to start_operational_job_before_equipment;
alter function public.start_operational_job_with_presence(uuid,jsonb) rename to start_operational_job_with_presence_before_equipment;
create function public.start_operational_job(p_job_id uuid)
returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.jobs where id=p_job_id and equipment_responsibility_confirmed_at is not null) then raise exception 'Crew Lead must confirm equipment custodians (including none) before starting.'; end if;
 return public.start_operational_job_before_equipment(p_job_id);
end; $$;
create function public.start_operational_job_with_presence(p_job_id uuid,p_presence jsonb)
returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.jobs where id=p_job_id and equipment_responsibility_confirmed_at is not null) then raise exception 'Crew Lead must confirm equipment custodians (including none) before starting.'; end if;
 return public.start_operational_job_with_presence_before_equipment(p_job_id,p_presence);
end; $$;
revoke all on function public.start_operational_job(uuid),public.start_operational_job_with_presence(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.start_operational_job(uuid),public.start_operational_job_with_presence(uuid,jsonb) to authenticated;
create or replace function public.get_job_equipment_confirmation(p_job_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 if not exists(select 1 from public.jobs j where j.id=p_job_id and (public.has_any_role(array['Master Admin','Administrator','Manager']) or j.assigned_employee_id=public.current_employee_id() or public.is_assigned_to_crew(j.assigned_crew_id))) then raise exception 'Access denied.'; end if;
 return exists(select 1 from public.jobs where id=p_job_id and equipment_responsibility_confirmed_at is not null);
end; $$;
revoke all on function public.get_job_equipment_confirmation(uuid) from public,anon,authenticated;
grant execute on function public.get_job_equipment_confirmation(uuid) to authenticated;
create or replace function public.get_open_job_equipment_exceptions(p_job_id uuid)
returns table(exception_id uuid,employee_id uuid,item_name text,description text,reported_at timestamptz)
language sql security definer set search_path='' as $$
select e.id,c.employee_id,i.item_name,e.description,e.reported_at
from public.job_equipment_exceptions e
join public.job_equipment_clearance_items i on i.id=e.clearance_item_id
join public.job_equipment_clearances c on c.id=i.clearance_id
where c.job_id=p_job_id and e.resolved_at is null and auth.uid() is not null
and public.has_any_role(array['Master Admin','Administrator','Manager'])
order by e.reported_at;
$$;
revoke all on function public.get_open_job_equipment_exceptions(uuid) from public,anon,authenticated;
grant execute on function public.get_open_job_equipment_exceptions(uuid) to authenticated;
insert into public.equipment_checklist_catalog(service_type,item_name,item_kind,display_order) values
('General','Cleaning caddy','Equipment',10),('General','Vacuum and attachments','Equipment',20),('General','Mop, bucket and handles','Equipment',30),('General','Extension cords and chargers','Equipment',40),('General','Microfiber towels','Supply',50),('General','Cleaning chemicals and containers','Supply',60),('General','PPE and safety equipment','Equipment',70),
('Pressure Washing','Pressure washer and hoses','Equipment',10),('Pressure Washing','Spray tips and wand','Equipment',20),('Pressure Washing','Surface cleaner','Equipment',30),('Pressure Washing','Water connections and fittings','Equipment',40),('Pressure Washing','Chemical injector and detergent','Supply',50),
('Post-Construction','HEPA vacuum and filters','Equipment',10),('Post-Construction','Scrapers and blades','Equipment',20),('Post-Construction','Dust extraction tools','Equipment',30),('Post-Construction','Protective floor coverings','Supply',40),
('Commercial','Floor scrubber and pads','Equipment',10),('Commercial','Janitorial cart','Equipment',20),('Commercial','Waste liners','Supply',30),
('Move-In/Out','Appliance cleaning tools','Equipment',10),('Move-In/Out','Detail brushes','Equipment',20)
on conflict(service_type,item_name) do nothing;
create or replace function public.get_job_equipment_catalog(p_job_id uuid)
returns table(item_name text,item_kind text) language sql security definer set search_path='' as $$
select c.item_name,c.item_kind from public.equipment_checklist_catalog c join public.jobs_operational_safe j on j.id=p_job_id
where c.active and auth.uid() is not null
and (c.service_type='General' or (coalesce(j.service_name,'') ilike '%pressure%' and c.service_type='Pressure Washing')
or (coalesce(j.service_name,'') ilike '%construction%' and c.service_type='Post-Construction')
or (coalesce(j.service_name,'') ilike '%commercial%' and c.service_type='Commercial')
or (coalesce(j.service_name,'') ilike '%move%' and c.service_type='Move-In/Out'))
and (public.has_any_role(array['Master Admin','Administrator','Manager']) or j.assigned_employee_id=public.current_employee_id() or public.is_assigned_to_crew(j.assigned_crew_id))
order by c.service_type,c.display_order;
$$;
revoke all on function public.get_job_equipment_catalog(uuid) from public,anon,authenticated;
grant execute on function public.get_job_equipment_catalog(uuid) to authenticated;
commit;