-- Porter schedule and route notifications. Visit scheduling remains authoritative;
-- routes are optional organization context.
begin;

alter table public.property_service_visits
  add column scheduled_start_time time without time zone,
  add column notification_revision bigint not null default 1
    check (notification_revision >= 1);

create index porter_visits_due_notification_idx
  on public.property_service_visits(scheduled_date, scheduled_start_time, status)
  where scheduled_start_time is not null and status = 'Scheduled';

create table public.porter_notification_events (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.user_profiles(id) on delete cascade,
  recipient_employee_id uuid references public.employees(id) on delete set null,
  recipient_context text not null check (recipient_context in ('Worker','Manager','Management Escalation','Removed Worker','Removed Manager')),
  event_type text not null check (event_type in (
    'visit_assignment','visit_assignment_removed','visit_schedule_changed',
    'visit_reminder_24h','visit_reminder_1h','visit_missed_start','route_changed'
  )),
  visit_id uuid references public.property_service_visits(id) on delete cascade,
  route_id uuid references public.property_service_routes(id) on delete cascade,
  notification_revision bigint not null check (notification_revision >= 1),
  title text not null,
  description text not null,
  severity text not null check (severity in ('Info','Attention','Urgent')),
  action_url text not null check (action_url like '/%'),
  action_label text not null,
  scheduled_date date,
  available_at timestamptz not null default now(),
  expires_at timestamptz,
  cancelled_at timestamptz,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  check (visit_id is not null or route_id is not null),
  check (expires_at is null or expires_at > available_at)
);

create index porter_notification_recipient_available_idx
  on public.porter_notification_events(recipient_user_id, available_at desc)
  where cancelled_at is null;
create index porter_notification_visit_idx on public.porter_notification_events(visit_id);
create index porter_notification_route_idx on public.porter_notification_events(route_id);

alter table public.porter_notification_events enable row level security;
revoke all on public.porter_notification_events from public, anon, authenticated;
grant select on public.porter_notification_events to authenticated;
grant all on public.porter_notification_events to service_role;
create policy "Recipients read own Porter notifications"
  on public.porter_notification_events for select to authenticated
  using ((select auth.uid()) = recipient_user_id);

-- Assignment-neutral resolver. Phase 1 supplies only p_worker_crew_id. The unused
-- employee parameters intentionally reserve the future individual-worker/manager shape.
create function public.resolve_porter_notification_recipients(
  p_worker_employee_id uuid default null,
  p_worker_crew_id uuid default null,
  p_manager_employee_id uuid default null
) returns table(recipient_user_id uuid, recipient_employee_id uuid, recipient_context text)
language sql stable security invoker set search_path = '' as $$
  with assignment_people as (
    select p_worker_employee_id employee_id, 'Worker'::text recipient_context
    where p_worker_employee_id is not null
    union all
    select c.crew_lead_id, 'Worker'::text
    from public.crews c
    where c.id = p_worker_crew_id and c.status = 'Active' and c.archived_at is null
      and c.crew_lead_id is not null
    union all
    select cm.employee_id, 'Worker'::text
    from public.crew_members cm join public.crews c on c.id = cm.crew_id
    where cm.crew_id = p_worker_crew_id and c.status = 'Active' and c.archived_at is null
    union all
    select p_manager_employee_id, 'Manager'::text
    where p_manager_employee_id is not null
  )
  select distinct up.id, e.id, ap.recipient_context
  from assignment_people ap
  join public.employees e on e.id = ap.employee_id
    and e.employment_status = 'Active' and e.archived_at is null
  join public.user_profiles up on up.employee_id = e.id and up.is_active
  where up.role in ('Master Admin','Administrator','Manager','Crew Lead','Scrub Technician')
