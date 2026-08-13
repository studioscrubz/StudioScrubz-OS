-- Review and run this migration in the Supabase SQL editor.
-- It has intentionally not been executed by this project.

create extension if not exists pgcrypto;

create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  estimate_number text not null unique,
  client_id uuid not null,
  property_id uuid not null,
  division text not null check (division in ('Residential', 'Commercial')),
  customer_first_name text,
  customer_last_name text,
  customer_phone text,
  customer_email text,
  customer_address text,
  frequency text not null default 'One-Time',
  service_name text,
  status text not null default 'Open' check (status in ('Open', 'Archived')),
  result jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint estimates_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint estimates_property_id_fkey foreign key (property_id) references public.properties(id) on delete restrict
);

-- The UNIQUE constraint on estimate_number creates its required unique index.
create index if not exists estimates_client_id_idx on public.estimates (client_id);
create index if not exists estimates_property_id_idx on public.estimates (property_id);
create index if not exists estimates_status_idx on public.estimates (status);
create index if not exists estimates_division_idx on public.estimates (division);
create index if not exists estimates_created_at_idx on public.estimates (created_at desc);
create index if not exists estimates_archived_at_idx on public.estimates (archived_at);

create or replace function public.set_estimates_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function public.set_estimates_updated_at() from public;
drop trigger if exists estimates_set_updated_at on public.estimates;
create trigger estimates_set_updated_at before update on public.estimates for each row execute function public.set_estimates_updated_at();

alter table public.estimates enable row level security;
revoke all on table public.estimates from anon;
grant select, insert, update on table public.estimates to authenticated;

drop policy if exists "Authenticated users can read estimates" on public.estimates;
create policy "Authenticated users can read estimates" on public.estimates for select to authenticated
using ((select auth.uid()) is not null and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false);
drop policy if exists "Authenticated users can create estimates" on public.estimates;
create policy "Authenticated users can create estimates" on public.estimates for insert to authenticated
with check ((select auth.uid()) is not null and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false);
drop policy if exists "Authenticated users can update estimates" on public.estimates;
create policy "Authenticated users can update estimates" on public.estimates for update to authenticated
using ((select auth.uid()) is not null and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false)
with check ((select auth.uid()) is not null and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false);
