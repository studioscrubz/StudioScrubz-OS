\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create schema storage;
grant usage on schema public, auth to authenticated;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.employees (id uuid primary key);
create table public.user_profiles (
  id uuid primary key,
  role text not null,
  is_active boolean not null default true,
  employee_id uuid references public.employees(id)
);
create table public.jobs (
  id uuid primary key,
  job_number text not null unique,
  status text not null,
  assigned_employee_id uuid references public.employees(id),
  assigned_crew_id uuid,
  photos jsonb not null default '[]'::jsonb,
  archived_at timestamptz,
  completed_at timestamptz,
  operational_ended_at timestamptz
);
create table public.time_entries (
  id uuid primary key,
  job_id uuid not null references public.jobs(id),
  employee_id uuid not null references public.employees(id),
  clock_in timestamptz not null,
  clock_out timestamptz,
  status text not null
);
create table public.job_equipment_assignments (
  id uuid primary key,
  job_id uuid not null references public.jobs(id),
  released_at timestamptz
);
create table public.job_equipment_clearances (
  id uuid primary key,
  assignment_id uuid not null references public.job_equipment_assignments(id),
  checkpoint text not null,
  status text not null
);
create table storage.objects (
  id uuid primary key,
  bucket_id text not null,
  name text not null unique
);
grant select on public.jobs, public.time_entries to authenticated;

create view public.jobs_operational_safe with (security_invoker=true) as select * from public.jobs;

create function public.has_any_role(p_roles text[])
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.user_profiles profile
    where profile.id = (select auth.uid()) and profile.is_active and profile.role = any(p_roles)
  )
$$;

create function public.can_control_job_timer(p_employee_id uuid, p_crew_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.has_any_role(array['Master Admin','Administrator','Manager'])
    or exists (
      select 1 from public.user_profiles profile
      where profile.id = (select auth.uid()) and profile.employee_id = p_employee_id
    )
$$;

create function public.is_valid_operational_photo_path(p_record_type text, p_record_id uuid, p_name text)
returns boolean language sql immutable set search_path='' as $$
  select p_record_type = 'jobs'
    and p_name ~ ('^jobs/' || p_record_id::text || '/after/[0-9a-f-]{36}[.](jpg|png|webp|heic|heif)$')
$$;

create function public.complete_in_progress_job_before_equipment(p_job_id uuid)
returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
declare job public.jobs; safe public.jobs_operational_safe; ended timestamptz := transaction_timestamp();
begin
  select * into job from public.jobs where id=p_job_id for update;
  if not found or not public.can_control_job_timer(job.assigned_employee_id,job.assigned_crew_id) then
    raise exception 'Job not found or access denied.';
  end if;
  if job.status='Completed' then select * into safe from public.jobs_operational_safe where id=job.id; return safe; end if;
  if job.status<>'In Progress' then raise exception 'Only an In Progress Job can be completed.'; end if;
  update public.time_entries set clock_out=ended,status='Completed' where job_id=job.id and status='Open' and clock_out is null;
  update public.jobs set status='Completed',completed_at=ended,operational_ended_at=ended where id=job.id;
  select * into safe from public.jobs_operational_safe where id=job.id;
  return safe;
end;
$$;

create function public.complete_in_progress_job(p_job_id uuid)
returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
begin
  return public.complete_in_progress_job_before_equipment(p_job_id);
end;
$$;

revoke all on function public.complete_in_progress_job(uuid) from public,anon,authenticated;
grant execute on function public.complete_in_progress_job(uuid) to authenticated;

insert into public.employees(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000003');
insert into public.user_profiles(id,role,employee_id) values
 ('20000000-0000-4000-8000-000000000001','Manager','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','Scrub Technician','10000000-0000-4000-8000-000000000003');
insert into public.jobs(id,job_number,status,assigned_employee_id) values
 ('30000000-0000-4000-8000-000000000001','JOB-NO-PHOTO','In Progress','10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002','JOB-UNAUTHORIZED','In Progress','10000000-0000-4000-8000-000000000002'),
 ('30000000-0000-4000-8000-000000000003','JOB-TRIGGER','In Progress','10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000004','JOB-HISTORICAL','Completed','10000000-0000-4000-8000-000000000001');
insert into public.time_entries(id,job_id,employee_id,clock_in,status) values
 ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2026-10-26 15:00:00+00','Open'),
 ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','2026-10-26 15:30:00+00','Open');
