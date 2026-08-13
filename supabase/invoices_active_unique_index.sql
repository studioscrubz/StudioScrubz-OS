-- Review in Supabase SQL Editor. Intentionally not executed automatically.
-- Aligns database duplicate protection with the application's active-invoice rule.
drop index if exists public.invoices_one_active_per_job_idx;
create unique index invoices_one_active_per_job_idx
  on public.invoices(job_id)
  where archived_at is null and status <> 'Cancelled';