$$;
revoke all on function public.resolve_porter_notification_recipients(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.resolve_porter_notification_recipients(uuid,uuid,uuid) to service_role;

create function public.enqueue_porter_notification(
  p_recipient_user_id uuid, p_recipient_employee_id uuid, p_recipient_context text,
  p_event_type text, p_visit_id uuid, p_route_id uuid, p_revision bigint,
  p_title text, p_description text, p_severity text, p_action_url text,
  p_action_label text, p_scheduled_date date, p_available_at timestamptz,
  p_expires_at timestamptz, p_dedupe_key text
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.porter_notification_events(
    recipient_user_id,recipient_employee_id,recipient_context,event_type,visit_id,route_id,
    notification_revision,title,description,severity,action_url,action_label,scheduled_date,
    available_at,expires_at,dedupe_key
  ) values (
    p_recipient_user_id,p_recipient_employee_id,p_recipient_context,p_event_type,p_visit_id,p_route_id,
    p_revision,p_title,p_description,p_severity,p_action_url,p_action_label,p_scheduled_date,
    p_available_at,p_expires_at,p_dedupe_key
  ) on conflict(dedupe_key) do nothing;
end $$;
revoke all on function public.enqueue_porter_notification(uuid,uuid,text,text,uuid,uuid,bigint,text,text,text,text,text,date,timestamptz,timestamptz,text) from public, anon, authenticated;

create function public.set_porter_visit_notification_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.scheduled_date is distinct from old.scheduled_date
    or new.scheduled_start_time is distinct from old.scheduled_start_time
    or new.assigned_crew_id is distinct from old.assigned_crew_id then
    new.notification_revision := old.notification_revision + 1;
  end if;
  return new;
end $$;
revoke all on function public.set_porter_visit_notification_revision() from public, anon, authenticated;
create trigger porter_visit_notification_revision
  before update of scheduled_date, scheduled_start_time, assigned_crew_id
  on public.property_service_visits for each row
  execute function public.set_porter_visit_notification_revision();

create function public.enqueue_porter_visit_change_notifications()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare recipient record; schedule_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.assigned_crew_id is not null then
      for recipient in select * from public.resolve_porter_notification_recipients(null,new.assigned_crew_id,null) loop
        perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,'Worker',
          'visit_assignment',new.id,null,new.notification_revision,'Porter Visit Assigned',
          new.property_label||' is scheduled for '||to_char(new.scheduled_date,'Mon FMDD, YYYY')||
            case when new.scheduled_start_time is null then '.' else ' at '||to_char(new.scheduled_start_time,'FMHH12:MI AM')||'.' end,
          'Attention','/properties/porter-visits?visit='||new.id,'Open Visit',new.scheduled_date,clock_timestamp(),
          clock_timestamp()+interval '30 days','porter:visit:'||new.id||':assignment:'||new.notification_revision||':'||recipient.recipient_user_id);
      end loop;
    end if;
    return new;
  end if;

  if new.status in ('In Progress','Completed','Cancelled') then
    update public.porter_notification_events set cancelled_at=coalesce(cancelled_at,clock_timestamp())
    where visit_id=new.id and event_type in ('visit_reminder_24h','visit_reminder_1h','visit_missed_start') and cancelled_at is null;
  end if;

  schedule_changed := new.scheduled_date is distinct from old.scheduled_date
    or new.scheduled_start_time is distinct from old.scheduled_start_time;
  if not schedule_changed and new.assigned_crew_id is not distinct from old.assigned_crew_id then return new; end if;

  update public.porter_notification_events set cancelled_at=coalesce(cancelled_at,clock_timestamp())
  where visit_id=new.id and event_type in ('visit_reminder_24h','visit_reminder_1h','visit_missed_start') and cancelled_at is null;

  if old.assigned_crew_id is distinct from new.assigned_crew_id then
    for recipient in
      select r.* from public.resolve_porter_notification_recipients(null,old.assigned_crew_id,null) r
      where not exists(select 1 from public.resolve_porter_notification_recipients(null,new.assigned_crew_id,null) n where n.recipient_user_id=r.recipient_user_id)
    loop
      perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,'Removed Worker',
        'visit_assignment_removed',new.id,null,new.notification_revision,'Porter Visit Assignment Removed',
        'You are no longer assigned to this Porter Visit.','Attention','/properties/porter-visits','View Porter Visits',
        new.scheduled_date,clock_timestamp(),clock_timestamp()+interval '14 days',
        'porter:visit:'||new.id||':removed:'||new.notification_revision||':'||recipient.recipient_user_id);
    end loop;
    for recipient in
      select r.* from public.resolve_porter_notification_recipients(null,new.assigned_crew_id,null) r
      where not exists(select 1 from public.resolve_porter_notification_recipients(null,old.assigned_crew_id,null) o where o.recipient_user_id=r.recipient_user_id)
    loop
      perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,'Worker',
        'visit_assignment',new.id,null,new.notification_revision,'Porter Visit Assigned',
        new.property_label||' is scheduled for '||to_char(new.scheduled_date,'Mon FMDD, YYYY')||
          case when new.scheduled_start_time is null then '.' else ' at '||to_char(new.scheduled_start_time,'FMHH12:MI AM')||'.' end,
        'Attention','/properties/porter-visits?visit='||new.id,'Open Visit',new.scheduled_date,clock_timestamp(),
        clock_timestamp()+interval '30 days','porter:visit:'||new.id||':assignment:'||new.notification_revision||':'||recipient.recipient_user_id);
    end loop;
  end if;

  if schedule_changed then
    for recipient in
      select r.* from public.resolve_porter_notification_recipients(null,new.assigned_crew_id,null) r
      where new.assigned_crew_id is not distinct from old.assigned_crew_id
        or exists(select 1 from public.resolve_porter_notification_recipients(null,old.assigned_crew_id,null) o where o.recipient_user_id=r.recipient_user_id)
    loop
      perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,'Worker',
        'visit_schedule_changed',new.id,null,new.notification_revision,'Porter Visit Schedule Changed',
        new.property_label||' is now scheduled for '||to_char(new.scheduled_date,'Mon FMDD, YYYY')||
          case when new.scheduled_start_time is null then ' with no start time.' else ' at '||to_char(new.scheduled_start_time,'FMHH12:MI AM')||'.' end,
        'Attention','/properties/porter-visits?visit='||new.id,'Open Visit',new.scheduled_date,clock_timestamp(),
        clock_timestamp()+interval '14 days','porter:visit:'||new.id||':schedule:'||new.notification_revision||':'||recipient.recipient_user_id);
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.enqueue_porter_visit_change_notifications() from public, anon, authenticated;
create trigger porter_visit_change_notifications
  after insert or update on public.property_service_visits for each row
  execute function public.enqueue_porter_visit_change_notifications();

