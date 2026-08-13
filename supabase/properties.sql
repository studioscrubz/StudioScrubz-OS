-- Review and run this migration in the Supabase SQL editor.
-- It has intentionally not been executed by this project.

create extension if not exists pgcrypto;

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  property_name text,
  property_type text not null check (property_type in ('Residential', 'Commercial')),
  address text not null check (nullif(btrim(address), '') is not null),
  address_line_2 text,
  city text,
  state text,
  zip text,
  square_feet numeric check (square_feet is null or square_feet >= 0),
  floors numeric check (floors is null or floors >= 0),
  bedrooms numeric check (bedrooms is null or bedrooms >= 0),
  bathrooms numeric check (bathrooms is null or bathrooms >= 0),
  access_instructions text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint properties_client_id_fkey foreign key (client_id)
    references public.clients(id) on delete restrict
);

create index if not exists properties_client_id_idx on public.properties (client_id);
create index if not exists properties_address_idx on public.properties (lower(address));
create index if not exists properties_archived_at_idx on public.properties (archived_at);
create index if not exists properties_created_at_idx on public.properties (created_at desc);

create or replace function public.set_properties_updated_at()
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

revoke all on function public.set_properties_updated_at() from public;

drop trigger if exists properties_set_updated_at on public.properties;
create trigger properties_set_updated_at
before update on public.properties
for each row execute function public.set_properties_updated_at();

alter table public.properties enable row level security;

revoke all on table public.properties from anon;
grant select, insert, update on table public.properties to authenticated;

drop policy if exists "Authenticated users can read properties" on public.properties;
create policy "Authenticated users can read properties"
on public.properties for select to authenticated
using (
  (select auth.uid()) is not null
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
);

drop policy if exists "Authenticated users can create properties" on public.properties;
create policy "Authenticated users can create properties"
on public.properties for insert to authenticated
with check (
  (select auth.uid()) is not null
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
);

drop policy if exists "Authenticated users can update properties" on public.properties;
create policy "Authenticated users can update properties"
on public.properties for update to authenticated
using (
  (select auth.uid()) is not null
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
)
with check (
  (select auth.uid()) is not null
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
);
