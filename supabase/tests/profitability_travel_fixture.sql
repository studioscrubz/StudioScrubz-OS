\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists private;
create table auth.users (id uuid primary key);

create function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.user_profiles (
  id uuid primary key references auth.users(id),
  role text not null,
  is_active boolean not null default true
);

create function public.has_any_role(p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_profiles profile
    where profile.id = (select auth.uid()) and profile.is_active and profile.role = any(p_roles)
  )
$$;

create function public.is_master_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_any_role(array['Master Admin'])
$$;

create table public.estimates (
  id uuid primary key,
  created_by uuid not null references auth.users(id),
  result jsonb not null default '{}'::jsonb,
  approved_pricing_snapshot jsonb not null default '{}'::jsonb,
  client_delivery_snapshot jsonb not null default '{}'::jsonb
);
create table public.proposals (
  id uuid primary key,
  created_by uuid not null references auth.users(id),
  result jsonb not null default '{}'::jsonb,
  approved_pricing_snapshot jsonb not null default '{}'::jsonb,
  client_delivery_snapshot jsonb not null default '{}'::jsonb
);

alter table public.estimates enable row level security;
alter table public.proposals enable row level security;
revoke all on public.estimates, public.proposals from public, anon, authenticated;
grant select, insert, update on public.estimates, public.proposals to authenticated;
create policy estimates_owner on public.estimates for all to authenticated
  using ((select auth.uid()) = created_by) with check ((select auth.uid()) = created_by);
create policy proposals_owner on public.proposals for all to authenticated
  using ((select auth.uid()) = created_by) with check ((select auth.uid()) = created_by);

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000004'),
  ('10000000-0000-4000-8000-000000000005'),
  ('10000000-0000-4000-8000-000000000006');
insert into public.user_profiles(id, role) values
  ('10000000-0000-4000-8000-000000000001', 'Master Admin'),
  ('10000000-0000-4000-8000-000000000002', 'Administrator'),
  ('10000000-0000-4000-8000-000000000003', 'Manager'),
  ('10000000-0000-4000-8000-000000000004', 'Sales'),
  ('10000000-0000-4000-8000-000000000005', 'Crew Lead'),
  ('10000000-0000-4000-8000-000000000006', 'Scrubz Technician');

-- These rows model existing public records from the draft local implementation.
insert into public.estimates(id, created_by, result, approved_pricing_snapshot, client_delivery_snapshot) values (
  '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '{"customerTotal":500,"profitability":{"version":1}}',
  '{"publicPrice":500,"result":{"profitability":{"version":1}}}',
  '{"customerName":"Example Customer","profitability":{"version":1}}'
);
insert into public.proposals(id, created_by, result, approved_pricing_snapshot, client_delivery_snapshot) values (
  '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '{"customerTotal":700,"profitability":{"version":1}}',
  '{"publicPrice":700,"result":{"profitability":{"version":1}}}',
  '{"customerName":"Example Customer","profitability":{"version":1}}'
);
