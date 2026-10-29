\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth, public to authenticated;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.user_profiles (
  id uuid primary key,
  role text not null,
  is_active boolean not null default true
);

create function public.has_any_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles profile
    where profile.id = (select auth.uid())
      and profile.is_active
      and profile.role = any(p_roles)
  )
$$;

create function public.is_master_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_role(array['Master Admin'])
$$;

create table public.business_settings (
  id uuid primary key,
  business_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_settings enable row level security;
revoke all on public.business_settings from public, anon, authenticated;
grant select, update on public.business_settings to authenticated;
create policy "Master Admin reads business settings"
on public.business_settings for select to authenticated
using (public.is_master_admin());
create policy "Master Admin updates business settings"
on public.business_settings for update to authenticated
using (public.is_master_admin())
with check (public.is_master_admin());

insert into public.user_profiles(id, role) values
  ('10000000-0000-4000-8000-000000000001', 'Master Admin'),
  ('10000000-0000-4000-8000-000000000002', 'Administrator'),
  ('10000000-0000-4000-8000-000000000003', 'Sales'),
  ('10000000-0000-4000-8000-000000000004', 'Manager'),
  ('10000000-0000-4000-8000-000000000005', 'Sales');

update public.user_profiles
set is_active = false
where id = '10000000-0000-4000-8000-000000000005';

insert into public.business_settings(id, business_name)
values ('20000000-0000-4000-8000-000000000001', 'StudioScrubz');
