-- ONLY for an empty disposable database. Never execute against an application database.
\set ON_ERROR_STOP on
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.employees(id uuid primary key,employment_status text,employment_type text,archived_at timestamptz);
create table public.user_profiles(id uuid primary key,employee_id uuid references public.employees(id),role text,is_active boolean);
create table public.crews(id uuid primary key,crew_lead_id uuid references public.employees(id));
create table public.jobs(id uuid primary key);
create function public.current_employee_id() returns uuid language sql stable security definer as $$ select employee_id from public.user_profiles where id=auth.uid() and is_active $$;
create function public.is_master_admin() returns boolean language sql stable security definer as $$ select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and role='Master Admin') $$;
create function public.can_access_job(uuid) returns boolean language sql stable as $$ select false $$;
grant usage on schema public,auth,private to authenticated,anon;
grant execute on function auth.uid(),public.current_employee_id(),public.is_master_admin(),public.can_access_job(uuid) to authenticated;
