-- Phase 0B: Job crew presence / attendance confirmation
-- Forward-only migration.
begin;

create table public.job_crew_presence (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  crew_id uuid references public.crews(id),
  initial_status text not null check (initial_status in ('Present','Late','Absent','Excused','Added After Start')),
  current_status text not null check (current_status in ('Present','Late','Absent','Excused','Added After Start','Left Early','Absent - No Arrival','Needs Attendance Review')),
  scheduled_at timestamptz,
  expected_arrival_at timestamptz,
  physical_arrival_at timestamptz,
  physical_departure_at timestamptz,
  payroll_joined_at timestamptz,
  reason_code text,
  reason_detail text,
  excused boolean,
  confirmed_by_user_id uuid,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, employee_id)
);

create index job_crew_presence_job_idx
  on public.job_crew_presence(job_id);

create index job_crew_presence_employee_idx
  on public.job_crew_presence(employee_id, confirmed_at desc);

create table public.job_crew_presence_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  presence_id uuid references public.job_crew_presence(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  reason_code text,
  reason_detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index job_crew_presence_events_job_idx
  on public.job_crew_presence_events(job_id, occurred_at, id);

alter table public.job_crew_presence enable row level security;
alter table public.job_crew_presence_events enable row level security;

revoke all on public.job_crew_presence from public, anon, authenticated;
revoke all on public.job_crew_presence_events from public, anon, authenticated;

create or replace function public.start_operational_job_with_presence(
  p_job_id uuid,
  p_presence jsonb
)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
  safe public.jobs_operational_safe;
  started_at timestamptz;
  scheduled_at timestamptz;
  roster_ids uuid[] := '{}'::uuid[];
  supplied_ids uuid[] := '{}'::uuid[];
  present_ids uuid[] := '{}'::uuid[];
  employee_id uuid;
  item jsonb;
  status_value text;
  reason_value text;
  detail_value text;
  conflict_employee_name text;
  conflict_job_number text;
  presence_row public.job_crew_presence;
begin
  if auth.uid() is null then
    raise exception 'Job start permission denied.';
  end if;

  select *
  into j
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Job not found or access denied.';
  end if;

  if not (
    public.has_any_role(
      array[
        'Master Admin',
        'Administrator',
        'Manager'
      ]
    )
    or (
      public.has_role('Crew Lead')
      and j.assigned_crew_id is not null
      and exists (
        select 1
        from public.crews c
        where c.id = j.assigned_crew_id
          and c.status = 'Active'
          and c.archived_at is null
          and c.crew_lead_id = public.current_employee_id()
      )
    )
  )
  then
    raise exception 'Crew presence confirmation permission denied.';
  end if;
  if j.archived_at is not null
     or num_nonnulls(j.assigned_employee_id, j.assigned_crew_id) <> 1
  then
    raise exception 'The Job requires an assigned worker before it can be started.';
  end if;

  if j.status = 'In Progress' then
    select * into safe
    from public.jobs_operational_safe
    where id = j.id;
    return safe;
  end if;

  if j.status not in ('Scheduled','Crew Assigned') then
    raise exception 'Only an Assigned Job can be started.';
  end if;

  -- Individual-assignment jobs preserve the existing Start -> Join flow.
  if j.assigned_crew_id is null then
    started_at := transaction_timestamp();

    update public.jobs
    set status = 'In Progress',
        completed_at = null,
        operational_started_at = coalesce(operational_started_at, started_at),
        operational_ended_at = null
    where id = j.id;

    select * into safe
    from public.jobs_operational_safe
    where id = j.id;

    return safe;
  end if;

  if p_presence is null or jsonb_typeof(p_presence) <> 'array' then
    raise exception 'Crew presence confirmation is required before Start Job.';
  end if;

  select coalesce(array_agg(roster.employee_id order by roster.employee_id), '{}'::uuid[])
  into roster_ids
  from (
    select member.employee_id
    from public.crew_members member
    where member.crew_id = j.assigned_crew_id

    union

    select crew.crew_lead_id
    from public.crews crew
    where crew.id = j.assigned_crew_id
      and crew.crew_lead_id is not null
  ) roster
  join public.employees employee
    on employee.id = roster.employee_id
  where employee.department = 'Scrub Technicians'
    and employee.employment_status = 'Active'
    and employee.archived_at is null;

  select coalesce(
    array_agg((value->>'employeeId')::uuid order by (value->>'employeeId')::uuid),
    '{}'::uuid[]
  )
  into supplied_ids
  from jsonb_array_elements(p_presence)
  where value ? 'employeeId';

  if cardinality(supplied_ids) <> jsonb_array_length(p_presence)
     or cardinality(supplied_ids) <> cardinality(roster_ids)
     or exists (
       select 1
       from unnest(supplied_ids) supplied(employee_id)
       group by supplied.employee_id
       having count(*) > 1
     )
     or supplied_ids <> roster_ids
  then
    raise exception 'Presence must be confirmed exactly once for every active assigned Scrub Tech.';
  end if;

  started_at := transaction_timestamp();

  scheduled_at :=
    (
      (
        j.scheduled_date::text
        || ' '
        || coalesce(j.start_time, time '00:00')::text
      )::timestamp
      at time zone 'America/Los_Angeles'
    );

  for item in
    select value
    from jsonb_array_elements(p_presence)
  loop
    status_value := item->>'status';

    if status_value not in ('Present','Late','Absent','Excused') then
      raise exception 'Invalid crew presence status.';
    end if;

    if status_value = 'Excused'
       and nullif(btrim(coalesce(item->>'reasonCode', '')), '') is null
    then
      raise exception 'An excused absence requires a reason.';
    end if;

    if status_value = 'Excused'
       and item->>'reasonCode' = 'Other'
       and nullif(btrim(coalesce(item->>'reasonDetail', '')), '') is null
    then
      raise exception 'Other excused absence requires an explanation.';
    end if;
  end loop;

  select coalesce(
    array_agg((value->>'employeeId')::uuid order by (value->>'employeeId')::uuid),
    '{}'::uuid[]
  )
  into present_ids
  from jsonb_array_elements(p_presence)
  where value->>'status' = 'Present';

  -- Preserve the existing atomic conflict behavior, but only for Present workers.
  foreach employee_id in array present_ids loop
    perform pg_advisory_xact_lock(
      hashtextextended('job-payroll-employee:' || employee_id::text, 0)
    );
  end loop;

  select
    coalesce(
      nullif(btrim(employee.preferred_name), ''),
      nullif(btrim(concat_ws(' ', employee.first_name, employee.last_name)), ''),
      employee.employee_number,
      employee.id::text
    ),
    conflict_job.job_number
  into conflict_employee_name, conflict_job_number
  from unnest(present_ids) roster(employee_id)
  join public.employees employee
    on employee.id = roster.employee_id
  join public.time_entries entry
    on entry.employee_id = roster.employee_id
  join public.jobs conflict_job
    on conflict_job.id = entry.job_id
  where entry.job_id <> j.id
    and entry.status = 'Open'
    and entry.clock_out is null
    and entry.archived_at is null
  order by roster.employee_id, entry.clock_in, entry.id
  limit 1;

  if found then
    raise exception '% is already On Job for %. End that Job before starting this Job.',
      conflict_employee_name,
      conflict_job_number;
  end if;

  for item in
    select value
    from jsonb_array_elements(p_presence)
  loop
    employee_id := (item->>'employeeId')::uuid;
    status_value := item->>'status';
    reason_value := nullif(btrim(coalesce(item->>'reasonCode', '')), '');
    detail_value := nullif(btrim(coalesce(item->>'reasonDetail', '')), '');

    insert into public.job_crew_presence (
      job_id,
      employee_id,
      crew_id,
      initial_status,
      current_status,
      scheduled_at,
      expected_arrival_at,
      physical_arrival_at,
      payroll_joined_at,
      reason_code,
      reason_detail,
      excused,
      confirmed_by_user_id,
      confirmed_at,
      updated_at
    )
    values (
      j.id,
      employee_id,
      j.assigned_crew_id,
      status_value,
      status_value,
      scheduled_at,
      case
        when status_value = 'Late'
             and nullif(item->>'expectedArrivalAt', '') is not null
          then (item->>'expectedArrivalAt')::timestamptz
        else null
      end,
      case when status_value = 'Present' then started_at else null end,
      case when status_value = 'Present' then started_at else null end,
      reason_value,
      detail_value,
      case
        when status_value = 'Excused' then true
        when status_value = 'Absent' then false
        else null
      end,
      auth.uid(),
      started_at,
      started_at
    )
    returning *
    into presence_row;

    insert into public.job_crew_presence_events (
      job_id,
      employee_id,
      presence_id,
      event_type,
      from_status,
      to_status,
      occurred_at,
      actor_user_id,
      reason_code,
      reason_detail
    )
    values (
      j.id,
      employee_id,
      presence_row.id,
      'Initial Presence Confirmed',
      null,
      status_value,
      started_at,
      auth.uid(),
      reason_value,
      detail_value
    );
  end loop;

  foreach employee_id in array present_ids loop
    perform public.open_job_payroll_entry(
      j.id,
      employee_id,
      j.assigned_crew_id,
      started_at
    );
  end loop;

  update public.jobs
  set status = 'In Progress',
      completed_at = null,
      operational_started_at = coalesce(operational_started_at, started_at),
      operational_ended_at = null
  where id = j.id;

  select *
  into safe
  from public.jobs_operational_safe
  where id = j.id;

  return safe;
end;
$$;

revoke all on function public.start_operational_job_with_presence(uuid,jsonb)
from public, anon, authenticated;

grant execute on function public.start_operational_job_with_presence(uuid,jsonb)
to authenticated;

-- Crew jobs may no longer bypass presence confirmation through the legacy RPC.
-- Individual assignments preserve the existing lifecycle.
create or replace function public.start_operational_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
  safe public.jobs_operational_safe;
  started_at timestamptz;
begin
  if auth.uid() is null
     or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician'])
  then
    raise exception 'Job start permission denied.';
  end if;

  select *
  into j
  from public.jobs
  where id = p_job_id
  for update;

  if not found
     or not public.can_control_job_timer(j.assigned_employee_id, j.assigned_crew_id)
  then
    raise exception 'Job not found or access denied.';
  end if;

  if j.archived_at is not null
     or num_nonnulls(j.assigned_employee_id, j.assigned_crew_id) <> 1
  then
    raise exception 'The Job requires an assigned worker before it can be started.';
  end if;

  if j.status = 'In Progress' then
    select *
    into safe
    from public.jobs_operational_safe
    where id = j.id;

    return safe;
  end if;

  if j.status not in ('Scheduled','Crew Assigned') then
    raise exception 'Only an Assigned Job can be started.';
  end if;

  if j.assigned_crew_id is not null then
    raise exception 'Crew presence confirmation is required before Start Job.';
  end if;

  started_at := transaction_timestamp();

  update public.jobs
  set status = 'In Progress',
      completed_at = null,
      operational_started_at = coalesce(operational_started_at, started_at),
      operational_ended_at = null
  where id = j.id;

  select *
  into safe
  from public.jobs_operational_safe
  where id = j.id;

  return safe;
end;
$$;

revoke all on function public.start_operational_job(uuid)
from public, anon, authenticated;

grant execute on function public.start_operational_job(uuid)
to authenticated;

-- Phase 0B completion: controlled attendance transitions.
-- Privacy-focused operational reasons only.

create or replace function public.assert_job_presence_controller(p_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare j public.jobs;
begin
  if auth.uid() is null then raise exception 'Crew presence permission denied.'; end if;
  select * into j from public.jobs where id=p_job_id;
  if not found then raise exception 'Job not found or access denied.'; end if;
  if not (public.has_any_role(array['Master Admin','Administrator','Manager']) or
    (public.has_role('Crew Lead') and j.assigned_crew_id is not null and exists(
      select 1 from public.crews c where c.id=j.assigned_crew_id and c.status='Active'
      and c.archived_at is null and c.crew_lead_id=public.current_employee_id()))) then
    raise exception 'Crew presence permission denied.';
  end if;
  return j;
end;
$$;
revoke all on function public.assert_job_presence_controller(uuid) from public,anon,authenticated;

create or replace function public.validate_attendance_reason(p_reason text,p_detail text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_reason not in ('Approved Time Off','Non-Approved Time Off','Transportation Emergency','Other') then
    raise exception 'Invalid attendance reason.';
  end if;
  if p_reason='Other' and nullif(btrim(coalesce(p_detail,'')),'') is null then
    raise exception 'Other requires an explanation.';
  end if;
end;
$$;
revoke all on function public.validate_attendance_reason(text,text) from public,anon,authenticated;

create or replace function public.close_job_employee_payroll_entry(p_job_id uuid,p_employee_id uuid,p_ended_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.time_entries; hrs numeric; reg numeric; ot numeric; used_reg numeric;
begin
  select * into e from public.time_entries where job_id=p_job_id and employee_id=p_employee_id
    and status='Open' and clock_out is null and archived_at is null order by clock_in,id limit 1 for update;
  if not found then return null; end if;
  hrs:=greatest(extract(epoch from (p_ended_at-e.clock_in))/3600-greatest(e.break_minutes,0)/60.0,0);
  select coalesce(sum(x.regular_hours),0) into used_reg from public.time_entries x
    where x.employee_id=e.employee_id and x.work_date=e.work_date and x.id<>e.id
    and x.status in ('Completed','Approved') and x.archived_at is null;
  reg:=least(hrs,greatest(8-used_reg,0)); ot:=greatest(hrs-reg,0);
  update public.time_entries set clock_out=p_ended_at,status='Completed',total_hours=hrs,
    regular_hours=reg,overtime_hours=ot,regular_pay=reg*hourly_rate_snapshot,
    overtime_pay=ot*overtime_rate_snapshot,gross_pay=reg*hourly_rate_snapshot+ot*overtime_rate_snapshot
    where id=e.id;
  return e.id;
end;
$$;
revoke all on function public.close_job_employee_payroll_entry(uuid,uuid,timestamptz) from public,anon,authenticated;

create or replace function public.confirm_job_crew_arrival(p_job_id uuid,p_employee_id uuid)
returns public.job_crew_presence language plpgsql security definer set search_path='' as $$
declare j public.jobs; p public.job_crew_presence; arrived timestamptz:=transaction_timestamp(); label text;
begin
  j:=public.assert_job_presence_controller(p_job_id);
  select * into p from public.job_crew_presence where job_id=p_job_id and employee_id=p_employee_id for update;
  if not found or p.current_status not in ('Late','Added After Start') then raise exception 'This worker is not awaiting arrival.'; end if;
  label:=case when p.scheduled_at is null then null
    when arrived<=p.scheduled_at+interval '5 minutes' then 'On Time'
    when arrived<=p.scheduled_at+interval '15 minutes' then 'Minor Late'
    when arrived<=p.scheduled_at+interval '30 minutes' then 'Late'
    else 'Significant Late' end;
  update public.job_crew_presence set current_status='Present',physical_arrival_at=arrived,
    confirmed_by_user_id=auth.uid(),confirmed_at=arrived,updated_at=arrived where id=p.id returning * into p;
  insert into public.job_crew_presence_events(job_id,employee_id,presence_id,event_type,from_status,to_status,occurred_at,actor_user_id,metadata)
    values(p_job_id,p_employee_id,p.id,'Arrival Confirmed',p.initial_status,'Present',arrived,auth.uid(),jsonb_build_object('latenessClass',label));
  return p;
end;
$$;
revoke all on function public.confirm_job_crew_arrival(uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_job_crew_arrival(uuid,uuid) to authenticated;

create or replace function public.correct_job_crew_presence(p_job_id uuid,p_employee_id uuid,p_status text,p_reason text,p_detail text default null)
returns public.job_crew_presence language plpgsql security definer set search_path='' as $$
declare j public.jobs; p public.job_crew_presence; changed timestamptz:=transaction_timestamp(); old text;
begin
  j:=public.assert_job_presence_controller(p_job_id);
  if p_status not in ('Absent','Excused') then raise exception 'Correction status must be Absent or Excused.'; end if;
  perform public.validate_attendance_reason(p_reason,p_detail);
  select * into p from public.job_crew_presence where job_id=p_job_id and employee_id=p_employee_id for update;
  if not found then raise exception 'Crew presence record not found.'; end if;
  old:=p.current_status;
  if old='Present' then perform public.close_job_employee_payroll_entry(p_job_id,p_employee_id,coalesce(j.operational_started_at,p.confirmed_at)); end if;
  update public.job_crew_presence set current_status=p_status,reason_code=p_reason,reason_detail=nullif(btrim(coalesce(p_detail,'')),''),
    excused=(p_status='Excused'),updated_at=changed where id=p.id returning * into p;
  insert into public.job_crew_presence_events(job_id,employee_id,presence_id,event_type,from_status,to_status,occurred_at,actor_user_id,reason_code,reason_detail)
    values(p_job_id,p_employee_id,p.id,'Presence Corrected',old,p_status,changed,auth.uid(),p_reason,p_detail);
  return p;
end;
$$;
revoke all on function public.correct_job_crew_presence(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.correct_job_crew_presence(uuid,uuid,text,text,text) to authenticated;

create or replace function public.mark_job_crew_left_early(p_job_id uuid,p_employee_id uuid,p_reason text,p_detail text default null)
returns public.job_crew_presence language plpgsql security definer set search_path='' as $$
declare j public.jobs; p public.job_crew_presence; departed timestamptz:=transaction_timestamp(); old text;
begin
  j:=public.assert_job_presence_controller(p_job_id); perform public.validate_attendance_reason(p_reason,p_detail);
  select * into p from public.job_crew_presence where job_id=p_job_id and employee_id=p_employee_id for update;
  if not found or p.current_status<>'Present' then raise exception 'Only a Present worker can be marked Left Early.'; end if;
  old:=p.current_status; perform public.close_job_employee_payroll_entry(p_job_id,p_employee_id,departed);
  update public.job_crew_presence set current_status='Left Early',physical_departure_at=departed,reason_code=p_reason,
    reason_detail=nullif(btrim(coalesce(p_detail,'')),''),excused=(p_reason in ('Approved Time Off','Transportation Emergency')),
    updated_at=departed where id=p.id returning * into p;
  insert into public.job_crew_presence_events(job_id,employee_id,presence_id,event_type,from_status,to_status,occurred_at,actor_user_id,reason_code,reason_detail)
    values(p_job_id,p_employee_id,p.id,'Left Early',old,'Left Early',departed,auth.uid(),p_reason,p_detail);
  return p;
end;
$$;
revoke all on function public.mark_job_crew_left_early(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.mark_job_crew_left_early(uuid,uuid,text,text) to authenticated;

-- Override Join Job: crew workers must have an authority-confirmed Present state first.
create or replace function public.start_or_clock_in_to_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs; e uuid; entry public.time_entries; joined timestamptz; p public.job_crew_presence;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'Job participation permission denied.'; end if;
 e:=public.current_employee_id(); if e is null then raise exception 'Your user profile must be linked to an active Employee.'; end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or not public.can_access_job_assignment(j.assigned_employee_id,j.assigned_crew_id) then raise exception 'The authenticated employee is not assigned to this Job.'; end if;
 if j.archived_at is not null or j.status<>'In Progress' then raise exception 'Join Job is available only after the Job has been started.'; end if;
 if j.assigned_crew_id is not null then
   select * into p from public.job_crew_presence where job_id=j.id and employee_id=e for update;
   if not found or p.current_status<>'Present' then raise exception 'A Crew Lead or Manager must confirm your arrival before Join Job.'; end if;
 end if;
 joined:=now(); entry:=public.open_job_payroll_entry(j.id,e,j.assigned_crew_id,joined);
 if j.assigned_crew_id is not null then
   update public.job_crew_presence set payroll_joined_at=coalesce(payroll_joined_at,entry.clock_in),updated_at=joined where id=p.id;
   insert into public.job_crew_presence_events(job_id,employee_id,presence_id,event_type,from_status,to_status,occurred_at,actor_user_id,metadata)
     values(j.id,e,p.id,'Payroll Joined','Present','Present',joined,auth.uid(),jsonb_build_object('timeEntryId',entry.id));
 end if;
 return jsonb_build_object('jobId',j.id,'jobStatus','In Progress','clockedIn',true,'clockedInAt',entry.clock_in,'timeEntryId',entry.id,'jobStarted',false);
end;
$$;
revoke all on function public.start_or_clock_in_to_job(uuid) from public,anon,authenticated;
grant execute on function public.start_or_clock_in_to_job(uuid) to authenticated;

-- Override completion: unresolved Late becomes review-pending; completion remains allowed.
create or replace function public.complete_in_progress_job(p_job_id uuid)
returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
declare j public.jobs; safe public.jobs_operational_safe; ended timestamptz; p public.job_crew_presence;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'Job completion permission denied.'; end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or not public.can_control_job_timer(j.assigned_employee_id,j.assigned_crew_id) then raise exception 'Job not found or access denied.'; end if;
 if j.status='Completed' then select * into safe from public.jobs_operational_safe where id=j.id; return safe; end if;
 if j.archived_at is not null or j.status<>'In Progress' then raise exception 'Only an In Progress Job can be completed.'; end if;
 ended:=now();
 for p in select * from public.job_crew_presence where job_id=j.id and current_status='Late' for update loop
   update public.job_crew_presence set current_status='Needs Attendance Review',updated_at=ended where id=p.id;
   insert into public.job_crew_presence_events(job_id,employee_id,presence_id,event_type,from_status,to_status,occurred_at,actor_user_id)
     values(j.id,p.employee_id,p.id,'No Arrival - Review Required','Late','Needs Attendance Review',ended,auth.uid());
 end loop;
 perform public.close_job_payroll_entries(j.id,ended);
 update public.jobs set status='Completed',completed_at=ended,operational_ended_at=ended where id=j.id;
 select * into safe from public.jobs_operational_safe where id=j.id; return safe;
end;
$$;
revoke all on function public.complete_in_progress_job(uuid) from public,anon,authenticated;
grant execute on function public.complete_in_progress_job(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
