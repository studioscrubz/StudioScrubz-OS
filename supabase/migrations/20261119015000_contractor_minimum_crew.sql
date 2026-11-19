-- Company staffing requirements apply to direct, imported, and recurring jobs.
alter table public.contractor_companies add column minimum_crew_size integer not null default 1
  check (minimum_crew_size between 1 and 100);
update public.contractor_companies set minimum_crew_size=2
where lower(btrim(name))='lj facility services llc';

create function private.protect_contractor_minimum_crew()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.minimum_crew_size is distinct from old.minimum_crew_size
   and (auth.uid() is null or not public.has_any_role(array['Master Admin'])) then
  raise exception 'Only a Master Admin may change contractor staffing requirements.' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.protect_contractor_minimum_crew() from public,anon,authenticated;
create trigger protect_contractor_minimum_crew before update on public.contractor_companies
for each row execute function private.protect_contractor_minimum_crew();

create function private.enforce_contractor_minimum_job_crew()
returns trigger language plpgsql security definer set search_path='' as $$
declare minimum_size integer; company_name text; capacity integer; technician_count integer;
begin
 if new.archived_at is not null or new.status in ('Completed','Cancelled','Archived') then return new; end if;
 select c.minimum_crew_size,c.name into minimum_size,company_name
 from public.contractor_companies c where c.client_id=new.client_id
 order by c.minimum_crew_size desc limit 1;
 if coalesce(minimum_size,1)<=1 then return new; end if;
 if new.assigned_employee_id is not null then
  raise exception '% requires at least % crew members. Assign a crew, not an individual.',company_name,minimum_size;
 end if;
 if new.assigned_crew_id is not null then
  select c.technician_capacity into capacity from public.crews c where c.id=new.assigned_crew_id for share;
  if coalesce(capacity,0)+1<minimum_size then
   raise exception '% requires a crew lead plus at least % technician(s).',company_name,minimum_size-1;
  end if;
 end if;
 if new.status='In Progress' or new.operational_started_at is not null then
  select count(distinct t.employee_id) into technician_count
  from public.job_crew_technicians t where t.job_id=new.id and t.crew_id=new.assigned_crew_id
   and t.employee_id is distinct from new.assigned_crew_lead_id
   and public.is_eligible_job_tech(t.employee_id);
  if new.assigned_crew_id is null or new.assigned_crew_lead_id is null
    or technician_count+1<minimum_size then
   raise exception '% requires at least % assigned crew members before starting. The crew lead must select the job technicians.',company_name,minimum_size;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.enforce_contractor_minimum_job_crew() from public,anon,authenticated;
-- After the existing assignment guard has populated the job's crew-lead snapshot.
create trigger zz_contractor_minimum_job_crew before insert or update on public.jobs
for each row execute function private.enforce_contractor_minimum_job_crew();

create function private.enforce_contractor_opportunity_crew()
returns trigger language plpgsql security definer set search_path='' as $$
declare minimum_size integer;
begin
 select minimum_crew_size into minimum_size from public.contractor_companies where id=new.company_id;
 new.cleaner_count:=greatest(coalesce(new.cleaner_count,1),coalesce(minimum_size,1));
 return new;
end $$;
revoke all on function private.enforce_contractor_opportunity_crew() from public,anon,authenticated;
create trigger contractor_opportunity_minimum_crew before insert or update of cleaner_count,company_id
on public.contractor_opportunities for each row execute function private.enforce_contractor_opportunity_crew();

create function private.protect_contractor_crew_capacity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.technician_capacity<old.technician_capacity and exists(
  select 1 from public.jobs j join public.contractor_companies c on c.client_id=j.client_id
  where j.assigned_crew_id=new.id and j.archived_at is null
   and j.status not in ('Completed','Cancelled','Archived')
   and c.minimum_crew_size>new.technician_capacity+1
 ) then raise exception 'This crew is assigned to contractor jobs requiring more crew members.'; end if;
 return new;
end $$;
revoke all on function private.protect_contractor_crew_capacity() from public,anon,authenticated;
create trigger protect_contractor_crew_capacity before update of technician_capacity on public.crews
for each row execute function private.protect_contractor_crew_capacity();
