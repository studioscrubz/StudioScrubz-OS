-- Workforce Phase 2: opt-in, one-shot job-site arrival verification.
-- No continuous tracking, payroll mutation, or job-start enforcement in V1.
-- Runner owns transaction boundaries; do not add BEGIN/COMMIT.
create table public.jobsite_geofence_settings (
  property_id uuid primary key references public.properties(id) on delete restrict,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_meters integer not null default 250 check (radius_meters between 100 and 500),
  enabled boolean not null default true,
  updated_by uuid not null references public.user_profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.jobsite_arrival_checks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  checked_by uuid not null references public.user_profiles(id) on delete restrict,
  checked_at timestamptz not null default now(),
  reported_accuracy_meters double precision not null check (reported_accuracy_meters between 0 and 100),
  distance_meters double precision not null check (distance_meters >= 0),
  radius_meters integer not null check (radius_meters between 100 and 500),
  result text not null check (result in ('Within Radius','Outside Radius'))
);
create index jobsite_arrival_checks_job_idx on public.jobsite_arrival_checks(job_id,checked_at desc);

create table public.jobsite_arrival_exceptions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  approved_by uuid not null references public.user_profiles(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 15 and 2000),
  approved_at timestamptz not null default now()
);
create index jobsite_arrival_exceptions_job_idx on public.jobsite_arrival_exceptions(job_id,approved_at desc);

alter table public.jobsite_geofence_settings enable row level security;
alter table public.jobsite_arrival_checks enable row level security;
alter table public.jobsite_arrival_exceptions enable row level security;
revoke all on public.jobsite_geofence_settings,public.jobsite_arrival_checks,public.jobsite_arrival_exceptions from public,anon,authenticated;
grant select,insert,update on public.jobsite_geofence_settings to service_role;
grant select,insert on public.jobsite_arrival_checks to service_role;
grant select,insert on public.jobsite_arrival_exceptions to service_role;

create function private.jobsite_manager(p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p
  where p.id=p_actor and p.is_active
    and p.role in ('Master Admin','Administrator','Manager'))
$$;
create function private.jobsite_employee_authorized(p_job public.jobs,p_employee uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_job.assigned_employee_id=p_employee or (
    p_job.assigned_crew_id is not null and (
       exists(select 1 from public.crews c where c.id=p_job.assigned_crew_id and c.crew_lead_id=p_employee)
       or exists(select 1 from public.crew_members cm where cm.crew_id=p_job.assigned_crew_id and cm.employee_id=p_employee)
    )
 )
$$;
create function private.jobsite_validate_position(p_position jsonb)
returns void language plpgsql stable set search_path='' as $$
declare lat double precision; lon double precision; accuracy double precision; captured timestamptz;
begin
 if p_position is null or jsonb_typeof(p_position)<>'object' then
  raise exception 'Current GPS position is required.';
 end if;
 begin
  lat:=(p_position->>'latitude')::double precision;
  lon:=(p_position->>'longitude')::double precision;
  accuracy:=(p_position->>'accuracy')::double precision;
  captured:=(p_position->>'capturedAt')::timestamptz;
 exception when others then raise exception 'Invalid GPS coordinates or timestamp.'; end;
 if lat is null or lon is null or accuracy is null or captured is null or
   lat not between -90 and 90 or lon not between -180 and 180 or
   accuracy<0 or accuracy>100 or
   captured<now()-interval '60 seconds' or captured>now()+interval '10 seconds' then
  raise exception 'GPS must be recent and accurate within 100 meters.';
 end if;
end $$;

create function public.set_jobsite_geofence(p_property_id uuid,p_position jsonb,p_radius_meters integer default 250)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); saved public.jobsite_geofence_settings;
begin
 if not private.jobsite_manager(actor) then raise exception 'Management permission required.' using errcode='42501'; end if;
 perform private.jobsite_validate_position(p_position);
 if p_radius_meters is null or p_radius_meters not between 100 and 500 then raise exception 'Radius must be between 100 and 500 meters.'; end if;
 if not exists(select 1 from public.properties pr where pr.id=p_property_id and pr.archived_at is null) then
   raise exception 'Active property not found.';
 end if;
 insert into public.jobsite_geofence_settings(property_id,latitude,longitude,radius_meters,updated_by)
 values(p_property_id,(p_position->>'latitude')::double precision,(p_position->>'longitude')::double precision,p_radius_meters,actor)
 on conflict(property_id) do update set
  latitude=excluded.latitude,longitude=excluded.longitude,
  radius_meters=excluded.radius_meters,enabled=true,updated_by=actor,updated_at=now()
 returning * into saved;
 return jsonb_build_object('configured',true,'radiusMeters',saved.radius_meters,'updatedAt',saved.updated_at);
end $$;

create function public.get_jobsite_arrival_summary(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); employee uuid; job public.jobs;
 setting public.jobsite_geofence_settings; latest public.jobsite_arrival_checks; can_manage boolean;
