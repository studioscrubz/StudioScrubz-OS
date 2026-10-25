-- Workforce Phase 1: time-off requests only. Employee platform presence is unchanged.
begin;

create table public.employee_time_off_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  is_full_day boolean not null default true,
  start_time time,
  end_time time,
  leave_category text not null check (leave_category in ('Vacation','Sick','Personal','Bereavement','Jury Duty','Other')),
  employee_notes text,
  status text not null default 'Pending' check (status in ('Pending','Approved','Denied','Cancelled')),
  submitted_by uuid not null references public.user_profiles(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  decided_by uuid references public.user_profiles(id) on delete restrict,
  decided_at timestamptz,
  decision_notes text,
  cancelled_by uuid references public.user_profiles(id) on delete restrict,
  cancelled_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (is_full_day or (start_date=end_date and start_time is not null and end_time is not null and end_time>start_time)),
  check (is_full_day or (start_time is not null and end_time is not null))
);
create index employee_time_off_requests_employee_idx on public.employee_time_off_requests(employee_id,start_date desc);
create index employee_time_off_requests_pending_idx on public.employee_time_off_requests(status,submitted_at) where status='Pending';

create table public.employee_time_off_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.employee_time_off_requests(id) on delete restrict,
  revision integer not null,
  event_type text not null check (event_type in ('Submitted','Approved','Denied','Cancelled','Schedule Override')),
  actor_user_id uuid not null references public.user_profiles(id) on delete restrict,
  from_status text,
  to_status text not null,
  notes text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  created_at timestamptz not null default now(),
  unique(request_id,revision,event_type)
);

create table public.employee_time_off_notifications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.employee_time_off_requests(id) on delete restrict,
  recipient_user_id uuid not null references public.user_profiles(id) on delete cascade,
  event_type text not null check (event_type in ('Review Required','Approved','Denied','Cancelled')),
  request_revision integer not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique(request_id,recipient_user_id,event_type,request_revision)
);

alter table public.employee_time_off_requests enable row level security;
alter table public.employee_time_off_events enable row level security;
alter table public.employee_time_off_notifications enable row level security;
revoke all on public.employee_time_off_requests,public.employee_time_off_events,public.employee_time_off_notifications from public,anon,authenticated;
grant select,insert,update on public.employee_time_off_requests,public.employee_time_off_events,public.employee_time_off_notifications to service_role;
grant select on public.employee_time_off_requests,public.employee_time_off_events,public.employee_time_off_notifications to authenticated;

create function private.is_time_off_manager(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p where p.id=p_user_id and p.is_active and p.role in ('Master Admin','Administrator','Manager'))
$$;

create function private.current_active_employee_id()
returns uuid language sql stable security definer set search_path='' as $$
 select p.employee_id from public.user_profiles p join public.employees e on e.id=p.employee_id
 where p.id=(select auth.uid()) and p.is_active and e.archived_at is null and e.employment_status='Active'
$$;

create policy employee_time_off_requests_authorized_read on public.employee_time_off_requests
for select to authenticated using (
 exists(select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.is_active
   and (p.employee_id=employee_id or p.role in ('Master Admin','Administrator','Manager')))
);
create policy employee_time_off_events_authorized_read on public.employee_time_off_events
for select to authenticated using (exists(
 select 1 from public.employee_time_off_requests r where r.id=request_id
 and exists(select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.is_active
   and (p.employee_id=r.employee_id or p.role in ('Master Admin','Administrator','Manager')))
));
create policy employee_time_off_notifications_recipient_read on public.employee_time_off_notifications
for select to authenticated using (recipient_user_id=(select auth.uid()));

do $$
declare table_name text;
begin
 for table_name in select unnest(array['employee_time_off_requests','employee_time_off_notifications']) loop
  if not exists(
   select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename=table_name
  ) then
   execute format('alter publication supabase_realtime add table public.%I',table_name);
  end if;
 end loop;
end $$;

