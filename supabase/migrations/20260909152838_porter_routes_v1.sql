-- Porter Routes V1: organizers only; visits remain authoritative. Apply separately.
begin;
create table public.property_service_routes (
 id uuid primary key default gen_random_uuid(),
 route_date date not null,
 assigned_crew_id uuid not null references public.crews(id),
 route_name text, notes text,
 status text not null default 'Planned' check (status in ('Planned','In Progress','Completed','Cancelled')),
 started_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
 created_by uuid references public.user_profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.property_service_route_stops (
 id uuid primary key default gen_random_uuid(),
 route_id uuid not null references public.property_service_routes(id),
 visit_id uuid not null references public.property_service_visits(id),
 stop_order integer not null check(stop_order >= 1), stop_notes text,
 -- Reservation marker only: cancellation releases uniqueness while retaining history.
 released_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(route_id,visit_id),
 unique(route_id,stop_order) deferrable initially deferred
);
create unique index porter_one_reserved_route_per_visit on public.property_service_route_stops(visit_id) where released_at is null;
create index on public.property_service_routes(assigned_crew_id,route_date);
create index on public.property_service_routes(route_date,status);
create index on public.property_service_routes(created_by);
create index on public.property_service_route_stops(visit_id);
alter table public.property_service_routes enable row level security;
alter table public.property_service_route_stops enable row level security;
revoke all on public.property_service_routes,public.property_service_route_stops from public,anon,authenticated;
grant select on public.property_service_routes,public.property_service_route_stops to authenticated;
create policy "Assigned Porter route read" on public.property_service_routes for select to authenticated
 using(public.can_access_porter_visit(assigned_crew_id));
create policy "Assigned Porter route stop read" on public.property_service_route_stops for select to authenticated
 using(exists(select 1 from public.property_service_routes r where r.id=route_id));

-- No copied visit details. Re-check the visit's own authorization even for old cancelled routes
-- whose visits may since have been reassigned to a different crew.
create function public.get_porter_routes(p_id uuid default null) returns setof jsonb
language sql stable security definer set search_path = '' as $$
 select to_jsonb(r) || jsonb_build_object('crew_name',c.crew_name,
 'business_today',(select (now() at time zone b.timezone)::date from public.business_settings b
  where exists(select 1 from pg_timezone_names tz where tz.name=b.timezone) limit 1),
 'stops',coalesce((
  select jsonb_agg(to_jsonb(s) || jsonb_build_object('visit',case when v.id is null then null else
   jsonb_build_object('id',v.id,'property_label',v.property_label,'plan_name',v.plan_name,'status',v.status,
    'scheduled_date',v.scheduled_date,'assigned_crew_id',v.assigned_crew_id,'visit_notes',v.visit_notes) end) order by s.stop_order,s.id)
  from public.property_service_route_stops s left join public.property_service_visits v on v.id=s.visit_id
   and public.can_access_porter_visit(v.assigned_crew_id) where s.route_id=r.id),'[]'::jsonb))
 from public.property_service_routes r join public.crews c on c.id=r.assigned_crew_id
 where auth.uid() is not null and (p_id is null or r.id=p_id) and public.can_access_porter_visit(r.assigned_crew_id)
 order by r.route_date,r.created_at,r.id
$$;
revoke all on function public.get_porter_routes(uuid) from public,anon,authenticated;
grant execute on function public.get_porter_routes(uuid) to authenticated;

-- Shared internal writer: caller must already hold the route lock. Never granted to clients.
create function public.replace_porter_route_stops(p_route_id uuid,p_stops jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.property_service_routes; item jsonb; visit_ids uuid[]; v_visit_id uuid; v public.property_service_visits; seq integer:=0;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Only management may edit routes.' using errcode='42501'; end if;
 select * into r from public.property_service_routes where id=p_route_id for update;
 if not found or r.status<>'Planned' then raise exception 'Route structure can only be edited while Planned.'; end if;
 if p_stops is null or jsonb_typeof(p_stops)<>'array' then raise exception 'Provide an ordered stop list.'; end if;
 for item in select value from jsonb_array_elements(p_stops) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid route stop.'; end if;
  if exists(select 1 from jsonb_object_keys(item) k where k not in ('visit_id','stop_notes')) then raise exception 'Invalid or cross-route stop fields.'; end if;
 end loop;
 select coalesce(array_agg((x->>'visit_id')::uuid),'{}'::uuid[]) into visit_ids from jsonb_array_elements(p_stops) x;
 if array_position(visit_ids,null) is not null or cardinality(visit_ids)<>(select count(distinct x) from unnest(visit_ids) x) then raise exception 'Duplicate or invalid visit in stop list.'; end if;
 -- Lock old and new visits in deterministic order: competing claims and visit edits serialize.
 perform v0.id from public.property_service_visits v0 where v0.id=any(visit_ids)
  or v0.id in(select s.visit_id from public.property_service_route_stops s where s.route_id=p_route_id) order by v0.id for update;
 foreach v_visit_id in array visit_ids loop
  select * into v from public.property_service_visits pv where pv.id=v_visit_id;
  if not found then raise exception 'Porter Visit not found.'; end if;
  if v.scheduled_date<>r.route_date then raise exception 'Visit date must match the route date.'; end if;
  if v.assigned_crew_id is distinct from r.assigned_crew_id then raise exception 'Visit crew must match the route crew.'; end if;
  if v.status<>'Scheduled' and not exists(select 1 from public.property_service_route_stops s where s.route_id=p_route_id and s.visit_id=v.id) then raise exception 'Only Scheduled visits can be added.'; end if;
  if exists(select 1 from public.property_service_route_stops s where s.visit_id=v.id and s.route_id<>p_route_id and s.released_at is null) then raise exception 'Visit already belongs to another active route.'; end if;
 end loop;
 delete from public.property_service_route_stops s where s.route_id=p_route_id and not(s.visit_id=any(visit_ids));
 for item in select value from jsonb_array_elements(p_stops) loop
  seq:=seq+1;
  insert into public.property_service_route_stops(route_id,visit_id,stop_order,stop_notes)
  values(p_route_id,(item->>'visit_id')::uuid,seq,nullif(btrim(item->>'stop_notes'),''))
  on conflict(route_id,visit_id) do update set stop_order=excluded.stop_order,stop_notes=excluded.stop_notes,updated_at=clock_timestamp();
 end loop;
end $$;
revoke all on function public.replace_porter_route_stops(uuid,jsonb) from public,anon,authenticated;

create function public.create_porter_route(p_route_date date,p_crew_id uuid,p_name text default null,p_notes text default null,p_stops jsonb default '[]') returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Only management may create routes.' using errcode='42501'; end if;
 if p_route_date is null then raise exception 'Route date is required.'; end if;
 perform 1 from public.crews where id=p_crew_id and status='Active' and archived_at is null for share;
 if not found then raise exception 'Select an active crew.'; end if;
 insert into public.property_service_routes(route_date,assigned_crew_id,route_name,notes,created_by)
 values(p_route_date,p_crew_id,nullif(btrim(p_name),''),nullif(btrim(p_notes),''),auth.uid()) returning id into result;
 perform public.replace_porter_route_stops(result,p_stops);
 return result;
end $$;
revoke all on function public.create_porter_route(date,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_porter_route(date,uuid,text,text,jsonb) to authenticated;

create function public.mutate_porter_route(p_id uuid,p_expected_updated_at timestamptz,p_action text,p_data jsonb default '{}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.property_service_routes; stamp timestamptz;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Only management may change routes.' using errcode='42501'; end if;
 select * into r from public.property_service_routes where id=p_id for update;
 if not found then raise exception 'Porter Route not found or access denied.'; end if;
 if r.updated_at is distinct from p_expected_updated_at then raise exception 'Route changed. Refresh and reopen before saving.' using errcode='40001'; end if;
 if r.status in ('Completed','Cancelled') then raise exception 'Completed and Cancelled routes are read-only.'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid route update.'; end if;
 stamp:=greatest(clock_timestamp(),r.updated_at+interval '1 microsecond');
 case p_action
 when 'edit' then
  if r.status<>'Planned' then raise exception 'Route structure can only be edited while Planned.'; end if;
  -- Date/crew remain fixed in V1; explicitly reject attempts to change them.
  if p_data ? 'route_date' or p_data ? 'assigned_crew_id' then raise exception 'Route date and crew cannot be changed. Cancel and create a new route.'; end if;
  perform public.replace_porter_route_stops(p_id,p_data->'stops');
  update public.property_service_routes set route_name=nullif(btrim(p_data->>'route_name'),''),notes=nullif(btrim(p_data->>'notes'),'') where id=p_id;
 when 'start' then
  if r.status<>'Planned' then raise exception 'Only Planned routes can start.'; end if;
  if not exists(select 1 from public.property_service_route_stops where route_id=p_id) then raise exception 'Add at least one stop before starting.'; end if;
  update public.property_service_routes set status='In Progress',started_at=coalesce(started_at,stamp) where id=p_id;
 when 'complete' then
  if r.status<>'In Progress' then raise exception 'Start the route before completing.'; end if;
  perform v.id from public.property_service_visits v join public.property_service_route_stops s on s.visit_id=v.id where s.route_id=p_id order by v.id for update of v;
  if exists(select 1 from public.property_service_route_stops s join public.property_service_visits v on v.id=s.visit_id where s.route_id=p_id and v.status not in ('Completed','Cancelled')) then raise exception 'Complete or cancel every Porter Visit before completing the route.'; end if;
  update public.property_service_routes set status='Completed',completed_at=coalesce(completed_at,stamp) where id=p_id;
 when 'cancel' then
  perform v.id from public.property_service_visits v join public.property_service_route_stops s on s.visit_id=v.id where s.route_id=p_id order by v.id for update of v;
  update public.property_service_route_stops set released_at=stamp,updated_at=stamp where route_id=p_id;
  update public.property_service_routes set status='Cancelled',cancelled_at=stamp where id=p_id;
 else raise exception 'Invalid route action.';
 end case;
 update public.property_service_routes set updated_at=stamp where id=p_id;
 return p_id;
end $$;
revoke all on function public.mutate_porter_route(uuid,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_porter_route(uuid,timestamptz,text,jsonb) to authenticated;

-- Existing visit RPC already locks the visit. Route claims lock that same row, so neither
-- route creation nor a later visit edit can silently produce a cross-date/cross-crew route.
create function public.guard_porter_routed_visit_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;
 if (new.scheduled_date is distinct from old.scheduled_date or new.assigned_crew_id is distinct from old.assigned_crew_id)
  and exists(select 1 from public.property_service_route_stops s where s.visit_id=old.id and s.released_at is null) then
  raise exception 'Remove this visit from its Planned route or cancel the route before changing its date or crew.';
 end if;
 return new;
end $$;
revoke all on function public.guard_porter_routed_visit_assignment() from public,anon,authenticated;
create trigger porter_routed_visit_assignment before update of scheduled_date,assigned_crew_id on public.property_service_visits
 for each row execute function public.guard_porter_routed_visit_assignment();

do $$ declare t text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['property_service_routes','property_service_route_stops'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
    execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
  end loop;
 end if;
end $$;
commit;