begin
 select p.employee_id into employee from public.user_profiles p where p.id=actor and p.is_active;
 if not found then raise exception 'Active account required.' using errcode='42501'; end if;
 select * into job from public.jobs j where j.id=p_job_id and j.archived_at is null;
 if not found then raise exception 'Job not found.'; end if;
 can_manage:=private.jobsite_manager(actor);
 if not can_manage and (employee is null or not private.jobsite_employee_authorized(job,employee)) then
  raise exception 'Job access denied.' using errcode='42501';
 end if;
 select * into setting from public.jobsite_geofence_settings s where s.property_id=job.property_id and s.enabled;
 if employee is not null then
  select * into latest from public.jobsite_arrival_checks c
    where c.job_id=p_job_id and c.employee_id=employee
    order by c.checked_at desc,c.id desc limit 1;
 end if;
 return jsonb_build_object(
   'configured',setting.property_id is not null,
   'radiusMeters',setting.radius_meters,
   'lastCheck',case when latest.id is null then null else
    jsonb_build_object('result',latest.result,'checkedAt',latest.checked_at,
      'distanceMeters',round(latest.distance_meters::numeric,1),
      'accuracyMeters',latest.reported_accuracy_meters) end,
   'manager',can_manage,
   'employeeChecks',case when can_manage then (
     select coalesce(jsonb_agg(jsonb_build_object(
       'employeeId',c.employee_id,'result',c.result,'checkedAt',c.checked_at,
       'distanceMeters',round(c.distance_meters::numeric,1),'accuracyMeters',c.reported_accuracy_meters
     ) order by c.checked_at desc),'[]'::jsonb)
     from public.jobsite_arrival_checks c where c.job_id=p_job_id
   ) else '[]'::jsonb end,
   'exceptions',case when can_manage then (
     select coalesce(jsonb_agg(jsonb_build_object('employeeId',x.employee_id,'approvedAt',x.approved_at)
       order by x.approved_at desc),'[]'::jsonb)
     from public.jobsite_arrival_exceptions x where x.job_id=p_job_id
   ) else '[]'::jsonb end
 );
end $$;

create function public.verify_jobsite_arrival(p_job_id uuid,p_position jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); employee uuid; job public.jobs;
 setting public.jobsite_geofence_settings; dist double precision; verdict text; result public.jobsite_arrival_checks;
begin
 select p.employee_id into employee from public.user_profiles p join public.employees e on e.id=p.employee_id
  where p.id=actor and p.is_active and e.employment_status='Active' and e.archived_at is null;
 if employee is null then raise exception 'An active employee-linked account is required.' using errcode='42501'; end if;
 select * into job from public.jobs j where j.id=p_job_id and j.archived_at is null;
 if not found or job.status not in ('Scheduled','Crew Assigned','In Progress') then
  raise exception 'This Job is not eligible for arrival verification.';
 end if;
 if not private.jobsite_employee_authorized(job,employee) then raise exception 'You are not assigned to this Job.' using errcode='42501'; end if;
 select * into setting from public.jobsite_geofence_settings s where s.property_id=job.property_id and s.enabled;
 if setting.property_id is null then raise exception 'Management must configure the property GPS location before verification.'; end if;
 perform private.jobsite_validate_position(p_position);
 dist:=2*6371000*asin(sqrt(least(1.0,greatest(0.0,
   power(sin(radians(((p_position->>'latitude')::double precision-setting.latitude)/2)),2)+
   cos(radians(setting.latitude))*cos(radians((p_position->>'latitude')::double precision))*
   power(sin(radians(((p_position->>'longitude')::double precision-setting.longitude)/2)),2)
 ))));
 verdict:=case when dist<=setting.radius_meters then 'Within Radius' else 'Outside Radius' end;
 insert into public.jobsite_arrival_checks(job_id,employee_id,checked_by,reported_accuracy_meters,distance_meters,radius_meters,result)
 values(p_job_id,employee,actor,(p_position->>'accuracy')::double precision,dist,setting.radius_meters,verdict)
 returning * into result;
 return jsonb_build_object('result',result.result,'distanceMeters',round(result.distance_meters::numeric,1),
   'accuracyMeters',result.reported_accuracy_meters,'checkedAt',result.checked_at,
   'note','One-time GPS check only; this does not change payroll or automatically start the Job.');
end $$;

create function public.approve_jobsite_arrival_exception(p_job_id uuid,p_employee_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); job public.jobs; approved uuid;
begin
 if not private.jobsite_manager(actor) then raise exception 'Management permission required.' using errcode='42501'; end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 15 and 2000 then
  raise exception 'A reason of 15–2,000 characters is required.';
 end if;
 select * into job from public.jobs j where j.id=p_job_id and j.archived_at is null;
 if not found then raise exception 'Job not found.'; end if;
 if not private.jobsite_employee_authorized(job,p_employee_id) then
  raise exception 'The employee must be assigned to this Job.';
 end if;
 insert into public.jobsite_arrival_exceptions(job_id,employee_id,approved_by,reason)
 values(p_job_id,p_employee_id,actor,btrim(p_reason)) returning id into approved;
 return jsonb_build_object('exceptionId',approved,'approved',true);
end $$;

create function private.prevent_jobsite_evidence_changes()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Job-site GPS evidence and exceptions are append-only.'; end $;
create trigger jobsite_exceptions_immutable
before update or delete on public.jobsite_arrival_exceptions for each row execute function private.prevent_jobsite_evidence_changes();
create trigger jobsite_arrival_checks_immutable
before update or delete on public.jobsite_arrival_checks for each row execute function private.prevent_jobsite_evidence_changes();

revoke all on function private.jobsite_manager(uuid),private.jobsite_employee_authorized(public.jobs,uuid),
  private.jobsite_validate_position(jsonb),private.prevent_jobsite_evidence_changes() from public,anon,authenticated;
revoke all on function public.set_jobsite_geofence(uuid,jsonb,integer),
 public.get_jobsite_arrival_summary(uuid),public.verify_jobsite_arrival(uuid,jsonb),
 public.approve_jobsite_arrival_exception(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.set_jobsite_geofence(uuid,jsonb,integer),
 public.get_jobsite_arrival_summary(uuid),public.verify_jobsite_arrival(uuid,jsonb),
 public.approve_jobsite_arrival_exception(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
