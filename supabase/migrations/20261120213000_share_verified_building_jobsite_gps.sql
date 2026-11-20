-- Resolve existing setup without copying coordinates to unit records.
create function private.resolve_jobsite_geofence(p_property_id uuid)
returns setof public.jobsite_geofence_settings
language sql stable set search_path='' as $$
 select settings.*
 from public.jobsite_geofence_settings settings
 join public.properties candidate on candidate.id=settings.property_id
 join public.properties target on target.id=p_property_id
 where settings.enabled and (
  candidate.id=target.id
  or (
   target.archived_at is null and candidate.archived_at is null
   and candidate.client_id=target.client_id
   and not exists (
    select 1 from public.jobsite_geofence_settings own
    where own.property_id=target.id
   )
   and nullif(lower(btrim(target.address)), '')=lower(btrim(candidate.address))
   and nullif(lower(btrim(target.city)), '')=lower(btrim(candidate.city))
   and nullif(lower(btrim(target.state)), '')=lower(btrim(candidate.state))
   and nullif(btrim(target.zip), '')=btrim(candidate.zip)
  )
 )
 order by (candidate.id=target.id) desc,settings.updated_at desc,candidate.id
 limit 1
$$;
revoke all on function private.resolve_jobsite_geofence(uuid) from public,anon,authenticated;

create or replace function public.get_jobsite_arrival_summary(p_job_id uuid)
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
 select * into setting from private.resolve_jobsite_geofence(job.property_id);
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

create or replace function public.verify_jobsite_arrival(p_job_id uuid,p_position jsonb)
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
 select * into setting from private.resolve_jobsite_geofence(job.property_id);
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

create or replace function private.require_job_start_gps(p_job_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_lead uuid; v_property uuid; v_check public.jobsite_arrival_checks;
begin
 select t.crew_lead_employee_id,j.property_id into v_lead,v_property
 from public.jobs j left join public.job_equipment_responsibility_tasks t on t.job_id=j.id
 where j.id=p_job_id and j.archived_at is null;
 if v_lead is null or v_property is null then
  raise exception 'Assigned Crew Lead and linked property are required before job start.';
 end if;
 if not exists(select 1 from private.resolve_jobsite_geofence(v_property)) then
  raise exception 'Property GPS must be registered before starting this job.';
 end if;
 select * into v_check from public.jobsite_arrival_checks c
 where c.job_id=p_job_id and c.employee_id=v_lead
 order by c.checked_at desc,c.id desc limit 1;
 if v_check.id is null or v_check.result<>'Within Radius'
    or v_check.checked_at < now()-interval '12 hours' then
  raise exception 'Assigned Crew Lead must verify arrival on-site using GPS before starting this job.';
 end if;
end $$;

create or replace function public.register_job_property_gps_by_crew_lead(
 p_job_id uuid,p_position jsonb,p_radius_meters integer default 250
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_employee uuid; v_job public.jobs; v_lead uuid;
begin
 select p.employee_id into v_employee from public.user_profiles p
 join public.employees e on e.id=p.employee_id
 where p.id=v_actor and p.is_active and e.archived_at is null and e.employment_status='Active';
 if v_employee is null then raise exception 'Active employee account required.' using errcode='42501'; end if;
 select * into v_job from public.jobs j where j.id=p_job_id and j.archived_at is null
 and j.status in ('Scheduled','Crew Assigned') for update;
 if not found then raise exception 'An active, unstarted assigned job is required.' using errcode='42501'; end if;
 select t.crew_lead_employee_id into v_lead from public.job_equipment_responsibility_tasks t
 where t.job_id=p_job_id and t.crew_id=v_job.assigned_crew_id;
 if v_lead is null or v_lead<>v_employee then
   raise exception 'Only this job''s assigned Crew Lead may register its property GPS.' using errcode='42501';
 end if;
 if v_job.property_id is null then raise exception 'Linked property required.'; end if;
 if not exists(select 1 from public.properties pr where pr.id=v_job.property_id and pr.archived_at is null)
 then raise exception 'Active property required.'; end if;
 if exists(select 1 from private.resolve_jobsite_geofence(v_job.property_id)) then
  raise exception 'Job-site GPS is already configured. Refresh and verify arrival.';
 end if;
 perform private.jobsite_validate_position(p_position);
 if p_radius_meters is null or p_radius_meters not between 100 and 500 then raise exception 'Invalid GPS radius.'; end if;
 insert into public.jobsite_geofence_settings(property_id,latitude,longitude,radius_meters,updated_by)
 values(v_job.property_id,(p_position->>'latitude')::double precision,(p_position->>'longitude')::double precision,p_radius_meters,v_actor)
 on conflict(property_id) do nothing;
 if not found then raise exception 'Property GPS already registered. Contact management for corrections.'; end if;
 return jsonb_build_object('configured',true,'radiusMeters',p_radius_meters);
end $$;
