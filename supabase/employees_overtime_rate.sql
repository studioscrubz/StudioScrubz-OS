-- Phase 15 supplemental review-only migration. Do not execute automatically.
alter table public.employees add column if not exists overtime_rate numeric not null default 0 check(overtime_rate>=0);
