-- StudioScrubz OS: Master Admin archived-record permanent deletion.
-- REVIEW ONLY. Do not execute automatically.
-- This function does not add table DELETE grants or change foreign keys.

create or replace function public.master_admin_permanently_delete_archived_record(
  p_record_type text,
  p_record_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
  v_dependency_message constant text :=
    'This record cannot be permanently deleted because it is linked to existing business records.';
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Master Admin authorization is required for permanent deletion.';
  end if;

  case p_record_type
    when 'Clients' then
      if not exists (select 1 from public.clients where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      if exists (select 1 from public.properties where client_id = p_record_id)
        or exists (select 1 from public.estimates where client_id = p_record_id)
        or exists (select 1 from public.walkthroughs where client_id = p_record_id)
        or exists (select 1 from public.proposals where client_id = p_record_id)
        or exists (select 1 from public.jobs where client_id = p_record_id)
        or exists (select 1 from public.invoices where client_id = p_record_id)
        or exists (select 1 from public.payments where client_id = p_record_id)
        or exists (select 1 from public.expenses where client_id = p_record_id)
        or exists (select 1 from public.mileage_entries where client_id = p_record_id)
        or exists (select 1 from public.service_agreements where client_id = p_record_id)
      then raise exception '%', v_dependency_message; end if;
      delete from public.clients where id = p_record_id and archived_at is not null;

    when 'Properties' then
      if not exists (select 1 from public.properties where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      if exists (select 1 from public.estimates where property_id = p_record_id)
        or exists (select 1 from public.walkthroughs where property_id = p_record_id)
        or exists (select 1 from public.proposals where property_id = p_record_id)
        or exists (select 1 from public.jobs where property_id = p_record_id)
        or exists (select 1 from public.invoices where property_id = p_record_id)
        or exists (select 1 from public.expenses where property_id = p_record_id)
        or exists (select 1 from public.mileage_entries where property_id = p_record_id)
        or exists (select 1 from public.service_agreements where property_id = p_record_id)
      then raise exception '%', v_dependency_message; end if;
      delete from public.properties where id = p_record_id and archived_at is not null;

    when 'Estimates' then
      if not exists (select 1 from public.estimates where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      if exists (select 1 from public.walkthroughs where estimate_id = p_record_id)
        or exists (select 1 from public.proposals where estimate_id = p_record_id)
        or exists (select 1 from public.jobs where estimate_id = p_record_id)
      then raise exception '%', v_dependency_message; end if;
      delete from public.estimates where id = p_record_id and archived_at is not null;

    when 'Walkthroughs' then
      if not exists (select 1 from public.walkthroughs where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      if exists (select 1 from public.proposals where walkthrough_id = p_record_id)
        or exists (select 1 from public.jobs where walkthrough_id = p_record_id)
      then raise exception '%', v_dependency_message; end if;
      delete from public.walkthroughs where id = p_record_id and archived_at is not null;

    when 'Proposals' then
      if not exists (select 1 from public.proposals where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      if exists (select 1 from public.jobs where proposal_id = p_record_id)
        or exists (select 1 from public.invoices where proposal_id = p_record_id)
        or exists (select 1 from public.service_agreements where proposal_id = p_record_id)
      then raise exception '%', v_dependency_message; end if;
      delete from public.proposal_history where proposal_id = p_record_id;
      delete from public.proposals where id = p_record_id and archived_at is not null;

    when 'Jobs' then
      if not exists (select 1 from public.jobs where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      if exists (select 1 from public.invoices where job_id = p_record_id)
        or exists (select 1 from public.payments where job_id = p_record_id)
        or exists (select 1 from public.expenses where job_id = p_record_id)
        or exists (select 1 from public.mileage_entries where job_id = p_record_id)
        or exists (select 1 from public.time_entries where job_id = p_record_id)
        or exists (select 1 from public.service_occurrences where job_id = p_record_id)
      then raise exception '%', v_dependency_message; end if;
      delete from public.jobs where id = p_record_id and archived_at is not null;

    when 'Employees' then
      if not exists (select 1 from public.employees where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      if exists (select 1 from public.crews where crew_lead_id = p_record_id)
        or exists (select 1 from public.crew_members where employee_id = p_record_id)
        or exists (select 1 from public.expenses where employee_id = p_record_id)
        or exists (select 1 from public.vehicles where assigned_employee_id = p_record_id)
        or exists (select 1 from public.mileage_entries where employee_id = p_record_id)
        or exists (select 1 from public.time_entries where employee_id = p_record_id)
        or exists (select 1 from public.user_profiles where employee_id = p_record_id)
      then raise exception '%', v_dependency_message; end if;
      delete from public.employees where id = p_record_id and archived_at is not null;

    when 'Crews' then
      if not exists (select 1 from public.crews where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      if exists (select 1 from public.jobs where assigned_crew_id = p_record_id)
        or exists (select 1 from public.vehicles where assigned_crew_id = p_record_id)
        or exists (select 1 from public.mileage_entries where crew_id = p_record_id)
        or exists (select 1 from public.time_entries where crew_id = p_record_id)
        or exists (select 1 from public.service_agreements where assigned_crew_id = p_record_id)
        or exists (select 1 from public.service_occurrences where assigned_crew_id = p_record_id)
      then raise exception '%', v_dependency_message; end if;
      delete from public.crew_members where crew_id = p_record_id;
      delete from public.crews where id = p_record_id and archived_at is not null;

    when 'Invoices' then
      if not exists (select 1 from public.invoices where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      if exists (select 1 from public.payments where invoice_id = p_record_id) then
        raise exception '%', v_dependency_message;
      end if;
      delete from public.invoices where id = p_record_id and archived_at is not null;

    when 'Expenses' then
      if not exists (select 1 from public.expenses where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.expenses where id = p_record_id and archived_at is not null;

    when 'Vehicles' then
      if not exists (select 1 from public.vehicles where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      if exists (select 1 from public.mileage_entries where vehicle_id = p_record_id) then
        raise exception '%', v_dependency_message;
      end if;
      delete from public.vehicles where id = p_record_id and archived_at is not null;

    when 'Mileage' then
      if not exists (select 1 from public.mileage_entries where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.mileage_entries where id = p_record_id and archived_at is not null;

    when 'Time Entries' then
      if not exists (select 1 from public.time_entries where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.time_entries where id = p_record_id and archived_at is not null;

    when 'Service Agreements' then
      if not exists (select 1 from public.service_agreements where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      if exists (
        select 1 from public.service_occurrences
        where agreement_id = p_record_id and job_id is not null
      ) or exists (
        select 1
        from public.jobs j
        join public.service_occurrences so
          on so.id = j.service_occurrence_id
        where so.agreement_id = p_record_id
      ) then raise exception '%', v_dependency_message; end if;
      delete from public.service_occurrences where agreement_id = p_record_id;
      delete from public.service_agreements where id = p_record_id and archived_at is not null;

    when 'Services' then
      if not exists (select 1 from public.services where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.service_addon_links where service_id = p_record_id;
      delete from public.recurring_pricing_rules where service_id = p_record_id;
      delete from public.service_price_tiers where service_id = p_record_id;
      delete from public.services where id = p_record_id and archived_at is not null;

    when 'Service Add-Ons' then
      if not exists (select 1 from public.service_addons where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.service_addon_links where addon_id = p_record_id;
      delete from public.service_addons where id = p_record_id and archived_at is not null;

    else
      raise exception 'Unsupported archive record type.';
  end case;

  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'The archived record could not be permanently deleted.';
  end if;
  return p_record_type || ':' || p_record_id::text;
end;
$$;

revoke all on function public.master_admin_permanently_delete_archived_record(text, uuid)
from public, anon, authenticated;
grant execute on function public.master_admin_permanently_delete_archived_record(text, uuid)
to authenticated;