create function public.enqueue_porter_route_change_notifications()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare recipient record; revision bigint; changed boolean;
begin
  changed := (old.status='Planned' and new.status='Planned' and new.updated_at is distinct from old.updated_at)
    or new.status='Cancelled' and old.status is distinct from new.status;
  if not changed then return new; end if;
  revision := greatest(1,(extract(epoch from new.updated_at)*1000000)::bigint);
  for recipient in select * from public.resolve_porter_notification_recipients(null,new.assigned_crew_id,null) loop
    perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,'Worker',
      'route_changed',null,new.id,revision,'Porter Route Changed',
      coalesce(new.route_name,'Porter Route')||' for '||to_char(new.route_date,'Mon FMDD, YYYY')||
        case when new.status='Cancelled' then ' was cancelled.' else ' was updated.' end,
      'Attention','/properties/porter-routes?route='||new.id,'Open Route',new.route_date,clock_timestamp(),
      clock_timestamp()+interval '14 days','porter:route:'||new.id||':changed:'||revision||':'||recipient.recipient_user_id);
  end loop;
  return new;
end $$;
revoke all on function public.enqueue_porter_route_change_notifications() from public, anon, authenticated;
create trigger porter_route_change_notifications
  after update on public.property_service_routes for each row
  execute function public.enqueue_porter_route_change_notifications();

