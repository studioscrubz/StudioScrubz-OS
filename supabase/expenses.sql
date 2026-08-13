-- Review in Supabase SQL Editor. Intentionally not executed automatically.
create extension if not exists pgcrypto;
create table if not exists public.expenses (
 id uuid primary key default gen_random_uuid(), expense_number text not null unique, expense_date date not null default current_date,
 category text not null, description text not null, vendor text, amount numeric not null check(amount>=0), payment_method text,
 client_id uuid references public.clients(id) on delete set null, property_id uuid references public.properties(id) on delete set null,
 job_id uuid references public.jobs(id) on delete set null, employee_id uuid references public.employees(id) on delete set null,
 receipt_url text, reference_number text, notes text, is_tax_deductible boolean not null default true,
 status text not null default 'Active' check(status in ('Active','Voided','Archived')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create index if not exists expenses_number_idx on public.expenses(expense_number);create index if not exists expenses_date_idx on public.expenses(expense_date);create index if not exists expenses_category_idx on public.expenses(category);create index if not exists expenses_vendor_idx on public.expenses(vendor);create index if not exists expenses_client_idx on public.expenses(client_id);create index if not exists expenses_property_idx on public.expenses(property_id);create index if not exists expenses_job_idx on public.expenses(job_id);create index if not exists expenses_employee_idx on public.expenses(employee_id);create index if not exists expenses_status_idx on public.expenses(status);create index if not exists expenses_created_idx on public.expenses(created_at desc);create index if not exists expenses_archived_idx on public.expenses(archived_at);
create or replace function public.set_expenses_updated_at() returns trigger language plpgsql security invoker set search_path='' as $$begin new.updated_at=now();return new;end;$$;revoke all on function public.set_expenses_updated_at() from public;drop trigger if exists expenses_set_updated_at on public.expenses;create trigger expenses_set_updated_at before update on public.expenses for each row execute function public.set_expenses_updated_at();
alter table public.expenses enable row level security;grant select,insert,update on public.expenses to anon,authenticated;
create policy "Temporary expense read" on public.expenses for select to anon,authenticated using(true);create policy "Temporary expense create" on public.expenses for insert to anon,authenticated with check(true);create policy "Temporary expense update" on public.expenses for update to anon,authenticated using(true) with check(true);
