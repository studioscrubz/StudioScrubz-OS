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
grant select on public.user_profiles to service_role;
create table public.clients(
 id uuid primary key default gen_random_uuid(),client_type text,company_name text,
 first_name text,last_name text,phone text,email text,status text,archived_at timestamptz
);
create table public.properties(
 id uuid primary key default gen_random_uuid(),client_id uuid references public.clients(id),
 property_type text,property_name text,archived_at timestamptz,address text,address_line_2 text,city text,state text,zip text,square_feet numeric,bedrooms numeric,bathrooms numeric,
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

-- Existing invoice relation needed by the notification delivery foreign key.
create table public.invoices(id uuid primary key,job_id uuid references public.jobs(id));

create schema storage;
create table storage.buckets(
 id text primary key,name text not null,public boolean not null,
 file_size_limit bigint,allowed_mime_types text[]
);

-- Operational billing dependencies used by the existing completed-Job RPC.
alter table public.jobs
 add column archived_at timestamptz,add column assigned_crew_id uuid,
 add column service_occurrence_id uuid,add column proposal_id uuid,add column pricing_snapshot jsonb;
alter table public.invoices alter column id set default gen_random_uuid(),
 add column invoice_number text unique,add column service_agreement_id uuid,add column contract_billing_type text,
 add column billing_period_start date,add column proposal_id uuid,add column client_id uuid,add column property_id uuid,
 add column client_name text,add column property_name text,add column customer_phone text,add column customer_email text,
 add column service_name text,add column status text,add column issue_date date,add column due_date date,
 add column line_items jsonb,add column subtotal numeric,add column discount numeric,add column tax numeric,
 add column total numeric,add column amount_paid numeric,add column balance_due numeric,add column paid_at timestamptz,
 add column notes text,add column terms text,add column archived_at timestamptz,add column created_at timestamptz default now();
create unique index invoices_one_active_per_job_idx on public.invoices(job_id)
 where archived_at is null and status<>'Cancelled';
create table public.proposals(id uuid primary key,customer_phone text,customer_email text);
create table public.business_settings(default_invoice_due_days integer,default_invoice_terms text,default_payment_terms text);
create table public.proposal_deposit_requirements(id uuid primary key);
create table public.payments(id uuid primary key,invoice_id uuid,job_id uuid,amount numeric,voided_at timestamptz);
create function public.current_user_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.user_profiles where id=auth.uid() and is_active
$$;
-- These paths have no prior financial handoff, crew delegation or proposal snapshot.
create function public.is_job_financially_handed_off(uuid) returns boolean language sql stable as $$ select false $$;
create function public.is_assigned_to_crew(uuid) returns boolean language sql stable as $$ select false $$;
create table public.service_agreements(id uuid primary key,billing_type text);
create table public.service_occurrences(id uuid primary key,agreement_id uuid references public.service_agreements(id));
