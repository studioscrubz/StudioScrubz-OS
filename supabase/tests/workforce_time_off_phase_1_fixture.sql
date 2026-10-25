\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create schema extensions;
grant usage on schema public,auth to authenticated;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;

create table public.employees (
  id uuid primary key,
  first_name text not null,
  last_name text not null,
  preferred_name text,
  employment_status text not null default 'Active',
  archived_at timestamptz
);
create table public.user_profiles (
  id uuid primary key,
  role text not null,
  is_active boolean not null default true,
  employee_id uuid references public.employees(id),
  display_name text,
  email text
);
-- Mirror the production authenticated-profile SELECT grant and self-read RLS.
-- Employee-owned time-off policies reference this profile through invoker SELECT.
alter table public.user_profiles enable row level security;
grant select on public.user_profiles to authenticated;
create policy user_profiles_self_read on public.user_profiles
  for select to authenticated
  using (id = (select auth.uid()));

create table public.crews (
  id uuid primary key,
  crew_name text not null,
  crew_lead_id uuid references public.employees(id),
  status text not null default 'Active',
  archived_at timestamptz
);
create table public.crew_members (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id),
  employee_id uuid not null references public.employees(id),
  unique(crew_id,employee_id)
);
create table public.jobs (
  id uuid primary key,
  job_number text not null unique,
  status text not null default 'Ready to Schedule',
  scheduled_date date,
  start_time time,
  estimated_duration numeric,
  archived_at timestamptz,
  assigned_employee_id uuid references public.employees(id),
  assigned_employee_name text,
  assigned_crew_id uuid references public.crews(id),
  assigned_crew_name text,
  crew_lead_name text,
  assigned_team jsonb not null default '[]'::jsonb,
  equipment_responsibility_confirmed_at timestamptz,
  equipment_responsibility_confirmed_by uuid
);
create table public.job_equipment_responsibility_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  state text not null
);
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  employee_id uuid not null references public.employees(id),
  status text not null
);

create view public.jobs_operational_safe with (security_invoker=true) as select * from public.jobs;

create function public.has_any_role(p_roles text[]) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.is_active and p.role=any(p_roles))
$$;
create function public.is_eligible_job_tech(p_employee_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.employees e where e.id=p_employee_id and e.employment_status='Active' and e.archived_at is null)
$$;

create function public.update_operational_job(
  p_job_id uuid,p_scheduled_date date default null,p_start_time time default null,
  p_estimated_duration numeric default null,p_assigned_crew_id uuid default null,
  p_internal_notes text default null,p_status text default null
) returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
declare safe public.jobs_operational_safe;
begin
  if (select auth.uid()) is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Job operation not permitted.' using errcode='42501';
  end if;
  update public.jobs set scheduled_date=coalesce(p_scheduled_date,scheduled_date),
    start_time=coalesce(p_start_time,start_time),estimated_duration=coalesce(p_estimated_duration,estimated_duration),
    status=coalesce(p_status,status) where id=p_job_id;
  select * into safe from public.jobs_operational_safe where id=p_job_id;
  if not found then raise exception 'Job not found.'; end if;
  return safe;
end $$;

create function public.set_job_worker_assignment(
  p_job_id uuid,p_assignment_kind text,p_employee_id uuid default null,p_crew_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare employee public.employees; crew public.crews; job public.jobs;
begin
  if (select auth.uid()) is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Only management may assign Jobs.' using errcode='42501';
  end if;
  select * into employee from public.employees where id=p_employee_id;
  select * into crew from public.crews where id=p_crew_id;
  update public.jobs set
    assigned_employee_id=case when p_assignment_kind='individual' then p_employee_id end,
    assigned_employee_name=case when p_assignment_kind='individual' then employee.first_name||' '||employee.last_name end,
    assigned_crew_id=case when p_assignment_kind='crew' then p_crew_id end,
    assigned_crew_name=case when p_assignment_kind='crew' then crew.crew_name end,
    status=case when scheduled_date is null then 'Ready to Schedule' when p_assignment_kind='unassigned' then 'Scheduled' else 'Crew Assigned' end
  where id=p_job_id returning * into job;
  if not found then raise exception 'Job not found.'; end if;
  return to_jsonb(job);
end $$;

revoke all on function public.has_any_role(text[]),public.is_eligible_job_tech(uuid),public.update_operational_job(uuid,date,time,numeric,uuid,text,text),public.set_job_worker_assignment(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.update_operational_job(uuid,date,time,numeric,uuid,text,text),public.set_job_worker_assignment(uuid,text,uuid,uuid) to authenticated;
create publication supabase_realtime;
