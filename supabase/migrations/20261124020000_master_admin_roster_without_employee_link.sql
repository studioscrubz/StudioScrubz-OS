-- A Master Admin is authenticated by user profile, even when not linked to an employee.
-- Retain historic employee attribution; record actor auth user IDs for new assignments.
alter table public.job_crew_technicians
 add column if not exists assigned_by_user_id uuid;
alter table public.job_crew_technicians
 alter column assigned_by_employee_id drop not null;

create or replace function public.set_job_crew_technicians(p_job_id uuid, p_employee_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare
 j public.jobs;
 c public.crews;
 v_actor uuid := public.current_employee_id();
 v_is_master boolean := public.has_any_role(array['Master Admin']);
 v_ids uuid[];
begin
 if auth.uid() is null or (v_actor is null and not v_is_master) then
  raise exception 'Authentication required.' using errcode='42501';
 end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or j.assigned_crew_id is null or j.archived_at is not null
  or j.status not in ('Ready to Schedule','Scheduled','Crew Assigned') then
  raise exception 'An assigned, not-yet-started crew job is required.';
 end if;
 select * into c from public.crews where id=j.assigned_crew_id
  and status='Active' and archived_at is null;
 if not found or (not v_is_master and
  (c.crew_lead_id is distinct from v_actor
   or not public.has_any_role(array['Crew Lead','Manager','Administrator']))) then
  raise exception 'Only the assigned Crew Lead or Master Admin may select technicians.' using errcode='42501';
 end if;
 select coalesce(array_agg(distinct x),'{}'::uuid[]) into v_ids
 from unnest(coalesce(p_employee_ids,'{}'::uuid[])) x;
 if array_position(v_ids,null) is not null
  or cardinality(v_ids) <> cardinality(coalesce(p_employee_ids,'{}'::uuid[]))
  or cardinality(v_ids)>c.technician_capacity
  or c.crew_lead_id=any(v_ids) then
  raise exception 'Invalid crew technician selection or capacity exceeded.';
 end if;
 if exists (select 1 from unnest(v_ids) x
  where not public.is_eligible_job_tech(x)
   or not private.employee_has_operational_role(x,'Scrub Technician')) then
  raise exception 'Only active eligible technicians can be assigned.';
 end if;
 delete from public.job_crew_technicians
 where job_id=p_job_id and not (employee_id=any(v_ids));
 insert into public.job_crew_technicians(job_id,crew_id,employee_id,assigned_by_employee_id,assigned_by_user_id)
 select p_job_id,c.id,x,v_actor,auth.uid() from unnest(v_ids) x
 on conflict(job_id,employee_id) do nothing;
 update public.jobs set assigned_team=(
  select coalesce(jsonb_agg(coalesce(nullif(e.preferred_name,''),e.first_name||' '||e.last_name) order by e.id),'[]'::jsonb)
  from public.employees e where e.id=any(v_ids)
 ) where id=p_job_id;
 return cardinality(v_ids);
end $$;

