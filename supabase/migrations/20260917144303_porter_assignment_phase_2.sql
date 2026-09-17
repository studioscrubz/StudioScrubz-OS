-- Porter assignment phase 2: structured individual worker and manager assignments.
-- assigned_crew_id remains as a synchronized compatibility alias for routes and older clients.
begin;

create table public.employee_service_roles (
  employee_id uuid not null references public.employees(id) on delete cascade,
  service_role text not null check (service_role in ('Porter Tech','Porter Manager')),
  created_at timestamptz not null default now(),
  primary key (employee_id, service_role)
);
alter table public.employee_service_roles enable row level security;
revoke all on public.employee_service_roles from public, anon, authenticated;

-- Existing crew participation is structured evidence that an employee performs Porter work.
insert into public.employee_service_roles(employee_id,service_role)
select employee_id,'Porter Tech' from public.crew_members
union
select crew_lead_id,'Porter Tech' from public.crews where crew_lead_id is not null
on conflict do nothing;

alter table public.property_service_visits
  add column assigned_manager_employee_id uuid references public.employees(id),
  add column assigned_worker_employee_id uuid references public.employees(id),
  add column assigned_worker_crew_id uuid references public.crews(id);

update public.property_service_visits
set assigned_worker_crew_id=assigned_crew_id
where assigned_crew_id is not null;

alter table public.property_service_visits
  add constraint porter_visit_one_worker_assignment
  check (num_nonnulls(assigned_worker_employee_id,assigned_worker_crew_id) <= 1);

create index porter_visit_worker_employee_idx on public.property_service_visits(assigned_worker_employee_id,scheduled_date)
  where assigned_worker_employee_id is not null;
create index porter_visit_worker_crew_idx on public.property_service_visits(assigned_worker_crew_id,scheduled_date)
  where assigned_worker_crew_id is not null;
create index porter_visit_manager_idx on public.property_service_visits(assigned_manager_employee_id,scheduled_date)
  where assigned_manager_employee_id is not null;

create function public.sync_porter_visit_legacy_crew_assignment()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.assigned_worker_crew_id:=coalesce(new.assigned_worker_crew_id,new.assigned_crew_id);
  elsif new.assigned_worker_crew_id is distinct from old.assigned_worker_crew_id then
    new.assigned_crew_id:=new.assigned_worker_crew_id;
  elsif new.assigned_crew_id is distinct from old.assigned_crew_id then
    new.assigned_worker_crew_id:=new.assigned_crew_id;
  end if;
  if new.assigned_worker_employee_id is not null then
    if new.assigned_worker_crew_id is not null then raise exception 'Choose either an individual Porter Tech or a Porter Crew, not both.'; end if;
    new.assigned_crew_id:=null;
  else
    new.assigned_crew_id:=new.assigned_worker_crew_id;
  end if;
  return new;
end $$;
revoke all on function public.sync_porter_visit_legacy_crew_assignment() from public,anon,authenticated;
create trigger porter_visit_sync_legacy_crew before insert or update of assigned_crew_id,assigned_worker_crew_id,assigned_worker_employee_id
on public.property_service_visits for each row execute function public.sync_porter_visit_legacy_crew_assignment();

create function public.get_porter_assignment_options()
returns table(employee_id uuid,display_name text,service_role text)
language sql stable security definer set search_path='' as $$
  select e.id,coalesce(nullif(btrim(e.preferred_name),''),concat_ws(' ',e.first_name,e.last_name)),sr.service_role
  from public.employee_service_roles sr join public.employees e on e.id=sr.employee_id
  where auth.uid() is not null
    and public.has_any_role(array['Master Admin','Administrator','Manager'])
    and e.employment_status='Active' and e.archived_at is null
  order by sr.service_role,2,e.id
$$;
revoke all on function public.get_porter_assignment_options() from public,anon,authenticated;
grant execute on function public.get_porter_assignment_options() to authenticated;

create function public.can_access_porter_visit(p_worker_employee_id uuid,p_worker_crew_id uuid,p_manager_employee_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
  public.has_any_role(array['Master Admin','Administrator','Manager'])
  or public.current_employee_id()=p_worker_employee_id
  or public.current_employee_id()=p_manager_employee_id
  or public.is_assigned_to_crew(p_worker_crew_id)
 )
