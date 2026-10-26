-- Assigned Crew Lead may register a missing GPS reference for their own active job's property.
-- Existing references are immutable through this entry point; management correction remains separate.
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
 perform private.jobsite_validate_position(p_position);
 if p_radius_meters is null or p_radius_meters not between 100 and 500 then raise exception 'Invalid GPS radius.'; end if;
 insert into public.jobsite_geofence_settings(property_id,latitude,longitude,radius_meters,updated_by)
 values(v_job.property_id,(p_position->>'latitude')::double precision,(p_position->>'longitude')::double precision,p_radius_meters,v_actor)
 on conflict(property_id) do nothing;
 if not found then raise exception 'Property GPS already registered. Contact management for corrections.'; end if;
 return jsonb_build_object('configured',true,'radiusMeters',p_radius_meters);
end $$;
revoke all on function public.register_job_property_gps_by_crew_lead(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.register_job_property_gps_by_crew_lead(uuid,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
