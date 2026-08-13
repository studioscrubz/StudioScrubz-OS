-- Review and run this migration in the Supabase SQL editor.
-- It has intentionally not been executed by this project.

create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  client_type text not null check (client_type in ('Residential', 'Commercial')),
  first_name text,
  last_name text,
  company_name text,
  phone text,
  email text,
  status text not null default 'Lead' check (status in ('Lead', 'Active', 'Inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint clients_name_required check (
    nullif(btrim(first_name), '') is not null
    or nullif(btrim(last_name), '') is not null
    or nullif(btrim(company_name), '') is not null
  )
);

create index if not exists clients_archived_at_idx on public.clients (archived_at);
create index if not exists clients_client_type_idx on public.clients (client_type);
create index if not exists clients_status_idx on public.clients (status);
create index if not exists clients_created_at_idx on public.clients (created_at desc);
create index if not exists clients_lower_email_idx on public.clients (lower(email)) where email is not null;

create or replace function public.set_clients_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_clients_updated_at() from public;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row
execute function public.set_clients_updated_at();

alter table public.clients enable row level security;

revoke all on table public.clients from anon;
grant select, insert, update on table public.clients to authenticated;

drop policy if exists "Authenticated users can read clients" on public.clients;
create policy "Authenticated users can read clients"
on public.clients for select
to authenticated
using (
  (select auth.uid()) is not null
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
);

drop policy if exists "Authenticated users can create clients" on public.clients;
create policy "Authenticated users can create clients"
on public.clients for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
);

drop policy if exists "Authenticated users can update clients" on public.clients;
create policy "Authenticated users can update clients"
on public.clients for update
to authenticated
using (
  (select auth.uid()) is not null
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
)
with check (
  (select auth.uid()) is not null
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
);