$$;
revoke all on function public.can_access_porter_visit(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.can_access_porter_visit(uuid,uuid,uuid) to authenticated;

-- Preserve the existing evidence/issue RPC bodies while upgrading their assignment check.
-- These functions already load the complete visit row as v before authorizing it.
do $$
declare signature regprocedure; definition text; upgraded text;
begin
 foreach signature in array array[
  'public.can_access_porter_photo_path(text,boolean)'::regprocedure,
  'public.can_cleanup_porter_photo(text)'::regprocedure,
  'public.add_porter_visit_photo(uuid,uuid,uuid,text,text,text)'::regprocedure,
  'public.save_porter_visit_issue(uuid,uuid,timestamptz,text,jsonb)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(signature);
  upgraded:=replace(definition,'public.can_access_porter_visit(v.assigned_crew_id)',
   'public.can_access_porter_visit(v.assigned_worker_employee_id,v.assigned_worker_crew_id,v.assigned_manager_employee_id)');
  if upgraded=definition then raise exception 'Expected Porter authorization call was not found in %',signature; end if;
  execute upgraded;
 end loop;
end $$;

drop policy "Assigned Porter visit read" on public.property_service_visits;
create policy "Assigned Porter visit read" on public.property_service_visits for select to authenticated
 using(public.can_access_porter_visit(assigned_worker_employee_id,assigned_worker_crew_id,assigned_manager_employee_id));

create or replace function public.resolve_porter_notification_recipients(
 p_worker_employee_id uuid default null,p_worker_crew_id uuid default null,p_manager_employee_id uuid default null
) returns table(recipient_user_id uuid,recipient_employee_id uuid,recipient_context text)
language sql stable security invoker set search_path='' as $$
 with assignment_people as (
  select p_worker_employee_id employee_id,'Worker'::text recipient_context where p_worker_employee_id is not null
  union all select c.crew_lead_id,'Worker' from public.crews c where c.id=p_worker_crew_id and c.status='Active' and c.archived_at is null and c.crew_lead_id is not null
  union all select cm.employee_id,'Worker' from public.crew_members cm join public.crews c on c.id=cm.crew_id where cm.crew_id=p_worker_crew_id and c.status='Active' and c.archived_at is null
  union all select p_manager_employee_id,'Manager' where p_manager_employee_id is not null
 ), ranked as (
  select up.id user_id,e.id employee_id,ap.recipient_context,
   row_number() over(partition by up.id order by case ap.recipient_context when 'Manager' then 1 else 2 end) rn
  from assignment_people ap join public.employees e on e.id=ap.employee_id and e.employment_status='Active' and e.archived_at is null
  join public.user_profiles up on up.employee_id=e.id and up.is_active
  where up.role in ('Master Admin','Administrator','Manager','Crew Lead','Scrub Technician')
 ) select user_id,employee_id,recipient_context from ranked where rn=1
$$;

create or replace function public.set_porter_visit_notification_revision()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.scheduled_date is distinct from old.scheduled_date or new.scheduled_start_time is distinct from old.scheduled_start_time
  or new.assigned_crew_id is distinct from old.assigned_crew_id
  or new.assigned_worker_employee_id is distinct from old.assigned_worker_employee_id
  or new.assigned_worker_crew_id is distinct from old.assigned_worker_crew_id
  or new.assigned_manager_employee_id is distinct from old.assigned_manager_employee_id then
  new.notification_revision:=old.notification_revision+1;
 end if;
 return new;
end $$;
drop trigger porter_visit_notification_revision on public.property_service_visits;
create trigger porter_visit_notification_revision before update of scheduled_date,scheduled_start_time,assigned_crew_id,assigned_worker_employee_id,assigned_worker_crew_id,assigned_manager_employee_id
on public.property_service_visits for each row execute function public.set_porter_visit_notification_revision();

create or replace function public.enqueue_porter_visit_change_notifications()
returns trigger language plpgsql security invoker set search_path='' as $$
declare recipient record; schedule_changed boolean; assignment_changed boolean; label text;
begin
 if tg_op='INSERT' then
  for recipient in select * from public.resolve_porter_notification_recipients(new.assigned_worker_employee_id,new.assigned_worker_crew_id,new.assigned_manager_employee_id) loop
   label:=case when recipient.recipient_context='Manager' then 'Porter Visit Management Assigned' else 'Porter Visit Assigned' end;
   perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,recipient.recipient_context,
    'visit_assignment',new.id,null,new.notification_revision,label,new.property_label||' is scheduled for '||to_char(new.scheduled_date,'Mon FMDD, YYYY')||case when new.scheduled_start_time is null then '.' else ' at '||to_char(new.scheduled_start_time,'FMHH12:MI AM')||'.' end,
    'Attention','/properties/porter-visits?visit='||new.id,'Open Visit',new.scheduled_date,clock_timestamp(),clock_timestamp()+interval '30 days',
    'porter:visit:'||new.id||':assignment:'||new.notification_revision||':'||recipient.recipient_user_id);
  end loop;
  return new;
 end if;
 if new.status in ('In Progress','Completed','Cancelled') then
  update public.porter_notification_events set cancelled_at=coalesce(cancelled_at,clock_timestamp()) where visit_id=new.id and event_type in ('visit_reminder_24h','visit_reminder_1h','visit_missed_start') and cancelled_at is null;
 end if;
 schedule_changed:=new.scheduled_date is distinct from old.scheduled_date or new.scheduled_start_time is distinct from old.scheduled_start_time;
 assignment_changed:=new.assigned_worker_employee_id is distinct from old.assigned_worker_employee_id or new.assigned_worker_crew_id is distinct from old.assigned_worker_crew_id or new.assigned_manager_employee_id is distinct from old.assigned_manager_employee_id;
 if not schedule_changed and not assignment_changed then return new; end if;
 update public.porter_notification_events set cancelled_at=coalesce(cancelled_at,clock_timestamp()) where visit_id=new.id and event_type in ('visit_reminder_24h','visit_reminder_1h','visit_missed_start') and cancelled_at is null;
 if assignment_changed then
  for recipient in select r.* from public.resolve_porter_notification_recipients(old.assigned_worker_employee_id,old.assigned_worker_crew_id,old.assigned_manager_employee_id) r
   where not exists(select 1 from public.resolve_porter_notification_recipients(new.assigned_worker_employee_id,new.assigned_worker_crew_id,new.assigned_manager_employee_id) n where n.recipient_user_id=r.recipient_user_id)
  loop
   perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,case when recipient.recipient_context='Manager' then 'Removed Manager' else 'Removed Worker' end,
    'visit_assignment_removed',new.id,null,new.notification_revision,case when recipient.recipient_context='Manager' then 'Porter Visit Management Removed' else 'Porter Visit Assignment Removed' end,
    'You are no longer assigned to this Porter Visit.','Attention','/properties/porter-visits','View Porter Visits',new.scheduled_date,clock_timestamp(),clock_timestamp()+interval '14 days',
    'porter:visit:'||new.id||':removed:'||new.notification_revision||':'||recipient.recipient_user_id);
  end loop;
  for recipient in select r.* from public.resolve_porter_notification_recipients(new.assigned_worker_employee_id,new.assigned_worker_crew_id,new.assigned_manager_employee_id) r
   where not exists(select 1 from public.resolve_porter_notification_recipients(old.assigned_worker_employee_id,old.assigned_worker_crew_id,old.assigned_manager_employee_id) o where o.recipient_user_id=r.recipient_user_id)
  loop
   perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,recipient.recipient_context,'visit_assignment',new.id,null,new.notification_revision,
    case when recipient.recipient_context='Manager' then 'Porter Visit Management Assigned' else 'Porter Visit Assigned' end,
    new.property_label||' is scheduled for '||to_char(new.scheduled_date,'Mon FMDD, YYYY')||case when new.scheduled_start_time is null then '.' else ' at '||to_char(new.scheduled_start_time,'FMHH12:MI AM')||'.' end,
    'Attention','/properties/porter-visits?visit='||new.id,'Open Visit',new.scheduled_date,clock_timestamp(),clock_timestamp()+interval '30 days',
    'porter:visit:'||new.id||':assignment:'||new.notification_revision||':'||recipient.recipient_user_id);
  end loop;
 end if;
 if schedule_changed then
  for recipient in select * from public.resolve_porter_notification_recipients(new.assigned_worker_employee_id,new.assigned_worker_crew_id,new.assigned_manager_employee_id) loop
   perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,recipient.recipient_context,'visit_schedule_changed',new.id,null,new.notification_revision,
    'Porter Visit Schedule Changed',new.property_label||' is now scheduled for '||to_char(new.scheduled_date,'Mon FMDD, YYYY')||case when new.scheduled_start_time is null then ' with no start time.' else ' at '||to_char(new.scheduled_start_time,'FMHH12:MI AM')||'.' end,
    'Attention','/properties/porter-visits?visit='||new.id,'Open Visit',new.scheduled_date,clock_timestamp(),clock_timestamp()+interval '14 days',
    'porter:visit:'||new.id||':schedule:'||new.notification_revision||':'||recipient.recipient_user_id);
  end loop;
 end if;
 return new;
