-- Review and run this migration in the Supabase SQL editor.
-- It has intentionally not been executed by this project.

create extension if not exists pgcrypto;
create table if not exists public.walkthroughs (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid,
  client_id uuid not null,
  property_id uuid not null,
  division text not null check (division in ('Residential', 'Commercial')),
  walkthrough_date date,
  walkthrough_time time,
  status text not null default 'New' check (status in ('New', 'Scheduled', 'Completed', 'Proposal Ready', 'Archived')),
  contact_name text,
  phone text,
  email text,
  assigned_to text,
  notes text,
  scope jsonb not null default '[]'::jsonb,
  measurements jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  photos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint walkthroughs_estimate_id_fkey foreign key (estimate_id) references public.estimates(id) on delete restrict,
  constraint walkthroughs_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint walkthroughs_property_id_fkey foreign key (property_id) references public.properties(id) on delete restrict
);
create index if not exists walkthroughs_estimate_id_idx on public.walkthroughs (estimate_id);
create index if not exists walkthroughs_client_id_idx on public.walkthroughs (client_id);
create index if not exists walkthroughs_property_id_idx on public.walkthroughs (property_id);
create index if not exists walkthroughs_date_idx on public.walkthroughs (walkthrough_date);
create index if not exists walkthroughs_status_idx on public.walkthroughs (status);
create index if not exists walkthroughs_division_idx on public.walkthroughs (division);
create index if not exists walkthroughs_created_at_idx on public.walkthroughs (created_at desc);
create index if not exists walkthroughs_archived_at_idx on public.walkthroughs (archived_at);
create unique index if not exists walkthroughs_one_active_per_estimate_idx on public.walkthroughs (estimate_id) where estimate_id is not null and archived_at is null;

create or replace function public.set_walkthroughs_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function public.set_walkthroughs_updated_at() from public;
drop trigger if exists walkthroughs_set_updated_at on public.walkthroughs;
create trigger walkthroughs_set_updated_at before update on public.walkthroughs for each row execute function public.set_walkthroughs_updated_at();

alter table public.walkthroughs enable row level security;
grant select, insert, update on table public.walkthroughs to anon, authenticated;
drop policy if exists "Temporary walkthrough read access" on public.walkthroughs;
create policy "Temporary walkthrough read access" on public.walkthroughs for select to anon, authenticated using (true);
drop policy if exists "Temporary walkthrough create access" on public.walkthroughs;
create policy "Temporary walkthrough create access" on public.walkthroughs for insert to anon, authenticated with check (true);
drop policy if exists "Temporary walkthrough update access" on public.walkthroughs;
create policy "Temporary walkthrough update access" on public.walkthroughs for update to anon, authenticated using (true) with check (true);
