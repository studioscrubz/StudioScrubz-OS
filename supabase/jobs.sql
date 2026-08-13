-- Review in Supabase SQL Editor. Intentionally not executed automatically.
create extension if not exists pgcrypto;
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(), job_number text not null unique,
  proposal_id uuid not null references public.proposals(id) on delete restrict,
  estimate_id uuid references public.estimates(id) on delete restrict,
  walkthrough_id uuid references public.walkthroughs(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  division text not null check (division in ('Residential','Commercial')), client_name text, property_name text,
  service_name text, frequency text not null default 'One-Time',
  status text not null default 'Ready to Schedule' check (status in ('Ready to Schedule','Scheduled','Crew Assigned','In Progress','Completed','Cancelled','Archived')),
  scheduled_date date, start_time time, estimated_duration numeric,
  assigned_crew_name text, crew_lead_name text, assigned_team jsonb not null default '[]'::jsonb,
  price numeric not null default 0, deposit numeric not null default 0, balance numeric not null default 0,
  labor_hours numeric not null default 0, recommended_crew_size integer not null default 1,
  scope jsonb not null default '[]'::jsonb, checklist jsonb not null default '[]'::jsonb, photos jsonb not null default '[]'::jsonb,
  access_instructions text, internal_notes text, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create index if not exists jobs_proposal_id_idx on public.jobs(proposal_id);
create index if not exists jobs_estimate_id_idx on public.jobs(estimate_id);
create index if not exists jobs_walkthrough_id_idx on public.jobs(walkthrough_id);
create index if not exists jobs_client_id_idx on public.jobs(client_id);
create index if not exists jobs_property_id_idx on public.jobs(property_id);
create index if not exists jobs_status_idx on public.jobs(status);
create index if not exists jobs_scheduled_date_idx on public.jobs(scheduled_date);
create index if not exists jobs_created_at_idx on public.jobs(created_at desc);
create index if not exists jobs_archived_at_idx on public.jobs(archived_at);
create unique index if not exists jobs_one_active_per_proposal_idx on public.jobs(proposal_id) where archived_at is null;
create or replace function public.set_jobs_updated_at() returns trigger language plpgsql security invoker set search_path='' as $$ begin new.updated_at=now(); return new; end; $$;
revoke all on function public.set_jobs_updated_at() from public;
drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at before update on public.jobs for each row execute function public.set_jobs_updated_at();
alter table public.jobs enable row level security;
grant select,insert,update on public.jobs to anon,authenticated;
drop policy if exists "Temporary job read" on public.jobs;
drop policy if exists "Temporary job create" on public.jobs;
drop policy if exists "Temporary job update" on public.jobs;
create policy "Temporary job read" on public.jobs for select to anon,authenticated using(true);
create policy "Temporary job create" on public.jobs for insert to anon,authenticated with check(true);
create policy "Temporary job update" on public.jobs for update to anon,authenticated using(true) with check(true);
