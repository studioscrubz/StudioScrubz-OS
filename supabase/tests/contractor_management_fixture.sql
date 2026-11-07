-- Disposable PostgreSQL fixture for exact contractor migrations.
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create function auth.uid() returns uuid stable language sql as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table public.user_profiles(id uuid primary key references auth.users(id),role text,is_active boolean);
create table public.clients(
 id uuid primary key default gen_random_uuid(),client_type text,company_name text,
 phone text,email text,status text
);
create table public.properties(
 id uuid primary key default gen_random_uuid(),client_id uuid references public.clients(id),
 property_type text,address text,square_feet numeric,bedrooms numeric,bathrooms numeric,
 access_instructions text,notes text
);
create table public.jobs(
 id uuid primary key default gen_random_uuid(),job_number text not null unique,
 client_id uuid references public.clients(id),property_id uuid references public.properties(id),
 division text,client_name text,property_name text,service_name text,
 frequency text,status text,scheduled_date date,start_time time,estimated_duration numeric,
 price numeric,balance numeric,labor_hours numeric,recommended_crew_size integer,
 scope jsonb,access_instructions text,internal_notes text
);