create function public.submit_employee_time_off_request(
 p_start_date date,p_end_date date,p_is_full_day boolean,p_start_time time,p_end_time time,p_leave_category text,p_notes text
) returns uuid language plpgsql security definer set search_path='' as $$
declare employee uuid:=private.current_active_employee_id(); request_id uuid; manager record;
begin
 if employee is null then raise exception 'An active employee-linked account is required.' using errcode='42501'; end if;
 if p_start_date is null or p_end_date is null or p_end_date<p_start_date or p_start_date<current_date then raise exception 'Choose a valid current or future date range.'; end if;
 if p_leave_category not in ('Vacation','Sick','Personal','Bereavement','Jury Duty','Other') then raise exception 'Choose a valid leave category.'; end if;
 if not coalesce(p_is_full_day,true) and (p_start_date<>p_end_date or p_start_time is null or p_end_time is null or p_end_time<=p_start_time) then raise exception 'Partial-day requests require one date and a valid time range.'; end if;
 insert into public.employee_time_off_requests(employee_id,start_date,end_date,is_full_day,start_time,end_time,leave_category,employee_notes,submitted_by)
 values(employee,p_start_date,p_end_date,coalesce(p_is_full_day,true),case when p_is_full_day then null else p_start_time end,case when p_is_full_day then null else p_end_time end,p_leave_category,nullif(btrim(p_notes),''),(select auth.uid())) returning id into request_id;
 insert into public.employee_time_off_events(request_id,revision,event_type,actor_user_id,to_status,notes)
 values(request_id,1,'Submitted',(select auth.uid()),'Pending',nullif(btrim(p_notes),''));
 for manager in select id from public.user_profiles where is_active and role in ('Master Admin','Administrator','Manager') and id<>(select auth.uid()) loop
  insert into public.employee_time_off_notifications(request_id,recipient_user_id,event_type,request_revision) values(request_id,manager.id,'Review Required',1) on conflict do nothing;
 end loop;
 return request_id;
end $$;

create function public.cancel_employee_time_off_request(p_request_id uuid,p_notes text default null)
returns void language plpgsql security definer set search_path='' as $$
declare request public.employee_time_off_requests; employee uuid:=private.current_active_employee_id();
begin
 select * into request from public.employee_time_off_requests where id=p_request_id for update;
 if not found or employee is null or request.employee_id<>employee then raise exception 'Time-off request unavailable.' using errcode='42501'; end if;
 if request.status not in ('Pending','Approved') or request.start_date<current_date then raise exception 'This request can no longer be cancelled.'; end if;
 update public.employee_time_off_requests set status='Cancelled',cancelled_by=(select auth.uid()),cancelled_at=now(),revision=revision+1,updated_at=now() where id=p_request_id returning * into request;
 insert into public.employee_time_off_events(request_id,revision,event_type,actor_user_id,from_status,to_status,notes)
 values(request.id,request.revision,'Cancelled',(select auth.uid()),case when request.decided_at is null then 'Pending' else 'Approved' end,'Cancelled',nullif(btrim(p_notes),''));
 update public.employee_time_off_notifications set cancelled_at=now() where request_id=request.id and cancelled_at is null;
 insert into public.employee_time_off_notifications(request_id,recipient_user_id,event_type,request_revision)
 select request.id,p.id,'Cancelled',request.revision from public.user_profiles p where p.is_active and p.role in ('Master Admin','Administrator','Manager') on conflict do nothing;
end $$;

