-- Workforce Phase 1: time-off requests only. Employee platform presence is unchanged.
-- Transaction boundaries are intentionally managed by the migration runner.

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

create table public.employee_time_off_schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.employee_time_off_requests(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  actor_user_id uuid not null references public.user_profiles(id) on delete restrict,
  override_reason text not null check (char_length(btrim(override_reason)) between 10 and 2000),
  scheduled_date date not null,
  start_time time,
  estimated_duration numeric,
  assignment_kind text not null check (assignment_kind in ('individual','crew')),
  created_at timestamptz not null default now()
);
create index employee_time_off_schedule_overrides_job_idx on public.employee_time_off_schedule_overrides(job_id,created_at desc);

alter table public.employee_time_off_requests enable row level security;
alter table public.employee_time_off_events enable row level security;
alter table public.employee_time_off_notifications enable row level security;
alter table public.employee_time_off_schedule_overrides enable row level security;
revoke all on public.employee_time_off_requests,public.employee_time_off_events,public.employee_time_off_notifications,public.employee_time_off_schedule_overrides from public,anon,authenticated;
grant select,insert,update on public.employee_time_off_requests,public.employee_time_off_events,public.employee_time_off_notifications to service_role;
grant select,insert on public.employee_time_off_schedule_overrides to service_role;
grant select on public.employee_time_off_requests,public.employee_time_off_events,public.employee_time_off_notifications,public.employee_time_off_schedule_overrides to authenticated;

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
   and (p.employee_id=employee_time_off_requests.employee_id or p.role in ('Master Admin','Administrator','Manager')))
);
create policy employee_time_off_events_authorized_read on public.employee_time_off_events
for select to authenticated using (exists(
 select 1 from public.employee_time_off_requests r where r.id=request_id
 and exists(select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.is_active
   and (p.employee_id=r.employee_id or p.role in ('Master Admin','Administrator','Manager')))
));
create policy employee_time_off_notifications_recipient_read on public.employee_time_off_notifications
for select to authenticated using (recipient_user_id=(select auth.uid()));
create policy employee_time_off_schedule_overrides_management_read on public.employee_time_off_schedule_overrides
for select to authenticated using (exists(
 select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.is_active
 and p.role in ('Master Admin','Administrator','Manager')
));

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

create function private.job_time_off_conflicts(
 p_scheduled_date date,p_start_time time,p_estimated_duration numeric,
 p_assigned_employee_id uuid,p_assigned_crew_id uuid
) returns table(request_id uuid,employee_id uuid)
language sql stable security definer set search_path='' as $$
 with assigned as (
  select p_assigned_employee_id as employee_id where p_assigned_employee_id is not null
  union
  select c.crew_lead_id from public.crews c where c.id=p_assigned_crew_id and c.crew_lead_id is not null
  union
  select cm.employee_id from public.crew_members cm where cm.crew_id=p_assigned_crew_id
 ), job_window as (
  select
   case when p_start_time is null or p_estimated_duration is null or p_estimated_duration<=0
    then p_scheduled_date::timestamp else p_scheduled_date+p_start_time end as starts_at,
   case when p_start_time is null or p_estimated_duration is null or p_estimated_duration<=0
    then (p_scheduled_date+1)::timestamp else p_scheduled_date+p_start_time+(p_estimated_duration*interval '1 hour') end as ends_at
 )
 select r.id,a.employee_id from assigned a
 join public.employee_time_off_requests r on r.employee_id=a.employee_id and r.status='Approved'
 cross join job_window w
 where p_scheduled_date is not null
 and w.starts_at < case when r.is_full_day then (r.end_date+1)::timestamp else r.end_date+r.end_time end
 and w.ends_at > case when r.is_full_day then r.start_date::timestamp else r.start_date+r.start_time end
$$;