end $$;

create or replace function public.generate_due_porter_notifications(p_now timestamptz default clock_timestamp())
returns integer language plpgsql security invoker set search_path='' as $$
declare visit record; recipient record; settings_timezone text; scheduled_at timestamptz; generated integer:=0; kind text; title text; description text; severity text;
begin
 select b.timezone into settings_timezone from public.business_settings b limit 1;
 if settings_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names tz where tz.name=settings_timezone) then raise exception 'A valid business timezone is required for Porter reminders.'; end if;
 for visit in select v.* from public.property_service_visits v where v.status='Scheduled' and v.started_at is null and v.scheduled_start_time is not null loop
  scheduled_at:=(visit.scheduled_date+visit.scheduled_start_time) at time zone settings_timezone; kind:=null;
  if scheduled_at<=p_now then kind:='visit_missed_start';title:='Porter Visit Missed Start';severity:='Urgent';
  elsif scheduled_at<=p_now+interval '1 hour' then kind:='visit_reminder_1h';title:='Porter Visit Starts Soon';severity:='Attention';
  elsif scheduled_at<=p_now+interval '24 hours' then kind:='visit_reminder_24h';title:='Upcoming Porter Visit';severity:='Info'; end if;
  if kind is null then continue; end if;
  description:=visit.property_label||' is scheduled for '||to_char(visit.scheduled_date,'Mon FMDD, YYYY')||' at '||to_char(visit.scheduled_start_time,'FMHH12:MI AM')||'.';
  for recipient in select * from public.resolve_porter_notification_recipients(visit.assigned_worker_employee_id,visit.assigned_worker_crew_id,visit.assigned_manager_employee_id) loop
   perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,recipient.recipient_context,kind,visit.id,null,visit.notification_revision,title,description,severity,
    '/properties/porter-visits?visit='||visit.id,'Open Visit',visit.scheduled_date,p_now,case when kind='visit_missed_start' then p_now+interval '30 days' else scheduled_at+interval '4 hours' end,
    'porter:visit:'||visit.id||':'||kind||':'||visit.notification_revision||':'||recipient.recipient_user_id); generated:=generated+1;
  end loop;
  if kind='visit_missed_start' then
   for recipient in select up.id recipient_user_id,up.employee_id recipient_employee_id from public.user_profiles up where up.is_active and up.role in ('Master Admin','Administrator','Manager') loop
    perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,'Management Escalation',kind,visit.id,null,visit.notification_revision,title,description,severity,
     '/properties/porter-visits?visit='||visit.id,'Open Visit',visit.scheduled_date,p_now,p_now+interval '30 days','porter:visit:'||visit.id||':'||kind||':'||visit.notification_revision||':'||recipient.recipient_user_id); generated:=generated+1;
   end loop;
  end if;
 end loop; return generated;
