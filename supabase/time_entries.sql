-- Phase 15 review-only migration. Do not execute automatically.
create table if not exists public.time_entries (
 id uuid primary key default gen_random_uuid(), time_entry_number text not null unique,
 employee_id uuid not null references public.employees(id) on delete restrict,
 job_id uuid references public.jobs(id) on delete set null, crew_id uuid references public.crews(id) on delete set null,
 work_date date not null default current_date, clock_in timestamptz not null, clock_out timestamptz,
 break_minutes integer not null default 0 check(break_minutes>=0), regular_hours numeric not null default 0 check(regular_hours>=0),
 overtime_hours numeric not null default 0 check(overtime_hours>=0), total_hours numeric not null default 0 check(total_hours>=0),
 hourly_rate_snapshot numeric not null default 0 check(hourly_rate_snapshot>=0), overtime_rate_snapshot numeric not null default 0 check(overtime_rate_snapshot>=0),
 regular_pay numeric not null default 0 check(regular_pay>=0), overtime_pay numeric not null default 0 check(overtime_pay>=0), gross_pay numeric not null default 0 check(gross_pay>=0),
 entry_type text not null default 'Job' check(entry_type in ('Job','Training','Office','Travel','Administrative','Other')),
 notes text, status text not null default 'Open' check(status in ('Open','Completed','Approved','Rejected','Archived')),
 approved_at timestamptz, approved_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create index if not exists time_entries_employee_idx on public.time_entries(employee_id);create index if not exists time_entries_job_idx on public.time_entries(job_id);
create index if not exists time_entries_crew_idx on public.time_entries(crew_id);create index if not exists time_entries_work_date_idx on public.time_entries(work_date desc);
create index if not exists time_entries_status_idx on public.time_entries(status);create index if not exists time_entries_clock_in_idx on public.time_entries(clock_in);
create index if not exists time_entries_created_at_idx on public.time_entries(created_at desc);create index if not exists time_entries_archived_at_idx on public.time_entries(archived_at);
create unique index if not exists one_open_time_entry_per_employee on public.time_entries(employee_id) where status='Open' and clock_out is null and archived_at is null;
drop trigger if exists time_entries_set_updated_at on public.time_entries;create trigger time_entries_set_updated_at before update on public.time_entries for each row execute function public.set_updated_at();
alter table public.time_entries enable row level security;grant select,insert,update on public.time_entries to anon,authenticated;
drop policy if exists "time entries development select" on public.time_entries;create policy "time entries development select" on public.time_entries for select to anon,authenticated using(true);
drop policy if exists "time entries development insert" on public.time_entries;create policy "time entries development insert" on public.time_entries for insert to anon,authenticated with check(true);
drop policy if exists "time entries development update" on public.time_entries;create policy "time entries development update" on public.time_entries for update to anon,authenticated using(true) with check(true);
