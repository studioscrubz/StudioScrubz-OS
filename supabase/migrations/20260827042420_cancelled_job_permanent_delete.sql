-- StudioScrubz OS: permanent deletion entry point for safe Cancelled Jobs.
-- Delegates the actual deletion to the existing archived-record deletion RPC.

begin;

create or replace function public.master_admin_permanently_delete_cancelled_job(
  p_job_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.jobs;
  deletion_result text;
  has_protected_history boolean;
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Master Admin authorization is required for permanent deletion.';
  end if;

  select *
  into job_row
  from public.jobs job
  where job.id = p_job_id
  for update;

  if not found then
    raise exception 'The Cancelled Job was not found.';
  end if;

  if job_row.status is distinct from 'Cancelled' or job_row.archived_at is not null then
    raise exception 'Only a non-archived Cancelled Job can be permanently deleted from the Jobs page.';
  end if;

  select exists (select 1 from public.invoices invoice where invoice.job_id = p_job_id)
    or exists (select 1 from public.payments payment where payment.job_id = p_job_id)
    or exists (select 1 from public.expenses expense where expense.job_id = p_job_id)
    or exists (select 1 from public.mileage_entries mileage where mileage.job_id = p_job_id)
    or exists (select 1 from public.time_entries entry where entry.job_id = p_job_id)
    or exists (select 1 from public.service_occurrences occurrence where occurrence.job_id = p_job_id)
  into has_protected_history;

  if not has_protected_history and to_regclass('public.invoice_job_photos') is not null then
    execute 'select exists (select 1 from public.invoice_job_photos where job_id = $1)'
    into has_protected_history
    using p_job_id;
  end if;

  if has_protected_history then
    raise exception 'This Cancelled Job has protected operational or financial history and must be retained. Archive it instead.';
  end if;

  -- The canonical permanent-delete RPC remains the only code that performs
  -- the DELETE and its associated attention-state cleanup. If it fails, this
  -- status change rolls back with the surrounding transaction.
  update public.jobs
  set status = 'Archived', archived_at = now()
  where id = p_job_id;

  deletion_result := public.master_admin_permanently_delete_archived_record(
    'Jobs',
    p_job_id
  );

  return deletion_result;
end;
$$;

revoke all on function public.master_admin_permanently_delete_cancelled_job(uuid)
from public, anon, authenticated;
grant execute on function public.master_admin_permanently_delete_cancelled_job(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