create function public.generate_due_porter_notifications(p_now timestamptz default clock_timestamp())
returns integer language plpgsql security invoker set search_path = '' as $$
declare visit record; recipient record; settings_timezone text; scheduled_at timestamptz; generated integer:=0; kind text; title text; description text; severity text;
begin
  select b.timezone into settings_timezone from public.business_settings b limit 1;
  if settings_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names tz where tz.name=settings_timezone) then
    raise exception 'A valid business timezone is required for Porter reminders.';
  end if;
  for visit in select v.* from public.property_service_visits v
    where v.status='Scheduled' and v.started_at is null and v.scheduled_start_time is not null
  loop
    scheduled_at := (visit.scheduled_date + visit.scheduled_start_time) at time zone settings_timezone;
    kind := null;
    if scheduled_at <= p_now then kind:='visit_missed_start'; title:='Porter Visit Missed Start'; severity:='Urgent';
    elsif scheduled_at <= p_now+interval '1 hour' then kind:='visit_reminder_1h'; title:='Porter Visit Starts Soon'; severity:='Attention';
    elsif scheduled_at <= p_now+interval '24 hours' then kind:='visit_reminder_24h'; title:='Upcoming Porter Visit'; severity:='Info';
    end if;
    if kind is null then continue; end if;
    description := visit.property_label||' is scheduled for '||to_char(visit.scheduled_date,'Mon FMDD, YYYY')||' at '||to_char(visit.scheduled_start_time,'FMHH12:MI AM')||'.';
    for recipient in select * from public.resolve_porter_notification_recipients(null,visit.assigned_crew_id,null) loop
      perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,'Worker',kind,visit.id,null,
        visit.notification_revision,title,description,severity,'/properties/porter-visits?visit='||visit.id,'Open Visit',visit.scheduled_date,
        p_now,case when kind='visit_missed_start' then p_now+interval '30 days' else scheduled_at+interval '4 hours' end,
        'porter:visit:'||visit.id||':'||kind||':'||visit.notification_revision||':'||recipient.recipient_user_id);
      generated:=generated+1;
    end loop;
    if kind='visit_missed_start' then
      for recipient in select up.id recipient_user_id,up.employee_id recipient_employee_id
        from public.user_profiles up where up.is_active and up.role in ('Master Admin','Administrator','Manager')
      loop
        perform public.enqueue_porter_notification(recipient.recipient_user_id,recipient.recipient_employee_id,'Management Escalation',kind,visit.id,null,
          visit.notification_revision,title,description,severity,'/properties/porter-visits?visit='||visit.id,'Open Visit',visit.scheduled_date,
          p_now,p_now+interval '30 days','porter:visit:'||visit.id||':'||kind||':'||visit.notification_revision||':'||recipient.recipient_user_id);
        generated:=generated+1;
      end loop;
    end if;
  end loop;
  return generated;
end $$;
revoke all on function public.generate_due_porter_notifications(timestamptz) from public, anon, authenticated;
grant execute on function public.generate_due_porter_notifications(timestamptz) to service_role;