create function public.review_employee_time_off_request(p_request_id uuid,p_decision text,p_notes text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request public.employee_time_off_requests; conflicts jsonb; employee_user uuid;
begin
 if not private.is_time_off_manager((select auth.uid())) then raise exception 'Management permission is required.' using errcode='42501'; end if;
 if p_decision not in ('Approved','Denied') then raise exception 'Decision must be Approved or Denied.'; end if;
 select * into request from public.employee_time_off_requests where id=p_request_id for update;
 if not found or request.status<>'Pending' then raise exception 'Only a pending request may be reviewed.'; end if;
 if request.submitted_by=(select auth.uid()) then raise exception 'Managers may not approve or deny their own request.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'job_number',j.job_number,'scheduled_date',j.scheduled_date)),'[]'::jsonb) into conflicts
 from public.jobs j where j.archived_at is null and j.status not in ('Cancelled','Archived') and j.scheduled_date between request.start_date and request.end_date
 and (j.assigned_employee_id=request.employee_id
   or exists(select 1 from public.crew_members cm where cm.crew_id=j.assigned_crew_id and cm.employee_id=request.employee_id)
   or exists(select 1 from public.crews c where c.id=j.assigned_crew_id and c.crew_lead_id=request.employee_id));
 update public.employee_time_off_requests set status=p_decision,decided_by=(select auth.uid()),decided_at=now(),decision_notes=nullif(btrim(p_notes),''),revision=revision+1,updated_at=now() where id=request.id returning * into request;
 insert into public.employee_time_off_events(request_id,revision,event_type,actor_user_id,from_status,to_status,notes,details)
 values(request.id,request.revision,p_decision,(select auth.uid()),'Pending',p_decision,nullif(btrim(p_notes),''),jsonb_build_object('schedule_conflicts',conflicts));
 update public.employee_time_off_notifications set cancelled_at=now() where request_id=request.id and event_type='Review Required' and cancelled_at is null;
 select id into employee_user from public.user_profiles where employee_id=request.employee_id and is_active limit 1;
 if employee_user is not null then insert into public.employee_time_off_notifications(request_id,recipient_user_id,event_type,request_revision) values(request.id,employee_user,p_decision,request.revision) on conflict do nothing; end if;
 return jsonb_build_object('request_id',request.id,'status',request.status,'schedule_conflicts',conflicts);
end $$;

create function public.get_my_employee_time_off_requests()
returns setof public.employee_time_off_requests language sql stable security definer set search_path='' as $$
 select r.* from public.employee_time_off_requests r where r.employee_id=private.current_active_employee_id() order by r.submitted_at desc
$$;

create function public.get_employee_time_off_review_queue()
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_time_off_manager((select auth.uid())) then raise exception 'Management permission is required.' using errcode='42501'; end if;
 return query select to_jsonb(r)||jsonb_build_object('employee_name',coalesce(e.preferred_name,e.first_name||' '||e.last_name),'history',(select coalesce(jsonb_agg(to_jsonb(ev) order by ev.created_at),'[]'::jsonb) from public.employee_time_off_events ev where ev.request_id=r.id)) from public.employee_time_off_requests r join public.employees e on e.id=r.employee_id order by (r.status='Pending') desc,r.submitted_at desc;
end $$;

create function public.get_approved_employee_absences(p_start_date date,p_end_date date)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_time_off_manager((select auth.uid())) then raise exception 'Management permission is required.' using errcode='42501'; end if;
 return query select jsonb_build_object('id',r.id,'employee_id',r.employee_id,'employee_name',coalesce(e.preferred_name,e.first_name||' '||e.last_name),'start_date',r.start_date,'end_date',r.end_date,'is_full_day',r.is_full_day,'start_time',r.start_time,'end_time',r.end_time)
 from public.employee_time_off_requests r join public.employees e on e.id=r.employee_id where r.status='Approved' and r.start_date<=p_end_date and r.end_date>=p_start_date order by r.start_date;
end $$;

create function public.get_my_time_off_notifications()
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.is_active) then raise exception 'Authentication required.' using errcode='42501'; end if;
 return query select jsonb_build_object('id',n.id,'request_id',n.request_id,'event_type',n.event_type,'request_revision',n.request_revision,'created_at',n.created_at,'status',r.status,'start_date',r.start_date,'end_date',r.end_date,'employee_name',coalesce(e.preferred_name,e.first_name||' '||e.last_name))
 from public.employee_time_off_notifications n join public.employee_time_off_requests r on r.id=n.request_id join public.employees e on e.id=r.employee_id
 where n.recipient_user_id=(select auth.uid()) and n.cancelled_at is null order by n.created_at desc;
end $$;

create function private.protect_employee_time_off_event()
returns trigger language plpgsql security definer set search_path='' as $$ begin raise exception 'Time-off audit history is append-only.'; end $$;
create trigger employee_time_off_events_append_only before update or delete on public.employee_time_off_events for each row execute function private.protect_employee_time_off_event();

revoke all on function private.is_time_off_manager(uuid),private.current_active_employee_id(),private.protect_employee_time_off_event() from public,anon,authenticated;
revoke all on function public.submit_employee_time_off_request(date,date,boolean,time,time,text,text),public.cancel_employee_time_off_request(uuid,text),public.review_employee_time_off_request(uuid,text,text),public.get_my_employee_time_off_requests(),public.get_employee_time_off_review_queue(),public.get_approved_employee_absences(date,date),public.get_my_time_off_notifications() from public,anon,authenticated;
grant execute on function public.submit_employee_time_off_request(date,date,boolean,time,time,text,text),public.cancel_employee_time_off_request(uuid,text),public.get_my_employee_time_off_requests(),public.get_approved_employee_absences(date,date),public.get_my_time_off_notifications() to authenticated;
grant execute on function public.review_employee_time_off_request(uuid,text,text),public.get_employee_time_off_review_queue() to authenticated;
notify pgrst,'reload schema';
commit;
