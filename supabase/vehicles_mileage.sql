-- Phase 14 review-only migration. Run in Supabase SQL Editor after review.
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(), vehicle_number text not null unique,
  nickname text, year integer, make text not null, model text not null, color text,
  license_plate text, vin text, vehicle_type text check (vehicle_type in ('Car','SUV','Truck','Van','Trailer','Other')),
  ownership_type text check (ownership_type in ('Company Owned','Leased','Personal','Rental','Other')),
  status text not null default 'Active' check (status in ('Active','Maintenance','Inactive','Archived')),
  assigned_employee_id uuid references public.employees(id) on delete set null,
  assigned_crew_id uuid references public.crews(id) on delete set null,
  current_odometer numeric check (current_odometer is null or current_odometer >= 0), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table if not exists public.mileage_entries (
  id uuid primary key default gen_random_uuid(), mileage_number text not null unique,
  trip_date date not null default current_date, vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  employee_id uuid references public.employees(id) on delete set null, crew_id uuid references public.crews(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null, client_id uuid references public.clients(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null, trip_purpose text not null,
  start_location text, end_location text, start_odometer numeric, end_odometer numeric,
  miles numeric not null check (miles >= 0), round_trip boolean not null default false,
  business_use boolean not null default true, mileage_rate numeric check (mileage_rate is null or mileage_rate >= 0),
  deductible_amount numeric not null default 0 check (deductible_amount >= 0), notes text,
  status text not null default 'Active' check (status in ('Active','Voided','Archived')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  constraint mileage_odometer_order check (start_odometer is null or end_odometer is null or end_odometer >= start_odometer)
);
create index if not exists vehicles_license_plate_idx on public.vehicles(license_plate);
create index if not exists vehicles_status_idx on public.vehicles(status); create index if not exists vehicles_assigned_employee_idx on public.vehicles(assigned_employee_id);
create index if not exists vehicles_assigned_crew_idx on public.vehicles(assigned_crew_id); create index if not exists vehicles_created_at_idx on public.vehicles(created_at desc);
create index if not exists vehicles_archived_at_idx on public.vehicles(archived_at);
create index if not exists mileage_trip_date_idx on public.mileage_entries(trip_date desc); create index if not exists mileage_vehicle_idx on public.mileage_entries(vehicle_id);
create index if not exists mileage_employee_idx on public.mileage_entries(employee_id); create index if not exists mileage_crew_idx on public.mileage_entries(crew_id);
create index if not exists mileage_job_idx on public.mileage_entries(job_id); create index if not exists mileage_client_idx on public.mileage_entries(client_id);
create index if not exists mileage_property_idx on public.mileage_entries(property_id); create index if not exists mileage_status_idx on public.mileage_entries(status);
create index if not exists mileage_created_at_idx on public.mileage_entries(created_at desc); create index if not exists mileage_archived_at_idx on public.mileage_entries(archived_at);
create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists vehicles_set_updated_at on public.vehicles; create trigger vehicles_set_updated_at before update on public.vehicles for each row execute function public.set_updated_at();
drop trigger if exists mileage_entries_set_updated_at on public.mileage_entries; create trigger mileage_entries_set_updated_at before update on public.mileage_entries for each row execute function public.set_updated_at();
alter table public.vehicles enable row level security; alter table public.mileage_entries enable row level security;
grant select,insert,update on public.vehicles,public.mileage_entries to anon,authenticated;
drop policy if exists "vehicles development select" on public.vehicles; create policy "vehicles development select" on public.vehicles for select to anon,authenticated using (true);
drop policy if exists "vehicles development insert" on public.vehicles; create policy "vehicles development insert" on public.vehicles for insert to anon,authenticated with check (true);
drop policy if exists "vehicles development update" on public.vehicles; create policy "vehicles development update" on public.vehicles for update to anon,authenticated using (true) with check (true);
drop policy if exists "mileage development select" on public.mileage_entries; create policy "mileage development select" on public.mileage_entries for select to anon,authenticated using (true);
drop policy if exists "mileage development insert" on public.mileage_entries; create policy "mileage development insert" on public.mileage_entries for insert to anon,authenticated with check (true);
drop policy if exists "mileage development update" on public.mileage_entries; create policy "mileage development update" on public.mileage_entries for update to anon,authenticated using (true) with check (true);