-- Versioned create RPC keeps the original create_porter_visit signature available.
create function public.create_porter_visit_v2(p_plan_id uuid,p_scheduled_date date,p_scheduled_start_time time,p_assigned_crew_id uuid default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_plan public.property_service_plans; v_id uuid; v_label text; v_crew uuid;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
  raise exception 'Only management may create Porter Visits.' using errcode='42501'; end if;
 select * into v_plan from public.property_service_plans where id=p_plan_id for share;
 if not found or v_plan.status<>'Active' or v_plan.archived_at is not null then raise exception 'Select an active, non-archived Property Service Plan.'; end if;
 if p_scheduled_date is null then raise exception 'Scheduled date is required.'; end if;
 if p_scheduled_start_time is null then raise exception 'Scheduled start time is required.'; end if;
 select concat_ws(' - ',nullif(property_name,''),address) into v_label from public.properties
 where id=v_plan.property_id and client_id=v_plan.client_id;
 if not found then raise exception 'Plan property/client relationship is no longer valid.'; end if;
 v_crew := coalesce(p_assigned_crew_id,v_plan.assigned_crew_id);
 if v_crew is not null and not exists(select 1 from public.crews where id=v_crew and status='Active' and archived_at is null) then raise exception 'Select an active crew.'; end if;
 insert into public.property_service_visits(service_plan_id,client_id,property_id,assigned_crew_id,plan_name,property_label,scheduled_date,scheduled_start_time,visit_notes)
 values(v_plan.id,v_plan.client_id,v_plan.property_id,v_crew,v_plan.name,v_label,p_scheduled_date,p_scheduled_start_time,nullif(btrim(p_notes),'')) returning id into v_id;
 insert into public.property_service_visit_areas(visit_id,source_plan_area_id,name,description,sort_order,is_required,requires_photo)
 select v_id,id,name,description,sort_order,is_required,requires_photo
 from public.property_service_plan_areas where service_plan_id=v_plan.id and active;
 return v_id;
end $$;
revoke all on function public.create_porter_visit_v2(uuid,date,time,uuid,text) from public,anon,authenticated;
grant execute on function public.create_porter_visit_v2(uuid,date,time,uuid,text) to authenticated;

create or replace function public.get_porter_routes(p_id uuid default null) returns setof jsonb
language sql stable security definer set search_path = '' as $$
 select to_jsonb(r) || jsonb_build_object('crew_name',c.crew_name,
 'business_today',(select (now() at time zone b.timezone)::date from public.business_settings b
  where exists(select 1 from pg_timezone_names tz where tz.name=b.timezone) limit 1),
 'stops',coalesce((
  select jsonb_agg(to_jsonb(s) || jsonb_build_object('visit',case when v.id is null then null else
   jsonb_build_object('id',v.id,'property_label',v.property_label,'plan_name',v.plan_name,'status',v.status,
    'scheduled_date',v.scheduled_date,'scheduled_start_time',v.scheduled_start_time,
    'assigned_crew_id',v.assigned_crew_id,'visit_notes',v.visit_notes) end) order by s.stop_order,s.id)
  from public.property_service_route_stops s left join public.property_service_visits v on v.id=s.visit_id
   and public.can_access_porter_visit(v.assigned_crew_id) where s.route_id=r.id),'[]'::jsonb))
 from public.property_service_routes r join public.crews c on c.id=r.assigned_crew_id
 where auth.uid() is not null and (p_id is null or r.id=p_id) and public.can_access_porter_visit(r.assigned_crew_id)
 order by r.route_date,r.created_at,r.id
$$;

-- Preserve all existing Porter mutation authorization and lifecycle rules while accepting start time.
create or replace function public.mutate_porter_visit(p_id uuid,p_expected_updated_at timestamptz,p_action text,p_data jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.property_service_visits; v_now timestamptz; v_manager boolean; v_status text; v_area uuid; v_crew uuid; v_start time;
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
  v_start:=nullif(p_data->>'scheduled_start_time','')::time;
  if v_start is null then raise exception 'Scheduled start time is required.'; end if;
  v_crew:=nullif(p_data->>'assigned_crew_id','')::uuid;
  if v_crew is not null and not exists(select 1 from public.crews where id=v_crew and status='Active' and archived_at is null) then raise exception 'Select an active crew.'; end if;
  update public.property_service_visits set scheduled_date=(p_data->>'scheduled_date')::date,scheduled_start_time=v_start,assigned_crew_id=v_crew,
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
  if v.status<>'In Progress' then raise exception 'Start the visit before completing.'; end if;
  if exists(select 1 from public.property_service_visit_areas where visit_id=p_id and is_required and status='Pending') then raise exception 'Resolve all required Pending service areas before completing.'; end if;
  if exists(select 1 from public.property_service_visit_areas a where a.visit_id=p_id and a.is_required and a.requires_photo
    and (a.status='Pending' or not exists(select 1 from public.property_service_visit_photos p where p.visit_id=p_id and p.visit_area_id=a.id and p.archived_at is null))) then
   raise exception 'Add required photo evidence and resolve all required-photo service areas before completing this visit.'; end if;
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
end $$;

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
  and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='porter_notification_events') then
  alter publication supabase_realtime add table public.porter_notification_events;
 end if;
end $$;

commit;
