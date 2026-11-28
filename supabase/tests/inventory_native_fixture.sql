-- Extend the existing equipment release fixture; run only in its disposable native PostgreSQL database.
\set ON_ERROR_STOP on
\ir terminal_gps_lead_equipment_fixture.sql
\ir ../migrations/20261027082047_terminal_gps_and_crew_lead_equipment_custody.sql
alter table public.employees add column employment_type text, add column first_name text, add column last_name text,
 add column employee_number text,add column email text,add column department text,add column hourly_rate numeric default 25,add column overtime_rate numeric default 37.5;
alter table public.user_profiles add column is_active boolean default true, add column email text,add column display_name text;
alter table auth.users add column aud text,add column role text,add column email text,add column created_at timestamptz,add column updated_at timestamptz;
alter table public.crews add column crew_name text;
alter table public.jobs add column job_number text,add column service_name text,add column division text,add column property_id uuid,add column assigned_employee_name text,add column assigned_crew_lead_id uuid;
create or replace view public.jobs_operational_safe as select * from public.jobs;
create or replace function public.current_employee_id() returns uuid language sql stable security definer set search_path='' as $$ select employee_id from public.user_profiles where id=auth.uid() and is_active $$;
create function public.is_master_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and role='Master Admin') $$;
create table public.employee_screening_legacy_exemptions(employee_id uuid primary key);
create table public.employee_work_sessions(id uuid primary key default gen_random_uuid(),employee_id uuid,clock_in timestamptz default now(),clock_out timestamptz,status text default 'Open');
create unique index one_open_work_session_per_employee on public.employee_work_sessions(employee_id) where status='Open' and clock_out is null;
create table public.time_entries(id uuid primary key default gen_random_uuid(),time_entry_number text,employee_id uuid,job_id uuid,crew_id uuid,work_date date,clock_in timestamptz,clock_out timestamptz,
 status text default 'Open',archived_at timestamptz,entry_type text,notes text,hourly_rate_snapshot numeric,overtime_rate_snapshot numeric,break_minutes numeric default 0,
 regular_hours numeric default 0,overtime_hours numeric default 0,total_hours numeric default 0,regular_pay numeric default 0,overtime_pay numeric default 0,gross_pay numeric default 0);
create function public.ensure_employee_platform_active(p_employee_id uuid) returns public.employee_work_sessions language plpgsql security definer set search_path='' as $$
declare session public.employee_work_sessions; begin
 select * into session from public.employee_work_sessions where employee_id=p_employee_id and clock_out is null order by clock_in desc limit 1;
 if found then return session; end if;
 insert into public.employee_work_sessions(employee_id) values(p_employee_id) returning * into session; return session;
end $$;
\ir ../migrations/20261006205500_fix_open_job_payroll_entry_overtime_regression.sql
create function public.close_job_payroll_entries(p_job_id uuid,p_ended_at timestamptz) returns integer language plpgsql security definer set search_path='' as $$
declare changed integer; begin
 update public.time_entries set clock_out=p_ended_at,status='Completed',total_hours=extract(epoch from (p_ended_at-clock_in))/3600
 where job_id=p_job_id and status='Open' and clock_out is null and archived_at is null;
 get diagnostics changed=row_count; return changed;
end $$;
create function public.get_job_equipment_catalog(p_job_id uuid) returns table(item_name text,item_kind text) language sql security definer set search_path='' as $$
 select 'Existing specialty equipment','Equipment' where exists(select 1 from public.jobs where id=p_job_id)
$$;
create table public.jobsite_arrival_checks(id uuid primary key default gen_random_uuid(),job_id uuid,employee_id uuid,result text,checked_at timestamptz default now());
create function private.resolve_jobsite_geofence(p_property uuid) returns table(property_id uuid) language sql as $$ select p_property where p_property is not null $$;
create table public.employee_onboarding_cases(id uuid primary key default gen_random_uuid(),employee_id uuid references public.employees(id));
create table public.employee_onboarding_steps(case_id uuid references public.employee_onboarding_cases(id),code text,completed_at timestamptz,completed_by uuid,primary key(case_id,code));
grant usage on schema public,private,auth to authenticated,anon;
-- Employee lookups in the retained fixture helpers run as definer, matching the production architecture.
alter function public.current_user_role() security definer;
alter function public.has_role(text) security definer;
alter function public.has_any_role(text[]) security definer;
