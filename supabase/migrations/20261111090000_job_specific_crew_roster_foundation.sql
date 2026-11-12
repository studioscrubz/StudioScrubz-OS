-- Job-specific crew rosters, assignment events, and database timekeeping protections.
alter table public.crews
  add column if not exists technician_capacity integer not null default 4
  constraint crews_technician_capacity_valid check (technician_capacity between 0 and 50);

create table if not exists public.job_crew_technicians (
  job_id uuid not null references public.jobs(id) on delete restrict,
  crew_id uuid not null references public.crews(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  assigned_by_employee_id uuid not null references public.employees(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (job_id, employee_id)
);
create index if not exists job_crew_technicians_employee_idx
  on public.job_crew_technicians(employee_id, job_id);
alter table public.job_crew_technicians enable row level security;
revoke all on public.job_crew_technicians from public, anon, authenticated;

-- Job identity is required for authorization. Crew membership never grants job access.
alter table public.jobs add column if not exists assigned_crew_lead_id uuid references public.employees(id) on delete restrict;
update public.jobs j set assigned_crew_lead_id=c.crew_lead_id from public.crews c where c.id=j.assigned_crew_id;

create or replace function private.job_employee_assigned(p_job_id uuid,p_employee_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select p_employee_id is not null and exists(select 1 from public.jobs j where j.id=p_job_id and (
 j.assigned_employee_id=p_employee_id or j.assigned_crew_lead_id=p_employee_id
 or exists(select 1 from public.job_crew_technicians t where t.job_id=j.id and t.crew_id=j.assigned_crew_id and t.employee_id=p_employee_id)));
$$;
revoke all on function private.job_employee_assigned(uuid,uuid) from public,anon,authenticated;

create or replace function public.can_access_job(p_job_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and (public.has_any_role(array['Master Admin','Administrator','Manager'])
 or private.job_employee_assigned(p_job_id,public.current_employee_id()));
$$;
revoke all on function public.can_access_job(uuid) from public,anon;
grant execute on function public.can_access_job(uuid) to authenticated;

-- This legacy two-argument helper can only authorize management, an individual, or a lead.
-- Every job consumer below uses can_access_job(job_id) for technicians.
create or replace function public.can_access_job_assignment(p_employee_id uuid,p_crew_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and (public.has_any_role(array['Master Admin','Administrator','Manager'])
 or p_employee_id=public.current_employee_id()
 or exists(select 1 from public.crews c where c.id=p_crew_id and c.crew_lead_id=public.current_employee_id()));
$$;
create or replace function public.is_assigned_to_crew(p_crew_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from public.crews c where c.id=p_crew_id and c.crew_lead_id=public.current_employee_id());
$$;

create or replace view public.crew_directory_safe as  SELECT id,
    crew_name,
    crew_lead_id,
    status,
    notes,
    created_at,
    updated_at,
    archived_at
    , technician_capacity
 FROM crews c
  WHERE (has_any_role(ARRAY['Master Admin'::text, 'Administrator'::text, 'Manager'::text]) OR is_assigned_to_crew(id));

create or replace view public.jobs_operational_safe as  SELECT id,
    job_number,
    proposal_id,
    service_occurrence_id,
    estimate_id,
    walkthrough_id,
    client_id,
    property_id,
    division,
    client_name,
    property_name,
    service_name,
    frequency,
    status,
    scheduled_date,
    start_time,
    estimated_duration,
    assigned_crew_id,
    assigned_crew_name,
    crew_lead_name,
    assigned_team,
    scope,
    checklist,
    access_instructions,
    internal_notes,
    completed_at,
    created_at,
    updated_at,
    archived_at,
    operational_started_at,
    operational_ended_at,
        CASE
            WHEN (jsonb_typeof((pricing_snapshot -> 'addons'::text)) = 'array'::text) THEN ( SELECT COALESCE(jsonb_agg(jsonb_build_object('id', (addon.value ->> 'id'::text), 'label', (addon.value ->> 'label'::text), 'pricingType', (addon.value ->> 'pricingType'::text), 'quantity',
                    CASE
                        WHEN (jsonb_typeof((addon.value -> 'quantity'::text)) = 'number'::text) THEN ((addon.value ->> 'quantity'::text))::numeric
                        ELSE NULL::numeric
                    END, 'unitName', (addon.value ->> 'unitName'::text))), '[]'::jsonb) AS "coalesce"
               FROM jsonb_array_elements((job.pricing_snapshot -> 'addons'::text)) addon(value))
            ELSE NULL::jsonb
        END AS contracted_addons,
    assigned_employee_id,
    assigned_employee_name,
    on_my_way_initiated_at,
    job.assigned_crew_lead_id
   FROM jobs job
  WHERE can_access_job(id);

CREATE OR REPLACE FUNCTION public.can_write_operational_photo_record(p_record_type text, p_record_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text;
begin
  if auth.uid() is null then return false; end if;
  if p_record_type = 'walkthroughs' then
    return (public.has_any_role(array['Master Admin','Administrator','Sales']) and exists(select 1 from public.walkthroughs where id=p_record_id)) or public.can_perform_scheduled_walkthrough(p_record_id);
  end if;
  v_role := public.current_user_role();
  if v_role in ('Master Admin', 'Administrator', 'Manager') then
    if p_record_type = 'walkthroughs' then return exists(select 1 from public.walkthroughs where id = p_record_id); end if;
    if p_record_type = 'jobs' then return exists(select 1 from public.jobs where id = p_record_id); end if;
    return false;
  end if;
  if p_record_type = 'jobs' then
    return v_role in ('Crew Lead', 'Scrub Technician') and exists(
      select 1 from public.jobs j
      where j.id = p_record_id and public.can_access_job(j.id)
    );
  end if;
  return false;
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_operational_jobs(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'Job access is denied.'; end if;
 return query select to_jsonb(j)||jsonb_build_object('client_phone',c.phone,'client_first_name',c.first_name,'on_my_way_initiated_at',j.on_my_way_initiated_at)
  from public.jobs_operational_safe j left join public.clients c on c.id=j.client_id
    and public.has_any_role(array['Crew Lead','Scrub Technician'])
    and public.can_access_job(j.id)
  where j.id in(select public.get_operational_job_ids(p_start,p_end)) order by j.created_at desc;
end $function$;


CREATE OR REPLACE FUNCTION public.initiate_job_on_my_way(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.jobs; phone text; started timestamptz;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'On My Way access denied.'; end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or not public.can_access_job(j.id) then raise exception 'Job not found or access denied.'; end if;
 if j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') or j.scheduled_date is null or j.start_time is null then raise exception 'This Job is not eligible for On My Way.'; end if;
 select c.phone into phone from public.clients c where c.id=j.client_id;
 if phone is null or length(regexp_replace(phone,'[^0-9]','','g')) not between 7 and 15 then raise exception 'A valid client phone number is required.'; end if;
 if j.on_my_way_initiated_at is not null then return jsonb_build_object('initiated',false,'initiated_at',j.on_my_way_initiated_at); end if;
 update public.jobs set on_my_way_initiated_at=now() where id=j.id and on_my_way_initiated_at is null returning on_my_way_initiated_at into started;
 return jsonb_build_object('initiated',true,'initiated_at',started);
end $function$;


CREATE OR REPLACE FUNCTION public.can_read_job_quality(p_job_id uuid, p_finalized_only boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select auth.uid() is not null and exists(select 1 from public.jobs j where j.id=p_job_id and j.archived_at is null and public.can_access_job(j.id))
$function$;


CREATE OR REPLACE FUNCTION public.get_operational_job_ids(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'Job access is denied.'; end if;
 return query select j.id from public.jobs j where j.archived_at is null
  and j.status in ('Ready to Schedule','Scheduled','Crew Assigned','In Progress','Completed','Cancelled')
  and public.can_access_job(j.id)
  and (p_start is null or j.scheduled_date>=p_start) and (p_end is null or j.scheduled_date<=p_end)
  and (j.status<>'Completed' or not public.is_job_financially_handed_off(j.id)) order by j.created_at desc;
end $function$;


CREATE OR REPLACE FUNCTION public.can_read_job_gps(p_job_id uuid, p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select auth.uid() is not null and (
    public.has_any_role(array['Master Admin','Administrator','Manager'])
    or (p_employee_id=public.current_employee_id() and exists(
      select 1 from public.jobs j where j.id=p_job_id
        and public.can_access_job(j.id)
    ))
  )
$function$;


CREATE OR REPLACE FUNCTION public.get_job_equipment_assignments(p_job_id uuid)
 RETURNS TABLE(employee_id uuid, assigned_at timestamp with time zone, assigned_by_user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.jobs;
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 select * into j from public.jobs where id=p_job_id;
 if not found then raise exception 'Job not found.'; end if;
 if not (public.has_role('Master Admin') or public.has_any_role(array['Administrator','Manager'])
   or (j.assigned_crew_id is not null and public.can_access_job(j.id))
   or j.assigned_employee_id=public.current_employee_id()) then
   raise exception 'Equipment assignments access denied.';
 end if;
 return query select a.employee_id,a.assigned_at,a.assigned_by_user_id
 from public.job_equipment_assignments a where a.job_id=p_job_id and a.released_at is null
 order by a.assigned_at,a.employee_id;
end; $function$;


CREATE OR REPLACE FUNCTION public.can_access_client_from_assigned_job(p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select auth.uid() is not null and exists(select 1 from public.jobs j
    where j.client_id=p_client_id and j.archived_at is null
      and public.can_access_job(j.id))
$function$;


CREATE OR REPLACE FUNCTION public.can_access_property_from_assigned_job(p_property_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select auth.uid() is not null and exists(select 1 from public.jobs j
    where j.property_id=p_property_id and j.archived_at is null
      and public.can_access_job(j.id))
$function$;


CREATE OR REPLACE FUNCTION public.get_job_equipment_confirmation(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 if not exists(select 1 from public.jobs j where j.id=p_job_id and (public.has_any_role(array['Master Admin','Administrator','Manager']) or j.assigned_employee_id=public.current_employee_id() or public.can_access_job(j.id))) then raise exception 'Access denied.'; end if;
 return exists(select 1 from public.jobs where id=p_job_id and equipment_responsibility_confirmed_at is not null);
end; $function$;


CREATE OR REPLACE FUNCTION public.get_job_equipment_catalog(p_job_id uuid)
 RETURNS TABLE(item_name text, item_kind text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
select c.item_name,c.item_kind from public.equipment_checklist_catalog c join public.jobs_operational_safe j on j.id=p_job_id
where c.active and auth.uid() is not null
and (c.service_type='General' or (coalesce(j.service_name,'') ilike '%pressure%' and c.service_type='Pressure Washing')
or (coalesce(j.service_name,'') ilike '%construction%' and c.service_type='Post-Construction')
or (coalesce(j.service_name,'') ilike '%commercial%' and c.service_type='Commercial')
or (coalesce(j.service_name,'') ilike '%move%' and c.service_type='Move-In/Out'))
and (public.has_any_role(array['Master Admin','Administrator','Manager']) or j.assigned_employee_id=public.current_employee_id() or public.can_access_job(j.id))
order by c.service_type,c.display_order;
$function$;


CREATE OR REPLACE FUNCTION public.get_job_equipment_responsibility(p_job_id uuid)
 RETURNS TABLE(task_id uuid, crew_id uuid, crew_lead_employee_id uuid, responsible_employee_id uuid, responsible_name text, status text, revision integer, assigned_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
select t.id,t.crew_id,t.crew_lead_employee_id,t.responsible_employee_id,
 coalesce(nullif(btrim(e.preferred_name),''),nullif(btrim(concat_ws(' ',e.first_name,e.last_name)),'')),t.status,t.revision,t.assigned_at,t.updated_at
from public.job_equipment_responsibility_tasks t join public.jobs j on j.id=t.job_id
left join public.employees e on e.id=t.responsible_employee_id
where t.job_id=p_job_id and auth.uid() is not null and (
 public.has_any_role(array['Master Admin','Administrator','Manager']) or j.assigned_employee_id=public.current_employee_id() or public.can_access_job(j.id));
$function$;


CREATE OR REPLACE FUNCTION public.start_or_clock_in_to_job(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.jobs; e uuid; entry public.time_entries; joined timestamptz; p public.job_crew_presence;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'Job participation permission denied.'; end if;
 e:=public.current_employee_id(); if e is null then raise exception 'Your user profile must be linked to an active Employee.'; end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or not public.can_access_job(j.id) then raise exception 'The authenticated employee is not assigned to this Job.'; end if;
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
$function$;


CREATE OR REPLACE FUNCTION public.get_job_live_labor_burn(p_job_id uuid)
 RETURNS TABLE(job_id uuid, effective_labor_hours numeric, live_performance_labor_hours numeric, labor_burn_percent numeric, current_threshold integer, job_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  job public.jobs;
  budget numeric;
  live_hours numeric;
  burn numeric;
begin
  if auth.uid() is null
    or not public.has_any_role(array[
      'Master Admin', 'Administrator', 'Manager', 'Crew Lead', 'Scrub Technician'
    ]) then
    raise exception 'Live labor visibility denied.' using errcode = '42501';
  end if;

  select * into job
  from public.jobs
  where id = p_job_id;

  if not found
    or job.status <> 'In Progress'
    or job.archived_at is not null
    or not public.can_access_job(job.id) then
    raise exception 'Active Job is not available.' using errcode = '42501';
  end if;

  select case
    when snapshot.job_id is null then null
    else greatest(
      snapshot.budgeted_labor_hours
      + coalesce(adjustment.labor_hours_delta, 0),
      0
    )
  end
  into budget
  from public.jobs selected_job
  left join public.job_labor_budget_snapshots snapshot
    on snapshot.job_id = selected_job.id
  left join lateral (
    select coalesce(sum(item.labor_hours_delta), 0) as labor_hours_delta
    from public.job_labor_budget_adjustments item
    where item.job_id = selected_job.id
  ) adjustment on true
  where selected_job.id = job.id;

  select coalesce(sum(
    case
      when entry.status in ('Completed', 'Approved') then entry.total_hours
      when entry.status = 'Open' and entry.clock_out is null then greatest(
        extract(epoch from (now() - entry.clock_in)) / 3600
        - greatest(entry.break_minutes, 0) / 60.0,
        0
      )
      else 0
    end
  ), 0)
  into live_hours
  from public.time_entries entry
  where entry.job_id = job.id
    and entry.employee_id is not null
    and entry.entry_type = 'Job'
    and entry.labor_classification = 'Production'
    and entry.status in ('Open', 'Completed', 'Approved')
    and entry.archived_at is null;

  burn := case
    when budget is not null and budget > 0
      then round((live_hours / budget) * 100, 2)
    else null
  end;

  return query select
    job.id,
    budget,
    live_hours,
    burn,
    case
      when burn >= 110 then 110
      when burn >= 100 then 100
      when burn >= 90 then 90
      when burn >= 75 then 75
      else null
    end,
    job.status;
end;
$function$;


CREATE OR REPLACE FUNCTION public.evaluate_job_labor_thresholds(p_job_id uuid)
 RETURNS SETOF job_labor_threshold_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  job public.jobs;
  burn record;
begin
  if auth.uid() is null
    or not public.has_any_role(array[
      'Master Admin', 'Administrator', 'Manager', 'Crew Lead', 'Scrub Technician'
    ]) then
    raise exception 'Labor threshold evaluation denied.' using errcode = '42501';
  end if;

  select * into job from public.jobs where id = p_job_id;
  if not found
    or job.archived_at is not null
    or not public.can_access_job(job.id) then
    raise exception 'Job is not available.' using errcode = '42501';
  end if;

  if job.status <> 'In Progress' then
    return;
  end if;

  select * into burn
  from public.get_job_live_labor_burn(job.id);

  if burn.labor_burn_percent is null
    or burn.effective_labor_hours is null
    or burn.effective_labor_hours <= 0 then
    return;
  end if;

  return query
  insert into public.job_labor_threshold_events(
    job_id,
    threshold_percent,
    labor_burn_percent_at_crossing,
    performance_labor_hours_at_crossing,
    effective_labor_hours_at_crossing,
    crossed_at
  )
  select
    job.id,
    threshold.threshold_percent,
    burn.labor_burn_percent,
    burn.live_performance_labor_hours,
    burn.effective_labor_hours,
    now()
  from (values (75), (90), (100), (110)) as threshold(threshold_percent)
  where burn.labor_burn_percent >= threshold.threshold_percent
  on conflict (job_id, threshold_percent) do nothing
  returning job_labor_threshold_events.*;
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_calendar_completed_history()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician','Sales']) then
    raise exception 'Schedule access is denied.' using errcode='42501';
  end if;
  return query
    select to_jsonb(j)
    from public.jobs_operational_safe j
    where j.archived_at is null
      and j.status = 'Completed'
      and j.scheduled_date is not null
      and public.is_job_financially_handed_off(j.id)
      and (
        public.has_role('Master Admin')
        or public.has_role('Administrator')
        or public.has_role('Sales')
        or public.can_access_job(j.id)
      )
    order by j.scheduled_date desc;
end;
$function$;


CREATE OR REPLACE FUNCTION public.can_read_operational_photo_record(p_record_type text, p_record_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text;
begin
  if auth.uid() is null then return false; end if;

  if p_record_type = 'walkthroughs' then
    return (
      public.has_any_role(array['Master Admin', 'Administrator', 'Manager', 'Sales'])
      and exists (select 1 from public.walkthroughs where id = p_record_id)
    ) or public.can_perform_scheduled_walkthrough(p_record_id);
  end if;

  v_role := public.current_user_role();
  if v_role in ('Master Admin', 'Administrator', 'Manager') then
    if p_record_type = 'jobs' then
      return exists (select 1 from public.jobs where id = p_record_id);
    end if;
    return false;
  end if;

  if p_record_type = 'jobs' then
    return v_role in ('Crew Lead', 'Scrub Technician') and exists (
      select 1 from public.jobs job
      where job.id = p_record_id
        and public.can_access_job(job.id)
    );
  end if;

  return false;
end;
$function$;


CREATE OR REPLACE FUNCTION private.job_time_off_conflicts(p_scheduled_date date, p_start_time time without time zone, p_estimated_duration numeric, p_assigned_employee_id uuid, p_assigned_crew_id uuid)
 RETURNS TABLE(request_id uuid, employee_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with assigned as (
  select p_assigned_employee_id as employee_id where p_assigned_employee_id is not null
  union
  select c.crew_lead_id from public.crews c where c.id=p_assigned_crew_id and c.crew_lead_id is not null
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
$function$;


CREATE OR REPLACE FUNCTION private.jobsite_employee_authorized(p_job jobs, p_employee uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select p_job.assigned_employee_id=p_employee or (
    p_job.assigned_crew_id is not null and (
       exists(select 1 from public.crews c where c.id=p_job.assigned_crew_id and c.crew_lead_id=p_employee)
       or exists(select 1 from public.job_crew_technicians cm where cm.job_id=p_job.id and cm.employee_id=p_employee)
    )
 )
$function$;


CREATE OR REPLACE FUNCTION public.create_direct_operational_job(p_client_id uuid, p_property_id uuid, p_service_id uuid, p_addon_ids uuid[] DEFAULT '{}'::uuid[], p_scheduled_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_estimated_duration numeric DEFAULT NULL::numeric, p_assigned_crew_id uuid DEFAULT NULL::uuid, p_labor_hours numeric DEFAULT 0, p_access_instructions text DEFAULT NULL::text, p_internal_notes text DEFAULT NULL::text, p_master_price_override numeric DEFAULT NULL::numeric, p_addon_quantities jsonb DEFAULT '[]'::jsonb)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text;
  v_client public.clients;
  v_property public.properties;
  v_service public.services;
  v_crew public.crews;
  v_job public.jobs;
  v_quantity numeric;
  v_base numeric;
  v_addons numeric := 0;
  v_price numeric;
  v_effective_base numeric;
  v_addon public.service_addons;
  v_addon_snapshot jsonb := '[]'::jsonb;
  v_addon_quantity numeric;
  v_addon_unit_name text;
  v_addon_unit_price numeric;
  v_addon_line_total numeric;
  v_pricing_snapshot jsonb;
  v_scope jsonb;
  v_team jsonb := '[]'::jsonb;
  v_attempt integer;
  v_constraint_name text;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  v_role := public.current_user_role();
  if v_role not in ('Master Admin', 'Administrator', 'Manager') then
    raise exception 'Job creation permission denied.';
  end if;
  if p_master_price_override is not null and v_role <> 'Master Admin' then
    raise exception 'Only Master Admin can override a Direct Job price.';
  end if;
  if p_master_price_override is not null
    and (p_master_price_override = 'NaN'::numeric or p_master_price_override < 0)
  then
    raise exception 'Override Job Price must be greater than or equal to zero.';
  end if;
  if p_estimated_duration is not null
    and (p_estimated_duration = 'NaN'::numeric or p_estimated_duration < 0)
  then
    raise exception 'Estimated duration cannot be negative.';
  end if;
  if coalesce(p_labor_hours, 0) = 'NaN'::numeric or coalesce(p_labor_hours, 0) < 0 then
    raise exception 'Labor hours cannot be negative or invalid.';
  end if;
  if p_scheduled_date is null and p_start_time is not null then
    raise exception 'A start time requires a scheduled date.';
  end if;
  if jsonb_typeof(coalesce(p_addon_quantities, '[]'::jsonb)) <> 'array' then
    raise exception 'Add-On quantities must be a JSON array.';
  end if;

  select * into v_client from public.clients where id = p_client_id and archived_at is null;
  if not found then raise exception 'Active Client not found.'; end if;
  select * into v_property from public.properties
  where id = p_property_id and client_id = p_client_id and archived_at is null;
  if not found then raise exception 'The selected Property does not belong to the active Client.'; end if;
  select * into v_service from public.services
  where id = p_service_id and is_active and archived_at is null;
  if not found then raise exception 'Active Service not found.'; end if;
  if v_service.division is null
    or v_property.property_type is null
    or not (
      v_service.division = 'Both'
      or v_service.division = v_property.property_type
    )
  then
    raise exception 'The selected Service is not available for this Property division.';
  end if;
  if v_service.pricing_model is null
    or v_service.pricing_model not in (
      'Flat Rate', 'Size Tier', 'Per Square Foot', 'Per Bedroom',
      'Per Unit', 'Per Hour', 'Per Visit', 'Custom'
    )
  then
    raise exception 'The selected Service has an invalid pricing model.';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_addon_ids, '{}'::uuid[])) addon_id
    where not exists (
      select 1 from public.service_addon_links link
      join public.service_addons addon on addon.id = link.addon_id
      where link.service_id = v_service.id and link.addon_id = addon_id
      and addon.is_active and addon.archived_at is null
        and addon.division is not null
        and v_property.property_type is not null
        and (addon.division = 'Both' or addon.division = v_property.property_type)
    )
  ) then raise exception 'One or more selected Add-Ons are unavailable for this Service.'; end if;

  v_quantity := case when coalesce(v_property.square_feet, 0) > 0 then v_property.square_feet else 1 end;
  if v_service.pricing_model = 'Custom' then
    v_base := null;
  elsif v_service.pricing_model = 'Size Tier' then
    if exists (select 1 from public.service_price_tiers t where t.service_id = v_service.id and t.is_active and t.unit_label = 'Bedrooms') then
      if v_property.bedrooms is null or v_property.bathrooms is null then
        raise exception 'Set both bedrooms and bathrooms on the Property before creating this Job.';
      end if;
      select greatest(tier.price, v_service.minimum_price) into v_base
      from public.service_price_tiers tier
      where tier.service_id = v_service.id and tier.is_active
        and (tier.pricing_config->>'bedrooms') ~ '^[0-9]+$'
        and (tier.pricing_config->>'bedrooms')::integer = v_property.bedrooms
        and (tier.pricing_config->>'bathrooms' is null or
             ((tier.pricing_config->>'bathrooms') ~ '^[0-9]+$' and
              (tier.pricing_config->>'bathrooms')::integer = v_property.bathrooms))
        and coalesce((tier.pricing_config->>'custom_quote')::boolean,false) = false
      order by case when tier.pricing_config->>'bathrooms' is not null then 0 else 1 end, tier.display_order
      limit 1;
      if v_base is null then
        raise exception 'No matching bedroom/bathroom catalog tier for this Property. Configure a matching tier before creating the Job.';
      end if;
    else
      select tier.price into v_base from public.service_price_tiers tier
      where tier.service_id = v_service.id and tier.is_active
        and (tier.min_value is null or v_quantity >= tier.min_value)
        and (tier.max_value is null or v_quantity <= tier.max_value)
      order by tier.display_order, tier.min_value nulls first limit 1;
    end if;
  elsif v_service.pricing_model in ('Flat Rate', 'Per Visit') then
    v_base := greatest(v_service.base_price, v_service.minimum_price);
  else
    v_base := greatest(v_service.base_price * v_quantity, v_service.minimum_price);
  end if;
  if (v_base is null or v_base = 'NaN'::numeric) and p_master_price_override is null then
    raise exception 'This Service uses custom pricing and requires a Master Admin Job price override.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_addon_quantities, '[]'::jsonb)) payload
    where jsonb_typeof(payload) <> 'object'
      or nullif(payload->>'addonId', '') is null
      or not ((payload->>'addonId')::uuid = any(coalesce(p_addon_ids, '{}'::uuid[])))
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_addon_quantities, '[]'::jsonb)) payload
    group by payload->>'addonId' having count(*) > 1
  ) then raise exception 'Add-On quantities must identify each selected Add-On at most once.'; end if;

  for v_addon in
    select addon.* from public.service_addons addon
    where addon.id = any(coalesce(p_addon_ids, '{}'::uuid[]))
    order by addon.display_order, addon.addon_name
  loop
    if coalesce(v_addon.pricing_config->>'pricing_type', 'Flat Price') = 'Per Unit' then
      select (payload->>'quantity')::numeric into v_addon_quantity
      from jsonb_array_elements(coalesce(p_addon_quantities, '[]'::jsonb)) payload
      where payload->>'addonId' = v_addon.id::text;
      if v_addon_quantity is null or v_addon_quantity = 'NaN'::numeric
        or v_addon_quantity < 1 or v_addon_quantity <> trunc(v_addon_quantity)
      then raise exception 'Enter a positive whole-number quantity for Add-On %.', v_addon.addon_name; end if;
      v_addon_unit_name := nullif(btrim(v_addon.pricing_config->>'unit_name'), '');
      v_addon_unit_price := (v_addon.pricing_config->>'unit_price')::numeric;
      if v_addon_unit_name is null or v_addon_unit_price is null
        or v_addon_unit_price = 'NaN'::numeric or v_addon_unit_price < 0
      then raise exception 'Per Unit Add-On % has invalid catalog pricing.', v_addon.addon_name; end if;
      v_addon_line_total := round(v_addon_quantity * v_addon_unit_price, 2);
      v_addon_snapshot := v_addon_snapshot || jsonb_build_array(jsonb_build_object(
        'id', v_addon.id, 'label', v_addon.addon_name, 'pricingType', 'Per Unit',
        'quantity', v_addon_quantity, 'unitName', v_addon_unit_name,
        'unitPrice', v_addon_unit_price, 'lineTotal', v_addon_line_total));
    else
      v_addon_quantity := 1;
      v_addon_unit_name := null;
      v_addon_line_total := round(case when v_addon.pricing_model = 'Custom'
        then case when coalesce(v_addon.pricing_config->>'supply_cost', '') ~ '^([0-9]+)(\.[0-9]+)?$'
          then (v_addon.pricing_config->>'supply_cost')::numeric else v_addon.price end
        else v_addon.price end, 2);
      v_addon_unit_price := v_addon_line_total;
      v_addon_snapshot := v_addon_snapshot || jsonb_build_array(jsonb_build_object(
        'id', v_addon.id, 'label', v_addon.addon_name, 'pricingType', 'Flat Price',
        'quantity', 1, 'unitName', null, 'unitPrice', v_addon_unit_price,
        'lineTotal', v_addon_line_total));
    end if;
    v_addons := v_addons + v_addon_line_total;
  end loop;

  v_price := round(coalesce(p_master_price_override, v_base + v_addons), 2);
  v_effective_base := round(v_price - v_addons, 2);
  if v_price = 'NaN'::numeric or v_price < 0 or v_effective_base < 0 then
    raise exception 'The authoritative Job price cannot be less than its selected Add-On total.';
  end if;
  v_pricing_snapshot := jsonb_build_object(
    'version', 1, 'baseServiceAmount', v_effective_base,
    'addons', v_addon_snapshot, 'totalAmount', v_price);
  if not public.is_valid_job_pricing_snapshot(v_pricing_snapshot, v_price) then
    raise exception 'The authoritative Job pricing snapshot is invalid.';
  end if;

  select coalesce(jsonb_agg(item order by ordinal), '[]'::jsonb) into v_scope
  from (
    select 0 as ordinal, jsonb_build_object('id', gen_random_uuid(), 'text', v_service.description) as item
    where nullif(btrim(coalesce(v_service.description, '')), '') is not null
    union all
    select row_number() over (order by addon.display_order, addon.addon_name)::integer,
      jsonb_build_object('id', gen_random_uuid(), 'text', 'Add-On: ' || addon.addon_name ||
        case when nullif(btrim(coalesce(addon.description, '')), '') is null then '' else ' - ' || addon.description end)
    from public.service_addons addon where addon.id = any(coalesce(p_addon_ids, '{}'::uuid[]))
  ) scope_rows;

  if p_assigned_crew_id is not null then
    select * into v_crew from public.crews
    where id = p_assigned_crew_id and status = 'Active' and archived_at is null;
    if not found then raise exception 'Active Crew not found.'; end if;
    v_team:='[]'::jsonb;
  end if;

  for v_attempt in 1..5 loop
    begin
      insert into public.jobs (
        job_number, proposal_id, service_occurrence_id, estimate_id, walkthrough_id,
        client_id, property_id, division, client_name, property_name, service_name,
        frequency, status, scheduled_date, start_time, estimated_duration,
        assigned_crew_id, assigned_crew_name, crew_lead_name, assigned_team,
        price, pricing_snapshot, deposit, balance, labor_hours, recommended_crew_size, scope,
        checklist, photos, access_instructions, internal_notes, completed_at
      ) values (
        'JOB-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'),
        null, null, null, null, v_client.id, v_property.id, v_property.property_type,
        coalesce(v_client.company_name, nullif(concat_ws(' ', v_client.first_name, v_client.last_name), ''), 'Client'),
        coalesce(v_property.property_name, v_property.address), v_service.service_name,
        'One-Time', case when p_scheduled_date is null then 'Ready to Schedule' when p_assigned_crew_id is null then 'Scheduled' else 'Crew Assigned' end,
        p_scheduled_date, case when p_scheduled_date is null then null else p_start_time end, p_estimated_duration,
        case when p_assigned_crew_id is null then null else v_crew.id end,
        case when p_assigned_crew_id is null then null else v_crew.crew_name end,
        case when p_assigned_crew_id is null then null else (
          select coalesce(employee.preferred_name, nullif(trim(employee.first_name || ' ' || employee.last_name), ''))
          from public.employees employee
          where employee.id = v_crew.crew_lead_id
        ) end,
        v_team, v_price, v_pricing_snapshot, 0, v_price, coalesce(p_labor_hours, 0), greatest(jsonb_array_length(v_team), 1),
        v_scope, '[]'::jsonb, '[]'::jsonb,
        coalesce(nullif(btrim(coalesce(p_access_instructions, '')), ''), v_property.access_instructions),
        nullif(btrim(coalesce(p_internal_notes, '')), ''), null
      ) returning * into v_job;
      return v_job;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name is distinct from 'jobs_job_number_key' then
        raise;
      end if;
    end;
  end loop;
  raise exception 'A unique Job number could not be generated.';
end;
$function$;



CREATE OR REPLACE FUNCTION public.create_job_from_service_occurrence(p_occurrence_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_role text;
  occurrence_row public.service_occurrences;
  agreement_row public.service_agreements;
  client_row public.clients;
  property_row public.properties;
  crew_row public.crews;
  proposal_row public.proposals;
  supplement_row public.legacy_signed_agreement_pricing_allocations;
  job_row public.jobs;
  team jsonb := '[]'::jsonb;
  job_amount numeric;
  native_pricing_allocation jsonb;
  job_pricing_snapshot jsonb;
  job_date date;
  attempt integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_profiles where id = auth.uid() and is_active
  ) then raise exception 'An active authenticated profile is required.'; end if;
  caller_role := public.current_user_role();
  if caller_role not in ('Master Admin','Administrator','Manager') then
    raise exception 'Job creation permission is required.';
  end if;

  select * into occurrence_row from public.service_occurrences
  where id = p_occurrence_id for update;
  if not found then raise exception 'Service occurrence not found.'; end if;

  select * into agreement_row from public.service_agreements
  where id = occurrence_row.agreement_id for update;
  if not found or agreement_row.status <> 'Active' or agreement_row.archived_at is not null then
    raise exception 'Jobs can only be created for an Active Service Agreement.';
  end if;

  if occurrence_row.job_id is not null then
    select * into job_row from public.jobs where id = occurrence_row.job_id and archived_at is null;
    if found then return job_row; end if;
  end if;
  select * into job_row from public.jobs
  where service_occurrence_id = occurrence_row.id and archived_at is null limit 1;
  if found then
    update public.service_occurrences set job_id = job_row.id, status = 'Job Created'
    where id = occurrence_row.id;
    return job_row;
  end if;

  if occurrence_row.status = 'Job Created' then
    if exists (
      select 1 from public.jobs retained_job
      where retained_job.id = occurrence_row.job_id
         or retained_job.service_occurrence_id = occurrence_row.id
    ) then
      raise exception 'This service occurrence has retained Job history and cannot create another Job.';
    end if;
    update public.service_occurrences
    set status = 'Scheduled'
    where id = occurrence_row.id and job_id is null and status = 'Job Created';
  elsif occurrence_row.status <> 'Scheduled' then
    raise exception 'Only a Scheduled occurrence can create a Job.';
  end if;

  if occurrence_row.scheduled_date < agreement_row.start_date
    or (agreement_row.end_date is not null and not agreement_row.auto_renew and occurrence_row.scheduled_date > agreement_row.end_date) then
    raise exception 'Service occurrence falls outside the active Agreement term.';
  end if;

  select * into client_row from public.clients where id = agreement_row.client_id and archived_at is null;
  select * into property_row from public.properties where id = agreement_row.property_id and archived_at is null;
  if client_row.id is null or property_row.id is null then
    raise exception 'The Agreement requires active Client and Property relationships.';
  end if;
  if agreement_row.proposal_id is not null then
    select * into proposal_row from public.proposals where id = agreement_row.proposal_id;
  end if;
  if occurrence_row.assigned_crew_id is not null then
    select * into crew_row from public.crews
    where id = occurrence_row.assigned_crew_id
      and status = 'Active'
      and archived_at is null;
    if not found then
      raise exception 'The occurrence assigned crew is no longer active. Update the occurrence crew before creating the Job.';
    end if;
    team:='[]'::jsonb;
  end if;

  job_amount := case when agreement_row.billing_type = 'Per Visit' then agreement_row.billing_amount else 0 end;
  job_pricing_snapshot := null;
  if agreement_row.billing_type = 'Per Visit' then
    native_pricing_allocation := agreement_row.pricing_snapshot->'accepted_pricing_allocation';
    if native_pricing_allocation is not null and jsonb_typeof(native_pricing_allocation) <> 'null' then
      if not public.is_valid_job_pricing_snapshot(native_pricing_allocation, agreement_row.billing_amount) then
        raise exception 'The Agreement native accepted pricing allocation is invalid or does not match its Per Visit billing amount.';
      end if;
      job_pricing_snapshot := native_pricing_allocation;
    else
      select * into supplement_row
      from public.legacy_signed_agreement_pricing_allocations
      where service_agreement_id = agreement_row.id;
      if found then
        if not public.is_valid_job_pricing_snapshot(supplement_row.allocation, agreement_row.billing_amount)
          or round(supplement_row.signed_total, 2) is distinct from round(agreement_row.billing_amount, 2)
        then
          raise exception 'The legacy supplemental pricing allocation is invalid or does not match the Agreement Per Visit billing amount.';
        end if;
        job_pricing_snapshot := supplement_row.allocation || jsonb_build_object(
          'provenance', jsonb_build_object(
            'source', 'legacy_signed_agreement_supplement',
            'supplementId', supplement_row.id,
            'serviceAgreementId', agreement_row.id,
            'capturedAt', supplement_row.created_at
          )
        );
      end if;
    end if;
  end if;
  job_date := (now() at time zone coalesce((select timezone from public.business_settings limit 1), 'UTC'))::date;

  for attempt in 1..5 loop
    begin
      insert into public.jobs (
        job_number, proposal_id, estimate_id, walkthrough_id, service_occurrence_id,
        client_id, property_id, division, client_name, property_name, service_name,
        frequency, status, scheduled_date, start_time, estimated_duration,
        assigned_crew_id, assigned_crew_name, crew_lead_name, assigned_team,
        price, pricing_snapshot, deposit, balance, labor_hours, recommended_crew_size, scope,
        checklist, photos, access_instructions, internal_notes, completed_at
      ) values (
        'JOB-' || to_char(job_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'),
        agreement_row.proposal_id, proposal_row.estimate_id, proposal_row.walkthrough_id, occurrence_row.id,
        agreement_row.client_id, agreement_row.property_id, agreement_row.division,
        coalesce(client_row.company_name, nullif(concat_ws(' ', client_row.first_name, client_row.last_name), ''), 'Client'),
        coalesce(property_row.property_name, property_row.address), agreement_row.service_name,
        agreement_row.frequency, case when occurrence_row.assigned_crew_id is null then 'Scheduled' else 'Crew Assigned' end,
        occurrence_row.scheduled_date, occurrence_row.scheduled_start_time, agreement_row.estimated_duration,
        occurrence_row.assigned_crew_id, crew_row.crew_name,
        (select coalesce(e.preferred_name, nullif(trim(e.first_name || ' ' || e.last_name), '')) from public.employees e where e.id = crew_row.crew_lead_id),
        team, job_amount, job_pricing_snapshot, 0, job_amount, 0, greatest(jsonb_array_length(team), 1), agreement_row.scope,
        '[]'::jsonb, '[]'::jsonb, agreement_row.special_instructions, agreement_row.notes, null
      ) returning * into job_row;

      update public.service_occurrences set job_id = job_row.id, status = 'Job Created'
      where id = occurrence_row.id;
      return job_row;
    exception when unique_violation then
      select * into job_row from public.jobs
      where service_occurrence_id = occurrence_row.id and archived_at is null limit 1;
      if found then
        update public.service_occurrences set job_id = job_row.id, status = 'Job Created'
        where id = occurrence_row.id;
        return job_row;
      end if;
    end;
  end loop;
  raise exception 'A unique Job number could not be generated.';
end;
$function$;



CREATE OR REPLACE FUNCTION public.get_job_employee_participation(p_job_id uuid)
 RETURNS TABLE(employee_id uuid, employee_name text, job_role text, assigned boolean, presence_state text, arrival_at timestamp with time zone, departure_at timestamp with time zone, production_labor_hours numeric, approved_exception_hours numeric, participation_percentage numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.jobs; begin
 select * into j from public.jobs where id=p_job_id;
 if not found or not public.can_read_job_quality(p_job_id) then raise exception 'Job participation access denied.' using errcode='42501'; end if;
 return query with participants as (
  select j.assigned_employee_id id where j.assigned_employee_id is not null
  union select cm.employee_id from public.job_crew_technicians cm where cm.job_id=j.id
  union select j.assigned_crew_lead_id where j.assigned_crew_lead_id is not null
  union select p.employee_id from public.job_crew_presence p where p.job_id=j.id
  union select t.employee_id from public.time_entries t where t.job_id=j.id and t.employee_id is not null and t.archived_at is null
 ), labor as (
  select t.employee_id,
   coalesce(sum(t.total_hours) filter(where t.status in ('Completed','Approved') and t.labor_classification='Production'),0) production,
   coalesce(sum(t.total_hours) filter(where t.status in ('Completed','Approved') and t.labor_classification='Approved Exception'),0) exception_hours,
   min(t.clock_in) filter(where t.entry_type='Job') first_in,max(t.clock_out) filter(where t.entry_type='Job' and t.clock_out is not null) last_out
  from public.time_entries t where t.job_id=j.id and t.entry_type='Job' and t.archived_at is null group by t.employee_id
 ) select e.id,coalesce(nullif(btrim(e.preferred_name),''),nullif(btrim(concat_ws(' ',e.first_name,e.last_name)),''),e.employee_number),
  case when j.assigned_crew_lead_id=e.id then 'Crew Lead' when up.role='Manager' then 'Manager' else 'Technician' end,
  (j.assigned_employee_id=e.id or cm.employee_id is not null or j.assigned_crew_lead_id=e.id),p.current_status,
  coalesce(p.physical_arrival_at,p.payroll_joined_at,l.first_in),coalesce(p.physical_departure_at,l.last_out),l.production,l.exception_hours,
  case when j.operational_started_at is not null and j.operational_ended_at>j.operational_started_at and l.first_in is not null and l.last_out is not null then round(least(100,greatest(0,extract(epoch from (least(l.last_out,j.operational_ended_at)-greatest(l.first_in,j.operational_started_at)))/extract(epoch from (j.operational_ended_at-j.operational_started_at))*100))::numeric,2) else null end
 from participants x join public.employees e on e.id=x.id left join public.job_crew_presence p on p.job_id=j.id and p.employee_id=e.id left join labor l on l.employee_id=e.id left join public.crews c on c.id=j.assigned_crew_id left join public.job_crew_technicians cm on cm.job_id=j.id and cm.employee_id=e.id left join public.user_profiles up on up.employee_id=e.id and up.is_active order by employee_name;
end $function$;


CREATE OR REPLACE FUNCTION public.handoff_job_equipment(p_job_id uuid, p_from_employee_id uuid, p_to_employee_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.jobs; a public.job_equipment_assignments; v_handoff uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Document the equipment handoff reason.'; end if;
  if p_from_employee_id=p_to_employee_id then raise exception 'Handoff requires two different custodians.'; end if;
  select * into j from public.jobs where id=p_job_id for update;
  if not found or j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') then
    raise exception 'Active or planned job required.';
  end if;
  if not(exists(select 1 from public.crews c
    where c.id=j.assigned_crew_id and c.crew_lead_id=public.current_employee_id() and c.crew_lead_id=p_to_employee_id and c.archived_at is null and c.status='Active')) then
    raise exception 'Only the assigned Crew Lead can receive an equipment handoff.' using errcode='42501';
  end if;
  select * into a from public.job_equipment_assignments
    where job_id=p_job_id and employee_id=p_from_employee_id and released_at is null for update;
  if not found then raise exception 'Outgoing custodian is not assigned.'; end if;
  if not exists(select 1 from public.employees e where e.id=p_to_employee_id
    and e.archived_at is null and e.employment_status='Active'
    and (e.id=j.assigned_employee_id
      or exists(select 1 from public.job_crew_technicians cm where cm.job_id=j.id and cm.employee_id=e.id)
      or exists(select 1 from public.crews c where c.id=j.assigned_crew_id and c.crew_lead_id=e.id))) then
    raise exception 'Incoming custodian must be assigned to this job.';
  end if;
  if exists(select 1 from public.job_equipment_clearances c where c.assignment_id=a.id and c.status<>'Cleared') then
    raise exception 'Resolve outgoing custodian clearance first.';
  end if;
  if j.status='In Progress' and not exists(select 1 from public.job_equipment_clearances c
    where c.assignment_id=a.id and c.checkpoint='End Job' and c.status='Cleared') then
    raise exception 'Outgoing custodian must clear issued equipment before transfer.';
  end if;
  update public.job_equipment_assignments set released_at=now(),released_by_user_id=auth.uid(),
    release_reason=p_reason where id=a.id;
  insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details)
    values(a.id,'Reassigned',auth.uid(),jsonb_build_object('to',p_to_employee_id,'reason',p_reason));
  if not exists(select 1 from public.job_equipment_assignments
    where job_id=p_job_id and employee_id=p_to_employee_id and released_at is null) then
    insert into public.job_equipment_assignments(job_id,employee_id,assigned_by_user_id)
      values(p_job_id,p_to_employee_id,auth.uid());
  end if;
  perform private.reconcile_job_equipment_responsibility_task(p_job_id,j.assigned_crew_id,auth.uid());
  insert into public.job_equipment_handoffs(job_id,from_employee_id,to_employee_id,actor_user_id,reason)
    values(p_job_id,p_from_employee_id,p_to_employee_id,auth.uid(),p_reason) returning id into v_handoff;
  insert into public.job_equipment_notifications(job_id,employee_id,event_type,details)
    values(p_job_id,p_from_employee_id,'Equipment Released',jsonb_build_object('handoff',v_handoff)),
      (p_job_id,p_to_employee_id,'Equipment Handoff Pending',jsonb_build_object('handoff',v_handoff));
  -- Task synchronization is performed before creating the pending handoff.
  return v_handoff;
end;
$function$;


CREATE OR REPLACE FUNCTION public.open_job_payroll_entry(p_job_id uuid, p_employee_id uuid, p_crew_id uuid, p_started_at timestamp with time zone)
 RETURNS time_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_entry public.time_entries;
  v_employee public.employees;
  v_conflict text;
  v_number text;
begin
  if not private.job_employee_assigned(p_job_id,p_employee_id) then
    raise exception 'Employee is not assigned to this job.' using errcode='42501';
  end if;
  -- Serialize payroll opens for this employee so automatic crew start
  -- and manual Join cannot create competing open entries.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'job-payroll-employee:' || p_employee_id::text,
      0
    )
  );

  -- Idempotent for the same employee/job.
  select *
  into v_entry
  from public.time_entries
  where employee_id = p_employee_id
    and job_id = p_job_id
    and status = 'Open'
    and clock_out is null
    and archived_at is null
  for update;

  if found then
    return v_entry;
  end if;

  -- Do not allow an employee to be actively clocked into another Job.
  select job.job_number
  into v_conflict
  from public.time_entries entry
  join public.jobs job
    on job.id = entry.job_id
  where entry.employee_id = p_employee_id
    and entry.status = 'Open'
    and entry.clock_out is null
    and entry.archived_at is null
    and entry.job_id <> p_job_id
  order by entry.clock_in, entry.id
  limit 1;

  if found then
    raise exception
      'You are already On Job for %. End that Job before joining another.',
      v_conflict;
  end if;

  select *
  into v_employee
  from public.employees
  where id = p_employee_id
    and archived_at is null;

  if not found then
    raise exception 'Active Employee not found.';
  end if;

  v_number :=
    'TIME-' ||
    to_char(p_started_at, 'YYYYMMDDHH24MISSMS') ||
    '-' ||
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.time_entries(
    time_entry_number,
    employee_id,
    job_id,
    crew_id,
    work_date,
    clock_in,
    entry_type,
    notes,
    status,
    hourly_rate_snapshot,
    overtime_rate_snapshot
  )
  values (
    v_number,
    p_employee_id,
    p_job_id,
    p_crew_id,
    (p_started_at at time zone 'America/Los_Angeles')::date,
    p_started_at,
    'Job',
    'Job participation',
    'Open',
    v_employee.hourly_rate,
    v_employee.hourly_rate * 1.5
  )
  returning *
  into v_entry;

  return v_entry;
end;
$function$;


CREATE OR REPLACE FUNCTION public.review_employee_time_off_request(p_request_id uuid, p_decision text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   or exists(select 1 from public.job_crew_technicians cm where cm.job_id=j.id and cm.employee_id=request.employee_id)
   or exists(select 1 from public.crews c where c.id=j.assigned_crew_id and c.crew_lead_id=request.employee_id));
 update public.employee_time_off_requests set status=p_decision,decided_by=(select auth.uid()),decided_at=now(),decision_notes=nullif(btrim(p_notes),''),revision=revision+1,updated_at=now() where id=request.id returning * into request;
 insert into public.employee_time_off_events(request_id,revision,event_type,actor_user_id,from_status,to_status,notes,details)
 values(request.id,request.revision,p_decision,(select auth.uid()),'Pending',p_decision,nullif(btrim(p_notes),''),jsonb_build_object('schedule_conflicts',conflicts));
 update public.employee_time_off_notifications set cancelled_at=now() where request_id=request.id and event_type='Review Required' and cancelled_at is null;
 select id into employee_user from public.user_profiles where employee_id=request.employee_id and is_active limit 1;
 if employee_user is not null then insert into public.employee_time_off_notifications(request_id,recipient_user_id,event_type,request_revision) values(request.id,employee_user,p_decision,request.revision) on conflict do nothing; end if;
 return jsonb_build_object('request_id',request.id,'status',request.status,'schedule_conflicts',conflicts);
end $function$;


CREATE OR REPLACE FUNCTION public.schedule_job_with_time_off_protection(p_job_id uuid, p_scheduled_date date, p_start_time time without time zone, p_estimated_duration numeric, p_assignment_kind text, p_employee_id uuid DEFAULT NULL::uuid, p_crew_id uuid DEFAULT NULL::uuid, p_override_reason text DEFAULT NULL::text)
 RETURNS jobs_operational_safe
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  team:='[]'::jsonb;
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
end $function$;



CREATE OR REPLACE FUNCTION public.set_job_equipment_responsibility(p_job_id uuid, p_employee_ids uuid[], p_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  j public.jobs; task public.job_equipment_responsibility_tasks; chosen uuid;
  actor uuid:=auth.uid(); old_employee uuid; assignment public.job_equipment_assignments;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if p_employee_ids is null or cardinality(p_employee_ids)<>1 or p_employee_ids[1] is null then
    raise exception 'Select exactly one responsible crew member.';
  end if;
  chosen:=p_employee_ids[1];
  select * into j from public.jobs where id=p_job_id for update;
  if not found or j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') then
    raise exception 'Equipment responsibility requires an active or planned Job.';
  end if;
  if auth.uid() is null or not exists(select 1 from public.crews c where c.id=j.assigned_crew_id
    and c.crew_lead_id=public.current_employee_id() and c.status='Active' and c.archived_at is null) then
    raise exception 'Assigned Crew Lead required.' using errcode='42501';
  end if;
  perform private.reconcile_job_equipment_responsibility_task(p_job_id,j.assigned_crew_id,auth.uid());
  select * into task from public.job_equipment_responsibility_tasks where job_id=p_job_id for update;
  if not found or task.crew_id is distinct from j.assigned_crew_id or task.crew_lead_employee_id is null then
    raise exception 'An assigned crew with a Crew Lead is required.';
  end if;
  if auth.uid() is null or public.current_employee_id() is distinct from task.crew_lead_employee_id then
    raise exception 'Only the assigned Crew Lead may assign equipment responsibility.' using errcode='42501';
  end if;
  if chosen is distinct from task.crew_lead_employee_id then
    raise exception 'Only the assigned Crew Lead may hold equipment responsibility.' using errcode='42501';
  end if;
  if not exists(select 1 from public.employees e where e.id=chosen and e.archived_at is null and e.employment_status='Active'
    and (e.id=task.crew_lead_employee_id or exists(select 1 from public.job_crew_technicians cm where cm.job_id=task.job_id and cm.employee_id=e.id))) then
    raise exception 'The responsible employee must be an active member of the assigned crew.';
  end if;
  if chosen is distinct from task.crew_lead_employee_id then
    raise exception 'Only the assigned Crew Lead may hold equipment responsibility.' using errcode='42501';
  end if;
  old_employee:=task.responsible_employee_id;
  if old_employee is not null and old_employee<>chosen and exists(
    select 1 from public.job_equipment_assignments a join public.job_equipment_clearances cl on cl.assignment_id=a.id
      where a.job_id=p_job_id and a.employee_id=old_employee and a.released_at is null and cl.status<>'Cleared'
  ) then raise exception 'Resolve pending equipment clearance before reassigning responsibility.'; end if;
  if old_employee is not null and old_employee<>chosen then
    update public.job_equipment_assignments set released_at=now(),released_by_user_id=actor,
      release_reason=coalesce(nullif(btrim(p_reason),''),'Equipment responsibility reassigned')
      where job_id=p_job_id and employee_id=old_employee and released_at is null;
  end if;
  select * into assignment from public.job_equipment_assignments
    where job_id=p_job_id and employee_id=chosen and released_at is null;
  if not found then
    insert into public.job_equipment_assignments(job_id,employee_id,assigned_by_user_id)
      values(p_job_id,chosen,actor) returning * into assignment;
    insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details)
      values(assignment.id,'Assigned',
        actor,jsonb_build_object('reason',coalesce(p_reason,'')));
  end if;
  if old_employee is distinct from chosen or task.status='Pending Assignment' then
    update public.job_equipment_responsibility_tasks set responsible_employee_id=chosen,status='Assigned',
      assigned_at=now(),revision=revision+1,updated_at=now() where id=task.id returning * into task;
    insert into public.job_equipment_responsibility_events(
      task_id,job_id,revision,event_type,crew_id,crew_lead_employee_id,responsible_employee_id,actor_user_id,reason
    ) values(task.id,p_job_id,task.revision,case when old_employee is null then 'Assigned' else 'Reassigned' end,
      task.crew_id,task.crew_lead_employee_id,chosen,actor,
      coalesce(nullif(btrim(p_reason),''),'Crew Lead designation'));
  end if;
  update public.jobs set equipment_responsibility_confirmed_at=null,
    equipment_responsibility_confirmed_by=null where id=p_job_id;
  return 1;
end;
$function$;


CREATE OR REPLACE FUNCTION public.set_job_worker_assignment(p_job_id uuid, p_assignment_kind text, p_employee_id uuid DEFAULT NULL::uuid, p_crew_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.jobs; e public.employees; c public.crews; team jsonb:='[]'::jsonb; next_status text;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Only management may assign Jobs.' using errcode='42501'; end if;
  if p_assignment_kind not in ('unassigned','individual','crew') then raise exception 'Invalid Job assignment target.'; end if;
  if (p_assignment_kind='individual' and (p_employee_id is null or p_crew_id is not null))
    or (p_assignment_kind='crew' and (p_crew_id is null or p_employee_id is not null))
    or (p_assignment_kind='unassigned' and (p_employee_id is not null or p_crew_id is not null)) then
    raise exception 'A Job must target one individual Tech, one Crew, or nobody.'; end if;
  select * into j from public.jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if j.archived_at is not null or j.status in ('In Progress','Completed','Cancelled','Archived') then
    raise exception 'Assignment cannot change after a Job is in progress or terminal.'; end if;
  if p_assignment_kind='individual' then
    select * into e from public.employees where id=p_employee_id and public.is_eligible_job_tech(id);
    if not found then raise exception 'Select an active Scrub Technician or Crew Lead with an active user profile.'; end if;
  elsif p_assignment_kind='crew' then
    select * into c from public.crews where id=p_crew_id and status='Active' and archived_at is null;
    if not found then raise exception 'Select an active Crew.'; end if;
    team:='[]'::jsonb;
  end if;
  next_status:=case when j.scheduled_date is null then 'Ready to Schedule'
    when p_assignment_kind='unassigned' then 'Scheduled' else 'Crew Assigned' end;
  update public.jobs set
    assigned_employee_id=case when p_assignment_kind='individual' then e.id end,
    assigned_employee_name=case when p_assignment_kind='individual' then coalesce(nullif(btrim(e.preferred_name),''),btrim(e.first_name||' '||e.last_name)) end,
    assigned_crew_id=case when p_assignment_kind='crew' then c.id end,
    assigned_crew_name=case when p_assignment_kind='crew' then c.crew_name end,
    crew_lead_name=case when p_assignment_kind='crew' then (select coalesce(nullif(btrim(x.preferred_name),''),btrim(x.first_name||' '||x.last_name)) from public.employees x where x.id=c.crew_lead_id) end,
    assigned_team=case when p_assignment_kind='crew' then team else '[]'::jsonb end,
    status=next_status where id=j.id returning * into j;
  return to_jsonb(j);
end $function$;



CREATE OR REPLACE FUNCTION public.start_operational_job_with_presence_before_equipment(p_job_id uuid, p_presence jsonb)
 RETURNS jobs_operational_safe
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    from public.job_crew_technicians member
    where member.job_id=j.id

    union

    select crew.crew_lead_id
    from public.crews crew
    where crew.id = j.assigned_crew_id
      and crew.crew_lead_id is not null
  ) roster
  join public.employees employee
    on employee.id = roster.employee_id
  where (private.employee_has_operational_role(employee.id, 'Scrub Technician') or employee.id=j.assigned_crew_lead_id)
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
$function$;


CREATE OR REPLACE FUNCTION public.update_operational_job(p_job_id uuid, p_scheduled_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_estimated_duration numeric DEFAULT NULL::numeric, p_assigned_crew_id uuid DEFAULT NULL::uuid, p_internal_notes text DEFAULT NULL::text, p_status text DEFAULT NULL::text)
 RETURNS jobs_operational_safe
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.jobs; safe public.jobs_operational_safe; crew public.crews; team jsonb;
begin
  if p_status in ('In Progress','Completed') then
    if p_scheduled_date is not null or p_start_time is not null or p_estimated_duration is not null
      or p_assigned_crew_id is not null or p_internal_notes is not null then
      raise exception 'Start or complete a Job separately from other operational edits.';
    end if;
    if p_status='In Progress' then return public.start_operational_job(p_job_id); end if;
    return public.complete_in_progress_job(p_job_id);
  end if;
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Job operation not permitted.' using errcode='42501';
  end if;
  select * into j from public.jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') then
    raise exception 'Terminal or archived Jobs cannot be operationally edited.';
  end if;
  if p_status is not null and p_status not in ('Ready to Schedule','Scheduled','Crew Assigned','Cancelled') then
    raise exception 'Invalid operational status.';
  end if;
  if p_assigned_crew_id is not null then
    if j.assigned_employee_id is not null then
      raise exception 'Use the Job assignment control to change an individual assignment.';
    end if;
    select * into crew from public.crews where id=p_assigned_crew_id and status='Active' and archived_at is null;
    if not found then raise exception 'Active crew not found.'; end if;
    team:='[]'::jsonb;
  end if;
  update public.jobs set scheduled_date=coalesce(p_scheduled_date,scheduled_date),start_time=coalesce(p_start_time,start_time),
    estimated_duration=coalesce(p_estimated_duration,estimated_duration),internal_notes=coalesce(p_internal_notes,internal_notes),
    status=coalesce(p_status,status),completed_at=case when p_status is not null then null else completed_at end,
    assigned_crew_id=coalesce(p_assigned_crew_id,assigned_crew_id),
    assigned_crew_name=case when p_assigned_crew_id is null then assigned_crew_name else crew.crew_name end,
    crew_lead_name=case when p_assigned_crew_id is null then crew_lead_name else (select coalesce(nullif(btrim(e.preferred_name),''),btrim(e.first_name||' '||e.last_name)) from public.employees e where e.id=crew.crew_lead_id) end,
    assigned_team=case when p_assigned_crew_id is null then assigned_team else team end
  where id=j.id;
  select * into safe from public.jobs_operational_safe where id=j.id; return safe;
end $function$;



CREATE OR REPLACE FUNCTION public.get_eligible_job_tech_options()
 RETURNS TABLE(employee_id uuid, display_name text, operational_role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    e.id,
    coalesce(
      nullif(btrim(e.preferred_name), ''),
      nullif(btrim(e.first_name || ' ' || e.last_name), ''),
      e.employee_number
    ),
    'Scrub Technician'::text
  from public.employees e
  where (select auth.uid()) is not null
    and public.has_any_role(
      array['Master Admin', 'Administrator', 'Manager', 'Sales', 'Crew Lead']
    )
    and e.employment_status = 'Active'
    and e.archived_at is null
    and private.employee_has_operational_role(e.id, 'Scrub Technician')
  order by 2, e.id;
$function$;



create or replace function public.set_job_crew_technicians(
  p_job_id uuid, p_employee_ids uuid[]
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  j public.jobs;
  c public.crews;
  v_lead uuid := public.current_employee_id();
  v_ids uuid[];
begin
  if auth.uid() is null or v_lead is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into j from public.jobs where id = p_job_id for update;
  if not found or j.assigned_crew_id is null or j.archived_at is not null
     or j.status not in ('Ready to Schedule','Scheduled','Crew Assigned') then
    raise exception 'An assigned, not-yet-started crew job is required.';
  end if;
  select * into c from public.crews where id = j.assigned_crew_id
    and status = 'Active' and archived_at is null;
  if not found or c.crew_lead_id is distinct from v_lead
     or not public.has_any_role(array['Crew Lead','Manager','Administrator','Master Admin']) then
    raise exception 'Only this job''s assigned Crew Lead may select technicians.'
      using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids
  from unnest(coalesce(p_employee_ids, '{}'::uuid[])) x;
  if array_position(v_ids, null) is not null
     or cardinality(v_ids) <> cardinality(coalesce(p_employee_ids, '{}'::uuid[]))
     or cardinality(v_ids) > c.technician_capacity
     or c.crew_lead_id = any(v_ids) then
    raise exception 'Invalid crew technician selection or capacity exceeded.';
  end if;
  if exists (
    select 1 from unnest(v_ids) x
    where not public.is_eligible_job_tech(x)
      or not private.employee_has_operational_role(x,'Scrub Technician')
  ) then
    raise exception 'Only active eligible technicians can be assigned.';
  end if;
  delete from public.job_crew_technicians where job_id = p_job_id and not (employee_id=any(v_ids));
  insert into public.job_crew_technicians(job_id, crew_id, employee_id, assigned_by_employee_id)
  select p_job_id, c.id, x, v_lead from unnest(v_ids) x on conflict(job_id,employee_id) do nothing;
  update public.jobs set assigned_team=(select coalesce(jsonb_agg(coalesce(nullif(e.preferred_name,''),e.first_name||' '||e.last_name) order by e.id),'[]'::jsonb) from public.employees e where e.id=any(v_ids)) where id=p_job_id;
  return cardinality(v_ids);
end $$;
revoke all on function public.set_job_crew_technicians(uuid,uuid[])
  from public,anon,authenticated;
grant execute on function public.set_job_crew_technicians(uuid,uuid[])
  to authenticated;
create or replace function public.set_operational_crew_capacity(
  p_crew_id uuid, p_capacity integer
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Crew management permission denied.' using errcode = '42501';
  end if;
  if p_capacity is null or p_capacity < 0 or p_capacity > 50 then
    raise exception 'Technician slots must be between 0 and 50.';
  end if;
  update public.crews set technician_capacity = p_capacity where id = p_crew_id;
  if not found then raise exception 'Crew not found.'; end if;
end $$;
revoke all on function public.set_operational_crew_capacity(uuid,integer)
  from public,anon,authenticated;
grant execute on function public.set_operational_crew_capacity(uuid,integer)
  to authenticated;
create or replace function public.get_job_crew_technicians(p_job_id uuid)
returns table(employee_id uuid)
language sql stable security definer set search_path = ''
as $$
  select t.employee_id
  from public.job_crew_technicians t
  join public.jobs j on j.id=t.job_id and j.assigned_crew_id=t.crew_id
  where t.job_id=p_job_id
    and auth.uid() is not null
    and public.can_access_job(p_job_id)
  order by t.assigned_at,t.employee_id
$$;
revoke all on function public.get_job_crew_technicians(uuid)
  from public,anon,authenticated;
grant execute on function public.get_job_crew_technicians(uuid) to authenticated;
notify pgrst, 'reload schema';


-- Snapshot actual historical participation; never infer participation from permanent membership.
insert into public.job_crew_technicians(job_id,crew_id,employee_id,assigned_by_employee_id)
select distinct j.id,j.assigned_crew_id,t.employee_id,coalesce(j.assigned_crew_lead_id,t.employee_id)
from public.jobs j join (
 select job_id,employee_id from public.time_entries where job_id is not null and employee_id is not null
 union select job_id,employee_id from public.job_crew_presence
) t on t.job_id=j.id
where j.assigned_crew_id is not null and t.employee_id is distinct from j.assigned_crew_lead_id
on conflict do nothing;

create table public.job_assignment_events (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.jobs(id) on delete restrict deferrable initially deferred,
 recipient_user_id uuid not null references public.user_profiles(id) on delete restrict,
 event_type text not null check(event_type in ('Assigned','Changed','Removed','Cancelled')),
 job_number text not null, scheduled_date date, start_time time,
 assignment_label text not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.job_assignment_events enable row level security;
revoke all on public.job_assignment_events from public,anon,authenticated;
grant select on public.job_assignment_events to authenticated;
grant all on public.job_assignment_events to service_role;
create policy job_assignment_events_recipient on public.job_assignment_events for select to authenticated using(recipient_user_id=(select auth.uid()));
create index job_assignment_events_recipient_idx on public.job_assignment_events(recipient_user_id,created_at desc);

create function private.notify_job_assignment(p_job public.jobs,p_employee uuid,p_event text,p_label text)
returns void language sql security definer set search_path='' as $$
 insert into public.job_assignment_events(job_id,recipient_user_id,event_type,job_number,scheduled_date,start_time,assignment_label)
 select p_job.id,u.id,p_event,p_job.job_number,p_job.scheduled_date,p_job.start_time,p_label
 from public.user_profiles u where u.employee_id=p_employee and u.is_active;
$$;
revoke all on function private.notify_job_assignment(public.jobs,uuid,text,text) from public,anon,authenticated;

create function private.guard_job_roster()
returns trigger language plpgsql security definer set search_path='' as $$
declare j public.jobs; c public.crews; target uuid; begin
 select * into j from public.jobs where id=coalesce(new.job_id,old.job_id) for update;
 if j.status not in ('Ready to Schedule','Scheduled','Crew Assigned') or j.operational_started_at is not null then
  raise exception 'Job roster is locked after job start or cancellation.' using errcode='42501';
 end if;
 if tg_op='DELETE' then
  perform private.notify_job_assignment(j,old.employee_id,'Removed','Technician');
  return old;
 end if;
 select * into c from public.crews where id=j.assigned_crew_id for update;
 if new.crew_id is distinct from j.assigned_crew_id or c.status<>'Active' or c.archived_at is not null
  or c.crew_lead_id=new.employee_id or not public.is_eligible_job_tech(new.employee_id) then
  raise exception 'Invalid job technician assignment.';
 end if;
 if (select count(*) from public.job_crew_technicians where job_id=j.id and employee_id<>new.employee_id)>=c.technician_capacity then
  raise exception 'Technician capacity exceeded.';
 end if;
 if tg_op='INSERT' and not exists(select 1 from public.job_crew_technicians where job_id=j.id and employee_id=new.employee_id) then
  perform private.notify_job_assignment(j,new.employee_id,'Assigned','Technician');
 end if;
 return new;
end $$;
revoke all on function private.guard_job_roster() from public,anon,authenticated;
create trigger guard_job_roster before insert or update or delete on public.job_crew_technicians
for each row execute function private.guard_job_roster();

create function private.guard_job_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
declare c public.crews; target uuid; event text; begin
 if tg_op='UPDATE' and (new.assigned_crew_id is distinct from old.assigned_crew_id or new.assigned_employee_id is distinct from old.assigned_employee_id)
 then
  if old.operational_started_at is not null or old.status in ('In Progress','Completed','Archived') then
   raise exception 'Assignment is locked after job start.';
  end if;
  -- Clear the prior job roster while the old assignment is still current.
  delete from public.job_crew_technicians where job_id=old.id;
  perform private.notify_job_assignment(old,coalesce(old.assigned_employee_id,old.assigned_crew_lead_id),'Removed',case when old.assigned_employee_id is null then 'Crew Lead' else 'Technician' end);
 end if;
 if new.assigned_crew_id is not null then
  select * into c from public.crews where id=new.assigned_crew_id for update;
  if tg_op='INSERT' or new.assigned_crew_id is distinct from old.assigned_crew_id then
   if c.status<>'Active' or c.archived_at is not null or c.crew_lead_id is null then raise exception 'Select an active crew with an assigned Crew Lead.'; end if;
   new.assigned_crew_lead_id:=c.crew_lead_id;
   new.assigned_team:='[]'::jsonb;
  end if;
 else new.assigned_crew_lead_id:=null;
 end if;
 if tg_op='UPDATE' and new.assigned_crew_id=old.assigned_crew_id and new.assigned_crew_lead_id is distinct from old.assigned_crew_lead_id then
  if old.operational_started_at is not null or old.status not in ('Ready to Schedule','Scheduled','Crew Assigned') or new.assigned_crew_lead_id is distinct from c.crew_lead_id then
   raise exception 'Historical and active job Crew Lead snapshots are immutable.';
  end if;
  delete from public.job_crew_technicians where job_id=old.id and employee_id=new.assigned_crew_lead_id;
  perform private.notify_job_assignment(old,old.assigned_crew_lead_id,'Removed','Crew Lead');
  perform private.notify_job_assignment(new,new.assigned_crew_lead_id,'Assigned','Crew Lead');
 end if;
 if tg_op='INSERT' or new.assigned_crew_id is distinct from old.assigned_crew_id or new.assigned_employee_id is distinct from old.assigned_employee_id then
  perform private.notify_job_assignment(new,coalesce(new.assigned_employee_id,new.assigned_crew_lead_id),'Assigned',case when new.assigned_employee_id is null then 'Crew Lead' else 'Technician' end);
 elsif (new.scheduled_date,new.start_time,new.estimated_duration,new.status,new.access_instructions,new.internal_notes)
  is distinct from (old.scheduled_date,old.start_time,old.estimated_duration,old.status,old.access_instructions,old.internal_notes)
  and (new.status='Cancelled' or old.status='Cancelled' or (new.scheduled_date,new.start_time,new.estimated_duration,new.access_instructions,new.internal_notes) is distinct from (old.scheduled_date,old.start_time,old.estimated_duration,old.access_instructions,old.internal_notes)) then
  event:=case when new.status='Cancelled' then 'Cancelled' else 'Changed' end;
  perform private.notify_job_assignment(new,coalesce(new.assigned_employee_id,new.assigned_crew_lead_id),event,case when new.assigned_employee_id is null then 'Crew Lead' else 'Technician' end);
  for target in select employee_id from public.job_crew_technicians where job_id=new.id loop
   perform private.notify_job_assignment(new,target,event,'Technician');
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.guard_job_assignment() from public,anon,authenticated;
create trigger job_specific_assignment_guard before insert or update on public.jobs
for each row execute function private.guard_job_assignment();

create function private.guard_job_payroll_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.job_id is not null then
  perform 1 from public.jobs where id=new.job_id for update;
  if tg_op='INSERT' or (new.job_id,new.employee_id,new.crew_id) is distinct from (old.job_id,old.employee_id,old.crew_id) then
   if not private.job_employee_assigned(new.job_id,new.employee_id) then
    raise exception 'Only employees assigned to this job may record job time.' using errcode='42501';
   end if;
   if new.crew_id is distinct from (select assigned_crew_id from public.jobs where id=new.job_id) then raise exception 'Job and crew do not match.'; end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_job_payroll_assignment() from public,anon,authenticated;
create trigger job_payroll_assignment_guard before insert or update on public.time_entries
for each row execute function private.guard_job_payroll_assignment();

create function private.guard_crew_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare dep record; referenced boolean; begin
 if tg_op='DELETE' or (new.status,new.archived_at) is distinct from (old.status,old.archived_at) then
  if exists(select 1 from public.jobs where assigned_crew_id=old.id and archived_at is null and status not in ('Completed','Cancelled','Archived')) then
   raise exception 'Resolve upcoming or active job assignments before archiving or deleting this crew.';
  end if;
 end if;
 if tg_op<>'DELETE' then
  if tg_op='UPDATE' and new.crew_lead_id is distinct from old.crew_lead_id and exists(select 1 from public.jobs where assigned_crew_id=old.id and status='In Progress') then
   raise exception 'Crew Lead cannot change while a job is in progress.';
  end if;
  if new.crew_lead_id is null and exists(select 1 from public.jobs where assigned_crew_id=old.id and archived_at is null and status in ('Ready to Schedule','Scheduled','Crew Assigned')) then
   raise exception 'Assigned upcoming jobs require a Crew Lead.';
  end if;
  if new.technician_capacity < (select coalesce(max(n),0) from (select count(*) n from public.job_crew_technicians t join public.jobs j on j.id=t.job_id where t.crew_id=old.id and j.status in ('Ready to Schedule','Scheduled','Crew Assigned','In Progress') group by t.job_id) x) then
   raise exception 'Capacity cannot be below a current job roster size.';
  end if;
  if new.crew_lead_id is not null and not exists(select 1 from public.employees e join public.user_profiles u on u.employee_id=e.id and u.is_active where e.id=new.crew_lead_id and e.employment_status='Active' and e.archived_at is null and u.role in ('Master Admin','Administrator','Manager','Crew Lead')) then
   raise exception 'Select an active Crew Lead with an authorized user profile.';
  end if;
  return new;
 end if;
 -- All references are checked, including equipment, payroll, occurrences, and agreements.
 for dep in select con.conrelid::regclass rel,a.attname col
  from pg_constraint con join pg_attribute a on a.attrelid=con.conrelid and a.attnum=con.conkey[1]
  where con.contype='f' and con.confrelid='public.crews'::regclass loop
  execute format('select exists(select 1 from %s where %I=$1)',dep.rel,dep.col) into referenced using old.id;
  if referenced then raise exception 'Crew has historical or dependent records. Archive it instead.'; end if;
 end loop;
 return old;
end $$;
revoke all on function private.guard_crew_lifecycle() from public,anon,authenticated;
create trigger guard_crew_lifecycle before insert or update or delete on public.crews for each row execute function private.guard_crew_lifecycle();

create function public.delete_operational_crew(p_crew_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Crew management permission denied.' using errcode='42501'; end if;
 perform 1 from public.crews where id=p_crew_id for update;
 if not found then raise exception 'Crew not found.'; end if;
 delete from public.crews where id=p_crew_id;
end $$;
revoke all on function public.delete_operational_crew(uuid) from public,anon;
grant execute on function public.delete_operational_crew(uuid) to authenticated;
grant select on public.job_crew_technicians to authenticated;
grant all on public.job_crew_technicians to service_role;
create policy job_crew_roster_read on public.job_crew_technicians for select to authenticated using(public.can_access_job(job_id));

-- Use the existing jobs/Attention refresh path for roster changes too.
create function private.job_roster_refresh()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if pg_trigger_depth()=1 then
  update public.jobs set updated_at=clock_timestamp() where id=coalesce(new.job_id,old.job_id);
 end if;
 return coalesce(new,old);
end $$;
revoke all on function private.job_roster_refresh() from public,anon,authenticated;
create trigger job_roster_refresh after insert or delete on public.job_crew_technicians for each row execute function private.job_roster_refresh();
notify pgrst,'reload schema';


create function public.get_visible_job_roster(p_job_ids uuid[])
returns table(job_id uuid,employee_id uuid,display_name text,operational_role text)
language sql stable security definer set search_path='' as $$
 select t.job_id,e.id,coalesce(nullif(btrim(e.preferred_name),''),btrim(e.first_name||' '||e.last_name)),'Scrub Technician'::text
 from public.job_crew_technicians t join public.employees e on e.id=t.employee_id
 where t.job_id=any(p_job_ids) and public.can_access_job(t.job_id) order by t.job_id,3,e.id;
$$;
revoke all on function public.get_visible_job_roster(uuid[]) from public,anon;
grant execute on function public.get_visible_job_roster(uuid[]) to authenticated;
-- Avoid exposing payroll-opening or preflight-bypassing internal helpers as RPCs.
revoke all on function public.open_job_payroll_entry(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.start_operational_job_with_presence_before_equipment(uuid,jsonb) from public,anon,authenticated;


-- Authorized directory writes are atomic, including technician capacity and restore.
create or replace function public.manage_operational_crew(
 p_crew_id uuid,p_crew_name text,p_crew_lead_id uuid,p_status text,p_notes text,p_archive boolean,p_technician_capacity integer
) returns public.crew_directory_safe language plpgsql security definer set search_path='' as $$
declare c public.crews; result public.crew_directory_safe; begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Crew management permission denied.' using errcode='42501'; end if;
 if nullif(btrim(p_crew_name),'') is null or p_status not in ('Active','Inactive','Archived') or p_technician_capacity is null or p_technician_capacity not between 0 and 50 then raise exception 'Enter a crew name, valid status, and technician capacity between 0 and 50.'; end if;
 if p_crew_id is null then
  insert into public.crews(crew_name,crew_lead_id,status,notes,technician_capacity,archived_at)
  values(btrim(p_crew_name),p_crew_lead_id,p_status,p_notes,p_technician_capacity,case when p_status='Archived' then now() end) returning * into c;
 else
  update public.crews set crew_name=btrim(p_crew_name),crew_lead_id=p_crew_lead_id,
   status=case when p_archive then 'Archived' else p_status end,notes=p_notes,technician_capacity=p_technician_capacity,
   archived_at=case when p_archive or p_status='Archived' then coalesce(archived_at,now()) else null end
  where id=p_crew_id returning * into c;
  if not found then raise exception 'Crew not found.'; end if;
 end if;
 select * into result from public.crew_directory_safe where id=c.id;
 return result;
end $$;
revoke all on function public.manage_operational_crew(uuid,text,uuid,text,text,boolean,integer) from public,anon;
grant execute on function public.manage_operational_crew(uuid,text,uuid,text,text,boolean,integer) to authenticated;
-- Table changes must refresh the existing realtime Attention subscriptions.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.job_assignment_events,public.job_crew_technicians;
 end if;
end $$;


create function private.sync_planned_job_crew_lead()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.crew_lead_id is distinct from old.crew_lead_id then
  update public.jobs set assigned_crew_lead_id=new.crew_lead_id,
   crew_lead_name=(select coalesce(nullif(btrim(e.preferred_name),''),btrim(e.first_name||' '||e.last_name)) from public.employees e where e.id=new.crew_lead_id)
  where assigned_crew_id=new.id and archived_at is null and status in ('Ready to Schedule','Scheduled','Crew Assigned') and operational_started_at is null;
 end if;
 return new;
end $$;
revoke all on function private.sync_planned_job_crew_lead() from public,anon,authenticated;
create trigger sync_planned_job_crew_lead after update of crew_lead_id on public.crews for each row execute function private.sync_planned_job_crew_lead();

-- Attendance must use the same roster as payroll, including all legacy attendance RPCs.
create trigger job_attendance_assignment_guard before insert or update on public.job_crew_presence
for each row execute function private.guard_job_payroll_assignment();

CREATE OR REPLACE FUNCTION private.reconcile_job_equipment_responsibility_task(p_job_id uuid, p_assigned_crew_id uuid, p_actor_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  j public.jobs; t public.job_equipment_responsibility_tasks; lead_id uuid;
  a public.job_equipment_assignments; changed boolean; previous uuid;
begin
  select * into j from public.jobs where id=p_job_id for update;
  if not found or j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') then return; end if;
  if p_assigned_crew_id is distinct from j.assigned_crew_id then raise exception 'Crew assignment changed; reload the job.'; end if;
  select c.crew_lead_id into lead_id from public.crews c join public.employees e on e.id=c.crew_lead_id
    where c.id=j.assigned_crew_id and c.status='Active' and c.archived_at is null
      and e.archived_at is null and e.employment_status='Active';
  select * into t from public.job_equipment_responsibility_tasks where job_id=p_job_id for update;
  if not found then
    if lead_id is null then return; end if;
    insert into public.job_equipment_responsibility_tasks(job_id,crew_id,crew_lead_employee_id)
      values(p_job_id,j.assigned_crew_id,lead_id) returning * into t;
  end if;
  previous:=t.responsible_employee_id;
  changed:=t.crew_id is distinct from j.assigned_crew_id or t.crew_lead_employee_id is distinct from lead_id
    or t.responsible_employee_id is distinct from lead_id
    or exists(select 1 from public.job_equipment_assignments x where x.job_id=p_job_id and x.released_at is null and x.employee_id is distinct from lead_id)
    or (lead_id is not null and not exists(select 1 from public.job_equipment_assignments x where x.job_id=p_job_id and x.released_at is null and x.employee_id=lead_id));
  if not changed then return; end if;
  if exists(select 1 from public.job_equipment_handoffs h where h.job_id=p_job_id and h.acknowledged_at is null)
    or exists(select 1 from public.job_equipment_assignments x where x.job_id=p_job_id and x.released_at is null and x.employee_id is distinct from lead_id
      and (exists(select 1 from public.job_equipment_clearances cl where cl.assignment_id=x.id and cl.status<>'Cleared')
        or (j.status='In Progress' and not exists(select 1 from public.job_equipment_clearances cl where cl.assignment_id=x.id and cl.checkpoint='End Job' and cl.status='Cleared')))) then
    raise exception 'Resolve pending equipment clearance or handoff before changing Crew Lead responsibility.';
  end if;
  for a in select * from public.job_equipment_assignments where job_id=p_job_id and released_at is null and employee_id is distinct from lead_id for update loop
    update public.job_equipment_assignments set released_at=greatest(clock_timestamp(),assigned_at),released_by_user_id=p_actor_user_id,
      release_reason='Assigned Crew Lead policy reconciliation' where id=a.id;
    insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details)
      values(a.id,'Released',p_actor_user_id,jsonb_build_object('reason','Assigned Crew Lead policy reconciliation','system',p_actor_user_id is null));
  end loop;
  if lead_id is not null and not exists(select 1 from public.job_equipment_assignments where job_id=p_job_id and employee_id=lead_id and released_at is null) then
    insert into public.job_equipment_assignments(job_id,employee_id,assigned_by_user_id,assigned_at) values(p_job_id,lead_id,p_actor_user_id,clock_timestamp()) returning * into a;
    insert into public.job_equipment_assignment_audit(assignment_id,action,actor_user_id,details)
      values(a.id,'Assigned',p_actor_user_id,jsonb_build_object('reason','Assigned Crew Lead policy reconciliation','system',p_actor_user_id is null));
  end if;
  update public.job_equipment_responsibility_tasks set crew_id=j.assigned_crew_id,crew_lead_employee_id=lead_id,
    responsible_employee_id=lead_id,status=case when lead_id is null then 'Pending Assignment' else 'Assigned' end,
    assigned_at=case when lead_id is null then null else now() end,revision=revision+1,updated_at=now()
    where id=t.id returning * into t;
  update public.jobs set equipment_responsibility_confirmed_at=null,equipment_responsibility_confirmed_by=null where id=p_job_id;
  insert into public.job_equipment_responsibility_events(task_id,job_id,revision,event_type,crew_id,crew_lead_employee_id,responsible_employee_id,actor_user_id,reason)
    values(t.id,p_job_id,t.revision,case when lead_id is null then 'Crew Removed' when previous is null then 'Assigned' else 'Reassigned' end,
      t.crew_id,lead_id,lead_id,p_actor_user_id,'Assigned Crew Lead policy reconciliation; confirmation required');
end; $function$;

CREATE OR REPLACE FUNCTION private.sync_crew_equipment_responsibility_tasks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare affected_job record;
begin
  if new.crew_lead_id is not distinct from old.crew_lead_id
    and new.status is not distinct from old.status
    and new.archived_at is not distinct from old.archived_at then
    return new;
  end if;
  for affected_job in
    select j.id,j.assigned_crew_id from public.jobs j
    where j.assigned_crew_id=new.id and j.archived_at is null and j.status in ('Ready to Schedule','Scheduled','Crew Assigned')
  loop
    perform private.reconcile_job_equipment_responsibility_task(
      affected_job.id,affected_job.assigned_crew_id,auth.uid()
    );
  end loop;
  return new;
end; $function$;
create or replace function public.manage_operational_crew(p_crew_id uuid,p_crew_name text,p_crew_lead_id uuid,p_status text,p_notes text,p_archive boolean default false)
returns public.crew_directory_safe language plpgsql security definer set search_path='' as $$
begin
 return public.manage_operational_crew(p_crew_id,p_crew_name,p_crew_lead_id,p_status,p_notes,p_archive,
  coalesce((select technician_capacity from public.crews where id=p_crew_id),4));
end $$;