create function private.enforce_job_time_off_conflicts()
returns trigger language plpgsql security definer set search_path='' as $$
declare conflict record; reason text:=nullif(btrim(current_setting('app.time_off_override_reason',true)),''); actor uuid:=(select auth.uid());
begin
 if new.archived_at is not null or new.status in ('Cancelled','Archived')
   or new.scheduled_date is null or num_nonnulls(new.assigned_employee_id,new.assigned_crew_id)=0 then return new; end if;
 if not exists(select 1 from private.job_time_off_conflicts(new.scheduled_date,new.start_time,new.estimated_duration,new.assigned_employee_id,new.assigned_crew_id)) then return new; end if;
 if reason is null then
  raise exception 'The selected employee or crew has approved time off during this Job. Management must provide an override reason.' using errcode='23514';
 end if;
 if char_length(reason)<10 or char_length(reason)>2000 or not private.is_time_off_manager(actor) then
  raise exception 'A valid management time-off override reason is required.' using errcode='42501';
 end if;
 for conflict in select * from private.job_time_off_conflicts(new.scheduled_date,new.start_time,new.estimated_duration,new.assigned_employee_id,new.assigned_crew_id) loop
  insert into public.employee_time_off_schedule_overrides(
   request_id,job_id,employee_id,actor_user_id,override_reason,scheduled_date,start_time,estimated_duration,assignment_kind
  ) values (
   conflict.request_id,new.id,conflict.employee_id,actor,reason,new.scheduled_date,new.start_time,new.estimated_duration,
   case when new.assigned_employee_id is not null then 'individual' else 'crew' end
  );
 end loop;
 return new;
end $$;
create trigger enforce_job_time_off_conflicts
after insert or update of scheduled_date,start_time,estimated_duration,assigned_employee_id,assigned_crew_id on public.jobs
for each row execute function private.enforce_job_time_off_conflicts();

create function public.schedule_job_with_time_off_protection(
 p_job_id uuid,p_scheduled_date date,p_start_time time,p_estimated_duration numeric,
 p_assignment_kind text,p_employee_id uuid default null,p_crew_id uuid default null,
 p_override_reason text default null
) returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
declare job public.jobs; employee public.employees; crew public.crews; team jsonb:='[]'::jsonb; safe public.jobs_operational_safe; prior_reason text:=current_setting('app.time_off_override_reason',true);
begin
 if not private.is_time_off_manager((select auth.uid())) then raise exception 'Management scheduling permission is required.' using errcode='42501'; end if;
 if p_scheduled_date is null or p_start_time is null or p_estimated_duration is null or p_estimated_duration<=0 then raise exception 'A date, start time, and positive duration are required.'; end if;
 if p_assignment_kind not in ('unassigned','individual','crew')
  or (p_assignment_kind='individual' and (p_employee_id is null or p_crew_id is not null))
  or (p_assignment_kind='crew' and (p_crew_id is null or p_employee_id is not null))
  or (p_assignment_kind='unassigned' and (p_employee_id is not null or p_crew_id is not null)) then raise exception 'Choose one valid Job assignment target.'; end if;
 select * into job from public.jobs where id=p_job_id for update;
 if not found then raise exception 'Job not found.'; end if;
 if job.archived_at is not null or job.status in ('In Progress','Completed','Cancelled','Archived') then raise exception 'This Job can no longer be scheduled.'; end if;
 if p_assignment_kind='individual' then
  select * into employee from public.employees where id=p_employee_id and public.is_eligible_job_tech(id);
  if not found then raise exception 'Select an active eligible employee.'; end if;
 elsif p_assignment_kind='crew' then
  select * into crew from public.crews where id=p_crew_id and status='Active' and archived_at is null;
  if not found then raise exception 'Select an active Crew.'; end if;
  select coalesce(jsonb_agg(coalesce(nullif(btrim(e.preferred_name),''),btrim(e.first_name||' '||e.last_name)) order by e.last_name,e.first_name),'[]'::jsonb)
   into team from public.crew_members cm join public.employees e on e.id=cm.employee_id
   where cm.crew_id=crew.id and e.employment_status='Active' and e.archived_at is null;
 end if;
 perform set_config('app.time_off_override_reason',coalesce(p_override_reason,''),true);
 begin
  update public.jobs set scheduled_date=p_scheduled_date,start_time=p_start_time,estimated_duration=p_estimated_duration,
   assigned_employee_id=case when p_assignment_kind='individual' then employee.id end,
   assigned_employee_name=case when p_assignment_kind='individual' then coalesce(nullif(btrim(employee.preferred_name),''),btrim(employee.first_name||' '||employee.last_name)) end,
   assigned_crew_id=case when p_assignment_kind='crew' then crew.id end,
   assigned_crew_name=case when p_assignment_kind='crew' then crew.crew_name end,
   crew_lead_name=case when p_assignment_kind='crew' then (select coalesce(nullif(btrim(e.preferred_name),''),btrim(e.first_name||' '||e.last_name)) from public.employees e where e.id=crew.crew_lead_id) end,
   assigned_team=case when p_assignment_kind='crew' then team else '[]'::jsonb end,
   status=case when p_assignment_kind='unassigned' then 'Scheduled' else 'Crew Assigned' end
  where id=job.id;
  select * into safe from public.jobs_operational_safe where id=job.id;
 exception when others then
  perform set_config('app.time_off_override_reason',coalesce(prior_reason,''),true);
  raise;
 end;
 perform set_config('app.time_off_override_reason',coalesce(prior_reason,''),true);
 return safe;