end $$;

create function public.create_porter_visit_v3(p_plan_id uuid,p_scheduled_date date,p_scheduled_start_time time,p_assigned_worker_employee_id uuid default null,p_assigned_worker_crew_id uuid default null,p_assigned_manager_employee_id uuid default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_plan public.property_service_plans;v_id uuid;v_label text;v_crew uuid;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Only management may create Porter Visits.' using errcode='42501';end if;
 if num_nonnulls(p_assigned_worker_employee_id,p_assigned_worker_crew_id)>1 then raise exception 'Choose either an individual Porter Tech or a Porter Crew, not both.';end if;
 select * into v_plan from public.property_service_plans where id=p_plan_id for share;
 if not found or v_plan.status<>'Active' or v_plan.archived_at is not null then raise exception 'Select an active, non-archived Property Service Plan.';end if;
 if p_scheduled_date is null then raise exception 'Scheduled date is required.';end if;if p_scheduled_start_time is null then raise exception 'Scheduled start time is required.';end if;
 select concat_ws(' - ',nullif(property_name,''),address) into v_label from public.properties where id=v_plan.property_id and client_id=v_plan.client_id;
 if not found then raise exception 'Plan property/client relationship is no longer valid.';end if;
 v_crew:=case when p_assigned_worker_employee_id is null then coalesce(p_assigned_worker_crew_id,v_plan.assigned_crew_id) end;
 if p_assigned_worker_employee_id is not null and not exists(select 1 from public.employee_service_roles sr join public.employees e on e.id=sr.employee_id where sr.employee_id=p_assigned_worker_employee_id and sr.service_role='Porter Tech' and e.employment_status='Active' and e.archived_at is null) then raise exception 'Select an active Porter Tech.';end if;
 if v_crew is not null and not exists(select 1 from public.crews where id=v_crew and status='Active' and archived_at is null) then raise exception 'Select an active Porter Crew.';end if;
 if p_assigned_manager_employee_id is not null and not exists(select 1 from public.employee_service_roles sr join public.employees e on e.id=sr.employee_id where sr.employee_id=p_assigned_manager_employee_id and sr.service_role='Porter Manager' and e.employment_status='Active' and e.archived_at is null) then raise exception 'Select an active Porter Manager.';end if;
 insert into public.property_service_visits(service_plan_id,client_id,property_id,assigned_crew_id,assigned_worker_employee_id,assigned_worker_crew_id,assigned_manager_employee_id,plan_name,property_label,scheduled_date,scheduled_start_time,visit_notes)
 values(v_plan.id,v_plan.client_id,v_plan.property_id,v_crew,p_assigned_worker_employee_id,v_crew,p_assigned_manager_employee_id,v_plan.name,v_label,p_scheduled_date,p_scheduled_start_time,nullif(btrim(p_notes),'')) returning id into v_id;
 insert into public.property_service_visit_areas(visit_id,source_plan_area_id,name,description,sort_order,is_required,requires_photo)
 select v_id,id,name,description,sort_order,is_required,requires_photo from public.property_service_plan_areas where service_plan_id=v_plan.id and active;
 return v_id;
end $$;
revoke all on function public.create_porter_visit_v3(uuid,date,time,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_porter_visit_v3(uuid,date,time,uuid,uuid,uuid,text) to authenticated;

create or replace function public.get_porter_visits(p_id uuid default null) returns setof jsonb
language sql stable security definer set search_path='' as $$
 select to_jsonb(v)||jsonb_build_object(
  'photos',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at,p.id) from public.property_service_visit_photos p where p.visit_id=v.id and p.archived_at is null),'[]'::jsonb),
  'issues',coalesce((select jsonb_agg(to_jsonb(i) order by i.reported_at desc,i.id) from public.property_service_visit_issues i where i.visit_id=v.id),'[]'::jsonb),
  'crew_name',c.crew_name,
  'worker_name',coalesce(nullif(btrim(we.preferred_name),''),concat_ws(' ',we.first_name,we.last_name)),
  'manager_name',coalesce(nullif(btrim(me.preferred_name),''),concat_ws(' ',me.first_name,me.last_name)),
  'areas',coalesce((select jsonb_agg(to_jsonb(a) order by a.sort_order,a.id) from public.property_service_visit_areas a where a.visit_id=v.id),'[]'::jsonb))
 from public.property_service_visits v left join public.crews c on c.id=v.assigned_worker_crew_id
 left join public.employees we on we.id=v.assigned_worker_employee_id left join public.employees me on me.id=v.assigned_manager_employee_id
 where (p_id is null or v.id=p_id) and public.can_access_porter_visit(v.assigned_worker_employee_id,v.assigned_worker_crew_id,v.assigned_manager_employee_id)
 order by v.scheduled_date desc,v.created_at desc
