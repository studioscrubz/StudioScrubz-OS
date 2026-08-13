-- Phase 17 Stage A: profile bootstrap. REVIEW AND RUN MANUALLY.
-- This intentionally does not alter existing development policies on business tables.
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null check (role in ('Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_role_idx on public.user_profiles(role);
create index if not exists user_profiles_active_idx on public.user_profiles(is_active);

create or replace function public.set_user_profile_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end
$$;
drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at before update on public.user_profiles
for each row execute function public.set_user_profile_updated_at();

alter table public.user_profiles enable row level security;
revoke all on public.user_profiles from anon;
revoke insert, update, delete on public.user_profiles from authenticated;
grant select on public.user_profiles to authenticated;

drop policy if exists "Users read own profile" on public.user_profiles;
create policy "Users read own profile" on public.user_profiles
for select to authenticated using ((select auth.uid()) = id);

-- Bootstrap after manually creating the Auth user in Supabase Authentication.
-- Run from the trusted SQL Editor as postgres, replacing the email only:
-- insert into public.user_profiles (id,email,display_name,role)
-- select id,email,'Master Admin','Master Admin' from auth.users where email = 'REPLACE_WITH_AUTH_USER_EMAIL';
