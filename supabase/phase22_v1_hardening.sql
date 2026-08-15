-- StudioScrubz OS Phase 22: final v1 privilege hardening.
-- REVIEW ONLY. Do not execute automatically.
-- Run last, after all feature migrations and the archive permanent-delete RPC.

-- Complete the retained-history relationship conversion omitted by the earlier
-- global archive migration. Expense and mileage history survives Client/Property deletion.
alter table public.expenses drop constraint if exists expenses_client_id_fkey;
alter table public.expenses alter column client_id drop not null;
alter table public.expenses add constraint expenses_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

alter table public.expenses drop constraint if exists expenses_property_id_fkey;
alter table public.expenses alter column property_id drop not null;
alter table public.expenses add constraint expenses_property_id_fkey
  foreign key (property_id) references public.properties(id) on delete set null;

alter table public.mileage_entries drop constraint if exists mileage_entries_client_id_fkey;
alter table public.mileage_entries alter column client_id drop not null;
alter table public.mileage_entries add constraint mileage_entries_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

alter table public.mileage_entries drop constraint if exists mileage_entries_property_id_fkey;
alter table public.mileage_entries alter column property_id drop not null;
alter table public.mileage_entries add constraint mileage_entries_property_id_fkey
  foreign key (property_id) references public.properties(id) on delete set null;

-- Defense in depth: internal tables are never directly available to anon/PUBLIC.
revoke all on table
  public.user_profiles,
  public.clients, public.properties, public.estimates, public.walkthroughs,
  public.proposals, public.proposal_history, public.jobs,
  public.employees, public.crews, public.crew_members,
  public.invoices, public.payments, public.expenses,
  public.vehicles, public.mileage_entries, public.time_entries,
  public.service_agreements, public.service_occurrences,
  public.services, public.service_price_tiers, public.service_addons,
  public.service_addon_links, public.recurring_pricing_rules,
  public.business_settings, public.client_communications,
  public.attention_item_states
from public, anon;

-- Owner-executed projection views remain explicitly authenticated-only.
revoke all on table
  public.employee_directory_safe, public.jobs_operational_safe,
  public.time_entries_operational_safe, public.crew_directory_safe,
  public.crew_members_directory_safe, public.business_settings_public,
  public.business_settings_workflow
from public, anon;

-- Permanent deletion must go through the archived-only, dependency-aware RPC.
revoke delete on table
  public.clients, public.properties, public.estimates, public.walkthroughs,
  public.proposals, public.jobs, public.employees, public.crews,
  public.invoices, public.expenses, public.vehicles, public.mileage_entries,
  public.time_entries, public.service_agreements, public.services,
  public.service_addons
from authenticated;

drop policy if exists "Master Admin delete archived" on public.clients;
drop policy if exists "Master Admin delete archived" on public.properties;
drop policy if exists "Master Admin delete archived" on public.estimates;
drop policy if exists "Master Admin delete archived" on public.walkthroughs;
drop policy if exists "Master Admin delete archived" on public.proposals;
drop policy if exists "Master Admin delete archived" on public.jobs;
drop policy if exists "Master Admin delete archived" on public.employees;
drop policy if exists "Master Admin delete archived" on public.crews;
drop policy if exists "Master Admin delete archived" on public.invoices;
drop policy if exists "Master Admin delete archived" on public.expenses;
drop policy if exists "Master Admin delete archived" on public.vehicles;
drop policy if exists "Master Admin delete archived" on public.mileage_entries;
drop policy if exists "Master Admin delete archived" on public.time_entries;
drop policy if exists "Master Admin delete archived" on public.service_agreements;
drop policy if exists "Master Admin delete archived" on public.services;
drop policy if exists "Master Admin delete archived" on public.service_addons;

revoke all on function public.master_admin_permanently_delete_archived_record(text, uuid)
from public, anon, authenticated;
grant execute on function public.master_admin_permanently_delete_archived_record(text, uuid)
to authenticated;