$$;

create or replace function public.get_porter_routes(p_id uuid default null) returns setof jsonb
language sql stable security definer set search_path='' as $$
 select to_jsonb(r)||jsonb_build_object('crew_name',c.crew_name,'business_today',(select (now() at time zone b.timezone)::date from public.business_settings b where exists(select 1 from pg_timezone_names tz where tz.name=b.timezone) limit 1),
 'stops',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('visit',case when v.id is null then null else jsonb_build_object('id',v.id,'property_label',v.property_label,'plan_name',v.plan_name,'status',v.status,'scheduled_date',v.scheduled_date,'scheduled_start_time',v.scheduled_start_time,'assigned_crew_id',v.assigned_crew_id,'assigned_worker_crew_id',v.assigned_worker_crew_id,'assigned_worker_employee_id',v.assigned_worker_employee_id,'assigned_manager_employee_id',v.assigned_manager_employee_id,'visit_notes',v.visit_notes) end) order by s.stop_order,s.id)
 from public.property_service_route_stops s left join public.property_service_visits v on v.id=s.visit_id and public.can_access_porter_visit(v.assigned_worker_employee_id,v.assigned_worker_crew_id,v.assigned_manager_employee_id) where s.route_id=r.id),'[]'::jsonb))
 from public.property_service_routes r join public.crews c on c.id=r.assigned_crew_id
 where auth.uid() is not null and (p_id is null or r.id=p_id) and public.can_access_porter_visit(null,r.assigned_crew_id,null)
 order by r.route_date,r.created_at,r.id
