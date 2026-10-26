-- Gate job start on a recent, successful GPS arrival by this job's assigned Crew Lead.
-- This does not change payroll or auto-clock-in mechanics after the existing start RPC executes.
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
 if not exists(select 1 from public.jobsite_geofence_settings s
   where s.property_id=v_property and s.enabled) then
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
revoke all on function private.require_job_start_gps(uuid) from public,anon,authenticated;

create or replace function public.start_operational_job(p_job_id uuid)
returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
begin
 perform private.require_job_start_gps(p_job_id);
 if not exists(select 1 from public.jobs where id=p_job_id
    and equipment_responsibility_confirmed_at is not null) then
  raise exception 'Crew Lead must assign and confirm an equipment custodian before starting.';
 end if;
 return public.start_operational_job_before_equipment(p_job_id);
end $$;

create or replace function public.start_operational_job_with_presence(p_job_id uuid,p_presence jsonb)
returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
begin
 perform private.require_job_start_gps(p_job_id);
 if not exists(select 1 from public.jobs where id=p_job_id
    and equipment_responsibility_confirmed_at is not null) then
  raise exception 'Crew Lead must assign and confirm an equipment custodian before starting.';
 end if;
 return public.start_operational_job_with_presence_before_equipment(p_job_id,p_presence);
end $$;
revoke all on function public.start_operational_job(uuid),public.start_operational_job_with_presence(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.start_operational_job(uuid),public.start_operational_job_with_presence(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
