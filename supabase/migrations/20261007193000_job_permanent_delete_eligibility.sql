begin;

create or replace function private.job_retained_history_reasons(p_job_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_reasons text[] := array[]::text[];
begin
  if exists(select 1 from public.scope_snapshots r where r.job_id=p_job_id) or exists(select 1 from public.scope_snapshot_items r where r.job_id=p_job_id) then v_reasons:=array_append(v_reasons,'Accepted scope'); end if;
  if exists(select 1 from public.invoices r where r.job_id=p_job_id) or exists(select 1 from public.invoice_job_lines r where r.job_id=p_job_id) or exists(select 1 from public.invoice_job_photos r where r.job_id=p_job_id) or exists(select 1 from public.payments r where r.job_id=p_job_id) or exists(select 1 from public.expenses r where r.job_id=p_job_id) then v_reasons:=array_append(v_reasons,'Invoice/payment history'); end if;
  if exists(select 1 from public.time_entries r where r.job_id=p_job_id) or exists(select 1 from public.job_labor_budget_snapshots r where r.job_id=p_job_id) or exists(select 1 from public.job_labor_budget_adjustments r where r.job_id=p_job_id) or exists(select 1 from public.job_labor_threshold_events r where r.job_id=p_job_id) then v_reasons:=array_append(v_reasons,'Labor records'); end if;
  if exists(select 1 from public.job_quality_inspections r where r.job_id=p_job_id) or exists(select 1 from public.job_quality_callbacks r where r.job_id=p_job_id) or exists(select 1 from public.job_scope_completion_records r where r.job_id=p_job_id) or exists(select 1 from public.job_customer_feedback r where r.job_id=p_job_id) or exists(select 1 from public.job_quality_evidence_links r where r.job_id=p_job_id) or exists(select 1 from public.job_compliance_records r where r.job_id=p_job_id) or exists(select 1 from public.job_quality_employee_attributions r where r.job_id=p_job_id) or exists(select 1 from public.job_performance_evidence_links r where r.job_id=p_job_id) then v_reasons:=array_append(v_reasons,'Quality/compliance records'); end if;
  if exists(select 1 from public.lead_commission_ledger r where r.job_id=p_job_id) or exists(select 1 from public.lead_commission_cleaning_qualifications r where r.job_id=p_job_id) then v_reasons:=array_append(v_reasons,'Commission records'); end if;
  if exists(select 1 from public.change_requests r where r.job_id=p_job_id) or exists(select 1 from public.field_discoveries r where r.job_id=p_job_id) or exists(select 1 from public.job_evidence r where r.job_id=p_job_id) or exists(select 1 from public.job_mileage_trips r where r.job_id=p_job_id) or exists(select 1 from public.mileage_entries r where r.job_id=p_job_id) or exists(select 1 from public.mileage_stops r where r.job_id=p_job_id) or exists(select 1 from public.service_occurrences r where r.job_id=p_job_id) or exists(select 1 from public.job_crew_presence r where r.job_id=p_job_id) or exists(select 1 from public.job_crew_presence_events r where r.job_id=p_job_id) or exists(select 1 from public.employee_teamwork_events r where r.job_id=p_job_id) then v_reasons:=array_append(v_reasons,'Operational evidence'); end if;
  return v_reasons;
end; $$;
revoke all on function private.job_retained_history_reasons(uuid) from public,anon,authenticated;

create or replace function private.guard_job_permanent_delete_retained_history()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if cardinality(private.job_retained_history_reasons(old.id))>0 then raise exception 'This Job contains retained business records and cannot be permanently deleted.'; end if;
  return old;
end; $$;
revoke all on function private.guard_job_permanent_delete_retained_history() from public,anon,authenticated;

create or replace function public.get_archived_job_permanent_delete_eligibility()
returns table(job_id uuid,can_permanently_delete boolean,protected_history_reasons text[])
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not public.is_master_admin() then raise exception 'Master Admin authorization is required for Job permanent-delete eligibility.' using errcode='42501'; end if;
  return query select j.id,cardinality(r.value)=0,r.value from public.jobs j cross join lateral(select private.job_retained_history_reasons(j.id) value)r where j.archived_at is not null;
end; $$;
revoke all on function public.get_archived_job_permanent_delete_eligibility() from public,anon,authenticated;
grant execute on function public.get_archived_job_permanent_delete_eligibility() to authenticated;

create or replace function public.master_admin_permanently_delete_cancelled_job(p_job_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_job public.jobs; v_result text;
begin
  if (select auth.uid()) is null or not public.is_master_admin() then raise exception 'Master Admin authorization is required for permanent deletion.' using errcode='42501'; end if;
  select * into v_job from public.jobs j where j.id=p_job_id for update;
  if not found then raise exception 'The Cancelled Job was not found.'; end if;
  if v_job.status is distinct from 'Cancelled' or v_job.archived_at is not null then raise exception 'Only a non-archived Cancelled Job can be permanently deleted from the Jobs page.'; end if;
  if cardinality(private.job_retained_history_reasons(v_job.id))>0 then raise exception 'This Job contains retained business records and cannot be permanently deleted.'; end if;
  update public.jobs set status='Archived',archived_at=now() where id=v_job.id;
  v_result:=public.master_admin_permanently_delete_archived_record('Jobs',v_job.id);
  return v_result;
end; $$;
revoke all on function public.master_admin_permanently_delete_cancelled_job(uuid) from public,anon,authenticated;
grant execute on function public.master_admin_permanently_delete_cancelled_job(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