$$;

create or replace function public.mutate_porter_visit(p_id uuid,p_expected_updated_at timestamptz,p_action text,p_data jsonb default '{}')
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.property_service_visits;v_now timestamptz;v_manager boolean;v_status text;v_area uuid;v_worker uuid;v_crew uuid;v_assigned_manager uuid;v_start time;
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501';end if;
 select * into v from public.property_service_visits where id=p_id for update;
 if not found or not public.can_access_porter_visit(v.assigned_worker_employee_id,v.assigned_worker_crew_id,v.assigned_manager_employee_id) then raise exception 'Porter Visit not found or access denied.' using errcode='42501';end if;
 if v.updated_at is distinct from p_expected_updated_at then raise exception 'Visit changed. Refresh and reopen it before saving.' using errcode='40001';end if;
 if v.status in ('Completed','Cancelled') then raise exception 'Completed and Cancelled visits are read-only.';end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid visit update.';end if;
 v_manager:=public.has_any_role(array['Master Admin','Administrator','Manager']);v_now:=greatest(clock_timestamp(),v.updated_at+interval '1 microsecond');
 case p_action
 when 'edit' then
  if not v_manager or v.status<>'Scheduled' then raise exception 'Only management may edit a Scheduled visit.' using errcode='42501';end if;
  if nullif(p_data->>'scheduled_date','') is null then raise exception 'Scheduled date is required.';end if;
  v_start:=nullif(p_data->>'scheduled_start_time','')::time;if v_start is null then raise exception 'Scheduled start time is required.';end if;
  v_worker:=nullif(p_data->>'assigned_worker_employee_id','')::uuid;v_crew:=coalesce(nullif(p_data->>'assigned_worker_crew_id','')::uuid,nullif(p_data->>'assigned_crew_id','')::uuid);v_assigned_manager:=nullif(p_data->>'assigned_manager_employee_id','')::uuid;
  if num_nonnulls(v_worker,v_crew)>1 then raise exception 'Choose either an individual Porter Tech or a Porter Crew, not both.';end if;
  if v_worker is not null and not exists(select 1 from public.employee_service_roles sr join public.employees e on e.id=sr.employee_id where sr.employee_id=v_worker and sr.service_role='Porter Tech' and e.employment_status='Active' and e.archived_at is null) then raise exception 'Select an active Porter Tech.';end if;
  if v_crew is not null and not exists(select 1 from public.crews where id=v_crew and status='Active' and archived_at is null) then raise exception 'Select an active Porter Crew.';end if;
  if v_assigned_manager is not null and not exists(select 1 from public.employee_service_roles sr join public.employees e on e.id=sr.employee_id where sr.employee_id=v_assigned_manager and sr.service_role='Porter Manager' and e.employment_status='Active' and e.archived_at is null) then raise exception 'Select an active Porter Manager.';end if;
  update public.property_service_visits set scheduled_date=(p_data->>'scheduled_date')::date,scheduled_start_time=v_start,assigned_worker_employee_id=v_worker,assigned_worker_crew_id=v_crew,assigned_crew_id=v_crew,assigned_manager_employee_id=v_assigned_manager,visit_notes=nullif(btrim(p_data->>'visit_notes'),'') where id=p_id;
 when 'notes' then update public.property_service_visits set visit_notes=nullif(btrim(p_data->>'visit_notes'),'') where id=p_id;
 when 'start' then if v.status<>'Scheduled' then raise exception 'Only Scheduled visits can start.';end if;update public.property_service_visits set status='In Progress',started_at=coalesce(started_at,v_now) where id=p_id;
 when 'cancel' then if not v_manager then raise exception 'Only management may cancel visits.' using errcode='42501';end if;update public.property_service_visits set status='Cancelled',cancelled_at=coalesce(cancelled_at,v_now) where id=p_id;
 when 'complete' then
  if v.status<>'In Progress' then raise exception 'Start the visit before completing.';end if;
  if exists(select 1 from public.property_service_visit_areas where visit_id=p_id and is_required and status='Pending') then raise exception 'Resolve all required Pending service areas before completing.';end if;
  if exists(select 1 from public.property_service_visit_areas a where a.visit_id=p_id and a.is_required and a.requires_photo and (a.status='Pending' or not exists(select 1 from public.property_service_visit_photos p where p.visit_id=p_id and p.visit_area_id=a.id and p.archived_at is null))) then raise exception 'Add required photo evidence and resolve all required-photo service areas before completing this visit.';end if;
  update public.property_service_visits set status='Completed',completed_at=coalesce(completed_at,v_now) where id=p_id;
 when 'area' then
  if v.status<>'In Progress' then raise exception 'Start the visit before updating service areas.';end if;v_area:=(p_data->>'area_id')::uuid;v_status:=p_data->>'status';
  if v_status is null or v_status not in ('Pending','Completed','Unable to Complete') then raise exception 'Invalid service area status.';end if;
  update public.property_service_visit_areas set status=v_status,notes=nullif(btrim(p_data->>'notes'),''),completed_at=case when v_status='Completed' then coalesce(completed_at,v_now) else null end,updated_at=v_now where id=v_area and visit_id=p_id;
  if not found then raise exception 'Service area does not belong to this visit.';end if;
 else raise exception 'Unsupported Porter Visit action.';end case;
 update public.property_service_visits set updated_at=v_now where id=p_id;return p_id;