end $$;

create function public.update_job_schedule_with_time_off_protection(
 p_job_id uuid,p_scheduled_date date,p_start_time time,p_estimated_duration numeric,
 p_override_reason text default null
) returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
declare current_status text; prior_reason text:=current_setting('app.time_off_override_reason',true); safe public.jobs_operational_safe;
begin
 if not private.is_time_off_manager((select auth.uid())) then raise exception 'Management scheduling permission is required.' using errcode='42501'; end if;
 select status into current_status from public.jobs where id=p_job_id for update;
 if not found then raise exception 'Job not found.'; end if;
 perform set_config('app.time_off_override_reason',coalesce(p_override_reason,''),true);
 begin
  safe:=public.update_operational_job(
   p_job_id,p_scheduled_date,p_start_time,p_estimated_duration,null,null,
   case when current_status='Ready to Schedule' then 'Scheduled' else null end
  );
 exception when others then
  perform set_config('app.time_off_override_reason',coalesce(prior_reason,''),true);
  raise;
 end;
 perform set_config('app.time_off_override_reason',coalesce(prior_reason,''),true);
 return safe;
end $$;

create function public.assign_job_worker_with_time_off_protection(
 p_job_id uuid,p_assignment_kind text,p_employee_id uuid default null,p_crew_id uuid default null,
 p_override_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior_reason text:=current_setting('app.time_off_override_reason',true); assigned jsonb;
begin
 if not private.is_time_off_manager((select auth.uid())) then raise exception 'Management assignment permission is required.' using errcode='42501'; end if;
 perform set_config('app.time_off_override_reason',coalesce(p_override_reason,''),true);
 begin
  assigned:=public.set_job_worker_assignment(p_job_id,p_assignment_kind,p_employee_id,p_crew_id);
 exception when others then
  perform set_config('app.time_off_override_reason',coalesce(prior_reason,''),true);
  raise;
 end;
 perform set_config('app.time_off_override_reason',coalesce(prior_reason,''),true);
 return assigned;
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
create trigger employee_time_off_schedule_overrides_append_only before update or delete on public.employee_time_off_schedule_overrides for each row execute function private.protect_employee_time_off_event();

revoke all on function private.is_time_off_manager(uuid),private.current_active_employee_id(),private.job_time_off_conflicts(date,time,numeric,uuid,uuid),private.enforce_job_time_off_conflicts(),private.protect_employee_time_off_event() from public,anon,authenticated;
revoke all on function public.submit_employee_time_off_request(date,date,boolean,time,time,text,text),public.cancel_employee_time_off_request(uuid,text),public.review_employee_time_off_request(uuid,text,text),public.get_my_employee_time_off_requests(),public.get_employee_time_off_review_queue(),public.get_approved_employee_absences(date,date),public.get_my_time_off_notifications(),public.schedule_job_with_time_off_protection(uuid,date,time,numeric,text,uuid,uuid,text),public.update_job_schedule_with_time_off_protection(uuid,date,time,numeric,text),public.assign_job_worker_with_time_off_protection(uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.submit_employee_time_off_request(date,date,boolean,time,time,text,text),public.cancel_employee_time_off_request(uuid,text),public.get_my_employee_time_off_requests(),public.get_approved_employee_absences(date,date),public.get_my_time_off_notifications() to authenticated;
grant execute on function public.review_employee_time_off_request(uuid,text,text),public.get_employee_time_off_review_queue(),public.schedule_job_with_time_off_protection(uuid,date,time,numeric,text,uuid,uuid,text),public.update_job_schedule_with_time_off_protection(uuid,date,time,numeric,text),public.assign_job_worker_with_time_off_protection(uuid,text,uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
