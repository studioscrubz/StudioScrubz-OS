-- Porter Visits V1. Apply separately after Property Service Plans V1.
begin;
create table public.property_service_visits (
 id uuid primary key default gen_random_uuid(),
 service_plan_id uuid not null references public.property_service_plans(id),
 client_id uuid not null references public.clients(id),
 property_id uuid not null references public.properties(id),
 assigned_crew_id uuid references public.crews(id),
 -- Safe labels preserve context without granting field users plan/client table access.
 plan_name text not null,
 property_label text not null,
 scheduled_date date not null,
 status text not null default 'Scheduled' check(status in ('Scheduled','In Progress','Completed','Cancelled')),
 visit_notes text,
 started_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.property_service_visit_areas (
 id uuid primary key default gen_random_uuid(),
 visit_id uuid not null references public.property_service_visits(id) on delete cascade,
 source_plan_area_id uuid references public.property_service_plan_areas(id) on delete set null,
 name text not null, description text, sort_order integer not null,
 is_required boolean not null, requires_photo boolean not null,
 status text not null default 'Pending' check(status in ('Pending','Completed','Unable to Complete')),
 notes text, completed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.property_service_visits(service_plan_id);
create index on public.property_service_visits(client_id);
create index on public.property_service_visits(property_id);
create index on public.property_service_visits(assigned_crew_id,scheduled_date);
create index on public.property_service_visits(scheduled_date,status);
create index on public.property_service_visit_areas(visit_id,sort_order);
create index on public.property_service_visit_areas(source_plan_area_id);
alter table public.property_service_visits enable row level security;
alter table public.property_service_visit_areas enable row level security;
revoke all on public.property_service_visits,public.property_service_visit_areas from public,anon,authenticated;
grant select on public.property_service_visits,public.property_service_visit_areas to authenticated;

create function public.can_access_porter_visit(p_crew_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and (
 public.has_any_role(array['Master Admin','Administrator','Manager']) or
 (public.has_any_role(array['Crew Lead','Scrub Technician']) and public.current_employee_id() is not null
 and public.is_assigned_to_crew(p_crew_id)))
$$;
revoke all on function public.can_access_porter_visit(uuid) from public,anon,authenticated;
grant execute on function public.can_access_porter_visit(uuid) to authenticated;
create policy "Authorized Porter Visit read" on public.property_service_visits for select to authenticated
 using (public.can_access_porter_visit(assigned_crew_id));
create policy "Authorized Porter Visit area read" on public.property_service_visit_areas for select to authenticated
 using (exists(select 1 from public.property_service_visits v where v.id=visit_id));

-- The read RPC exposes only visit snapshots, operational notes, and the crew label.
create function public.get_porter_visits(p_id uuid default null) returns setof jsonb
language sql stable security definer set search_path = '' as $$
 select to_jsonb(v) || jsonb_build_object('crew_name',c.crew_name,'areas',coalesce(
 (select jsonb_agg(to_jsonb(a) order by a.sort_order,a.id) from public.property_service_visit_areas a where a.visit_id=v.id),'[]'::jsonb))
 from public.property_service_visits v left join public.crews c on c.id=v.assigned_crew_id
 where (p_id is null or v.id=p_id) and public.can_access_porter_visit(v.assigned_crew_id)
 order by v.scheduled_date desc,v.created_at desc
$$;
revoke all on function public.get_porter_visits(uuid) from public,anon,authenticated;
grant execute on function public.get_porter_visits(uuid) to authenticated;

create function public.create_porter_visit(p_plan_id uuid,p_scheduled_date date,p_assigned_crew_id uuid default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_plan public.property_service_plans; v_id uuid; v_label text; v_crew uuid;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
  raise exception 'Only management may create Porter Visits.' using errcode='42501'; end if;
 -- Coordinate with the plan save RPC so header and active area snapshot are consistent.
 select * into v_plan from public.property_service_plans where id=p_plan_id for share;
 if not found or v_plan.status<>'Active' or v_plan.archived_at is not null then raise exception 'Select an active, non-archived Property Service Plan.'; end if;
 if p_scheduled_date is null then raise exception 'Scheduled date is required.'; end if;
 select concat_ws(' - ',nullif(property_name,''),address) into v_label from public.properties
 where id=v_plan.property_id and client_id=v_plan.client_id;
 if not found then raise exception 'Plan property/client relationship is no longer valid.'; end if;
 v_crew := coalesce(p_assigned_crew_id,v_plan.assigned_crew_id);
 if v_crew is not null and not exists(select 1 from public.crews where id=v_crew and status='Active' and archived_at is null) then
  raise exception 'Select an active crew.'; end if;
 insert into public.property_service_visits(service_plan_id,client_id,property_id,assigned_crew_id,plan_name,property_label,scheduled_date,visit_notes)
 values(v_plan.id,v_plan.client_id,v_plan.property_id,v_crew,v_plan.name,v_label,p_scheduled_date,nullif(btrim(p_notes),'')) returning id into v_id;
 insert into public.property_service_visit_areas(visit_id,source_plan_area_id,name,description,sort_order,is_required,requires_photo)
 select v_id,id,name,description,sort_order,is_required,requires_photo
 from public.property_service_plan_areas where service_plan_id=v_plan.id and active;
 return v_id;
end;
$$;
revoke all on function public.create_porter_visit(uuid,date,uuid,text) from public,anon,authenticated;
grant execute on function public.create_porter_visit(uuid,date,uuid,text) to authenticated;

-- Every mutation locks the parent and advances its version, including area edits.
create function public.mutate_porter_visit(p_id uuid,p_expected_updated_at timestamptz,p_action text,p_data jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.property_service_visits; v_now timestamptz; v_manager boolean; v_status text; v_area uuid; v_crew uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;
 select * into v from public.property_service_visits where id=p_id for update;
 if not found or not public.can_access_porter_visit(v.assigned_crew_id) then raise exception 'Porter Visit not found or access denied.' using errcode='42501'; end if;
 if v.updated_at is distinct from p_expected_updated_at then raise exception 'Visit changed. Refresh and reopen it before saving.' using errcode='40001'; end if;
 if v.status in ('Completed','Cancelled') then raise exception 'Completed and Cancelled visits are read-only.'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid visit update.'; end if;
 v_manager:=public.has_any_role(array['Master Admin','Administrator','Manager']);
 v_now:=greatest(clock_timestamp(),v.updated_at+interval '1 microsecond');
 case p_action
 when 'edit' then
  if not v_manager or v.status<>'Scheduled' then raise exception 'Only management may edit a Scheduled visit.' using errcode='42501'; end if;
  if nullif(p_data->>'scheduled_date','') is null then raise exception 'Scheduled date is required.'; end if;
  v_crew:=nullif(p_data->>'assigned_crew_id','')::uuid;
  if v_crew is not null and not exists(select 1 from public.crews where id=v_crew and status='Active' and archived_at is null) then raise exception 'Select an active crew.'; end if;
  update public.property_service_visits set scheduled_date=(p_data->>'scheduled_date')::date,assigned_crew_id=v_crew,
   visit_notes=nullif(btrim(p_data->>'visit_notes'),'') where id=p_id;
 when 'notes' then
  update public.property_service_visits set visit_notes=nullif(btrim(p_data->>'visit_notes'),'') where id=p_id;
 when 'start' then
  if v.status<>'Scheduled' then raise exception 'Only Scheduled visits can start.'; end if;
  update public.property_service_visits set status='In Progress',started_at=coalesce(started_at,v_now) where id=p_id;
 when 'cancel' then
  if not v_manager then raise exception 'Only management may cancel visits.' using errcode='42501'; end if;
  update public.property_service_visits set status='Cancelled',cancelled_at=coalesce(cancelled_at,v_now) where id=p_id;
 when 'complete' then
  if v.status<>'In Progress' then raise exception 'Start the visit before completing it.'; end if;
  if exists(select 1 from public.property_service_visit_areas where visit_id=p_id and is_required and status='Pending') then
   raise exception 'Resolve all required Pending service areas before completing.'; end if;
  update public.property_service_visits set status='Completed',completed_at=coalesce(completed_at,v_now) where id=p_id;
 when 'area' then
  if v.status<>'In Progress' then raise exception 'Start the visit before updating service areas.'; end if;
  v_area:=(p_data->>'area_id')::uuid; v_status:=p_data->>'status';
  if v_status is null or v_status not in ('Pending','Completed','Unable to Complete') then raise exception 'Invalid service area status.'; end if;
  update public.property_service_visit_areas set status=v_status,notes=nullif(btrim(p_data->>'notes'),''),
   completed_at=case when v_status='Completed' then coalesce(completed_at,v_now) else null end,updated_at=v_now
   where id=v_area and visit_id=p_id;
  if not found then raise exception 'Service area does not belong to this visit.'; end if;
 else raise exception 'Unsupported Porter Visit action.';
 end case;
 update public.property_service_visits set updated_at=v_now where id=p_id;
 return p_id;
end;
$$;
revoke all on function public.mutate_porter_visit(uuid,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_porter_visit(uuid,timestamptz,text,jsonb) to authenticated;
commit;