end $$;

create or replace function public.guard_porter_routed_visit_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501';end if;
 if (new.scheduled_date is distinct from old.scheduled_date or new.assigned_crew_id is distinct from old.assigned_crew_id or new.assigned_worker_crew_id is distinct from old.assigned_worker_crew_id or new.assigned_worker_employee_id is distinct from old.assigned_worker_employee_id)
  and exists(select 1 from public.property_service_route_stops s where s.visit_id=old.id and s.released_at is null) then raise exception 'Remove this visit from its Planned route or cancel the route before changing its date or worker assignment.';end if;
 return new;
end $$;
drop trigger porter_routed_visit_assignment on public.property_service_visits;
create trigger porter_routed_visit_assignment before update of scheduled_date,assigned_crew_id,assigned_worker_crew_id,assigned_worker_employee_id on public.property_service_visits for each row execute function public.guard_porter_routed_visit_assignment();

-- Route changes notify the route crew and each distinct manager assigned to an active stop.
create or replace function public.enqueue_porter_route_change_notifications()
returns trigger language plpgsql security invoker set search_path='' as $$
declare recipient record;revision bigint;changed boolean;
begin
 changed:=(old.status='Planned' and new.status='Planned' and new.updated_at is distinct from old.updated_at) or new.status='Cancelled' and old.status is distinct from new.status;
 if not changed then return new;end if;revision:=greatest(1,(extract(epoch from new.updated_at)*1000000)::bigint);
 for recipient in
  with recipients as (
   select * from public.resolve_porter_notification_recipients(null,new.assigned_crew_id,null)
   union all
   select rr.* from public.property_service_route_stops s join public.property_service_visits v on v.id=s.visit_id
    cross join lateral public.resolve_porter_notification_recipients(null,null,v.assigned_manager_employee_id) rr
    where s.route_id=new.id and s.released_at is null
  ) select distinct on(recipient_user_id) * from recipients order by recipient_user_id,case recipient_context when 'Manager' then 1 else 2 end
 loop
  perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,recipient.recipient_context,'route_changed',null,new.id,revision,'Porter Route Changed',
   coalesce(new.route_name,'Porter Route')||' for '||to_char(new.route_date,'Mon FMDD, YYYY')||case when new.status='Cancelled' then ' was cancelled.' else ' was updated.' end,
   'Attention','/properties/porter-routes?route='||new.id,'Open Route',new.route_date,clock_timestamp(),clock_timestamp()+interval '14 days','porter:route:'||new.id||':changed:'||revision||':'||recipient.recipient_user_id);
 end loop;return new;
end $$;

commit;
