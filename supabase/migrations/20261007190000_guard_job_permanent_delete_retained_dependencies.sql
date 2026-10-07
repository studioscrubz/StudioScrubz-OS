begin;

-- Jobs with accepted scope, financial, labor, quality, commission, or other
-- retained operational history must remain archived.  This guard deliberately
-- does not change any FK action and does not delete or detach retained rows.
create or replace function private.guard_job_permanent_delete_retained_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.scope_snapshots snapshot
    where snapshot.job_id = old.id
  ) then
    raise exception 'This Job has an immutable accepted-scope snapshot and must be retained. Archive it instead.';
  end if;

  if exists (select 1 from public.scope_snapshot_items row where row.job_id = old.id)
    or exists (select 1 from public.change_requests row where row.job_id = old.id)
    or exists (select 1 from public.field_discoveries row where row.job_id = old.id)
    or exists (select 1 from public.job_evidence row where row.job_id = old.id)
    or exists (select 1 from public.invoices row where row.job_id = old.id)
    or exists (select 1 from public.invoice_job_lines row where row.job_id = old.id)
    or exists (select 1 from public.invoice_job_photos row where row.job_id = old.id)
    or exists (select 1 from public.payments row where row.job_id = old.id)
    or exists (select 1 from public.expenses row where row.job_id = old.id)
    or exists (select 1 from public.mileage_entries row where row.job_id = old.id)
    or exists (select 1 from public.mileage_stops row where row.job_id = old.id)
    or exists (select 1 from public.job_mileage_trips row where row.job_id = old.id)
    or exists (select 1 from public.time_entries row where row.job_id = old.id)
    or exists (select 1 from public.job_crew_presence row where row.job_id = old.id)
    or exists (select 1 from public.job_crew_presence_events row where row.job_id = old.id)
    or exists (select 1 from public.service_occurrences row where row.job_id = old.id)
    or exists (select 1 from public.job_labor_budget_snapshots row where row.job_id = old.id)
    or exists (select 1 from public.job_labor_budget_adjustments row where row.job_id = old.id)
    or exists (select 1 from public.job_labor_threshold_events row where row.job_id = old.id)
    or exists (select 1 from public.job_quality_inspections row where row.job_id = old.id)
    or exists (select 1 from public.job_quality_callbacks row where row.job_id = old.id)
    or exists (select 1 from public.job_scope_completion_records row where row.job_id = old.id)
    or exists (select 1 from public.job_customer_feedback row where row.job_id = old.id)
    or exists (select 1 from public.job_quality_evidence_links row where row.job_id = old.id)
    or exists (select 1 from public.job_compliance_records row where row.job_id = old.id)
    or exists (select 1 from public.employee_teamwork_events row where row.job_id = old.id)
    or exists (select 1 from public.job_quality_employee_attributions row where row.job_id = old.id)
    or exists (select 1 from public.job_performance_evidence_links row where row.job_id = old.id)
    or exists (select 1 from public.lead_commission_ledger row where row.job_id = old.id)
    or exists (select 1 from public.lead_commission_cleaning_qualifications row where row.job_id = old.id)
  then
    raise exception 'This Job has retained operational, financial, legal, labor, quality, or commission history and must be retained. Archive it instead.';
  end if;

  return old;
end;
$$;

revoke all on function private.guard_job_permanent_delete_retained_history()
from public, anon, authenticated;

drop trigger if exists jobs_guard_permanent_delete_retained_history on public.jobs;
create trigger jobs_guard_permanent_delete_retained_history
before delete on public.jobs
for each row execute function private.guard_job_permanent_delete_retained_history();

commit;
