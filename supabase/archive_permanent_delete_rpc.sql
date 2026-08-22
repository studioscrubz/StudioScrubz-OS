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
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Master Admin authorization is required for permanent deletion.';
  end if;

  case p_record_type
    when 'Clients' then
      if not exists (select 1 from public.clients where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.clients where id = p_record_id and archived_at is not null;

    when 'Properties' then
      if not exists (select 1 from public.properties where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.properties where id = p_record_id and archived_at is not null;

    when 'Estimates' then
      if not exists (select 1 from public.estimates where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.estimates where id = p_record_id and archived_at is not null;

    when 'Walkthroughs' then
      if not exists (select 1 from public.walkthroughs where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.walkthroughs where id = p_record_id and archived_at is not null;

    when 'Proposals' then
      if not exists (select 1 from public.proposals where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.proposal_history where proposal_id = p_record_id;
      delete from public.proposals where id = p_record_id and archived_at is not null;

    when 'Jobs' then
      if not exists (select 1 from public.jobs where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.jobs where id = p_record_id and archived_at is not null;

    when 'Employees' then
      if not exists (select 1 from public.employees where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.crew_members where employee_id = p_record_id;
      delete from public.employees where id = p_record_id and archived_at is not null;

    when 'Crews' then
      if not exists (select 1 from public.crews where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      delete from public.crew_members where crew_id = p_record_id;
      delete from public.crews where id = p_record_id and archived_at is not null;

    when 'Invoices' then
      if not exists (select 1 from public.invoices where id = p_record_id and archived_at is not null) then
        raise exception 'The record must be archived before it can be permanently deleted.';
      end if;
      if exists (select 1 from public.payments where invoice_id = p_record_id) then
        raise exception 'This Invoice has payment history and must be retained for financial records. Archive it instead.';
      end if;
      if exists (select 1 from public.square_checkout_attempts where invoice_id = p_record_id) then
        raise exception 'This Invoice has Square checkout history and must be retained for financial records. Archive it instead.';
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
