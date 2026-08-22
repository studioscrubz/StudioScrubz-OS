-- StudioScrubz OS: detachable historical relationships for permanent archive deletion.
-- REVIEW ONLY. Do not execute automatically.
-- Retained business/history rows survive parent deletion; only their relationship is cleared.

begin;

-- Client relationships.
alter table public.properties drop constraint if exists properties_client_id_fkey;
alter table public.properties alter column client_id drop not null;
alter table public.properties add constraint properties_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null;
alter table public.estimates drop constraint if exists estimates_client_id_fkey;
alter table public.estimates alter column client_id drop not null;
alter table public.estimates add constraint estimates_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null;
alter table public.walkthroughs drop constraint if exists walkthroughs_client_id_fkey;
alter table public.walkthroughs alter column client_id drop not null;
alter table public.walkthroughs add constraint walkthroughs_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null;
alter table public.proposals drop constraint if exists proposals_client_id_fkey;
alter table public.proposals alter column client_id drop not null;
alter table public.proposals add constraint proposals_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null;
alter table public.jobs drop constraint if exists jobs_client_id_fkey;
alter table public.jobs alter column client_id drop not null;
alter table public.jobs add constraint jobs_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null;
alter table public.invoices drop constraint if exists invoices_client_id_fkey;
alter table public.invoices alter column client_id drop not null;
alter table public.invoices add constraint invoices_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null;
alter table public.payments drop constraint if exists payments_client_id_fkey;
alter table public.payments alter column client_id drop not null;
alter table public.payments add constraint payments_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null;
alter table public.service_agreements drop constraint if exists service_agreements_client_id_fkey;
alter table public.service_agreements alter column client_id drop not null;
alter table public.service_agreements add constraint service_agreements_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null;

-- Property relationships.
alter table public.estimates drop constraint if exists estimates_property_id_fkey;
alter table public.estimates alter column property_id drop not null;
alter table public.estimates add constraint estimates_property_id_fkey foreign key (property_id) references public.properties(id) on delete set null;
alter table public.walkthroughs drop constraint if exists walkthroughs_property_id_fkey;
alter table public.walkthroughs alter column property_id drop not null;
alter table public.walkthroughs add constraint walkthroughs_property_id_fkey foreign key (property_id) references public.properties(id) on delete set null;
alter table public.proposals drop constraint if exists proposals_property_id_fkey;
alter table public.proposals alter column property_id drop not null;
alter table public.proposals add constraint proposals_property_id_fkey foreign key (property_id) references public.properties(id) on delete set null;
alter table public.jobs drop constraint if exists jobs_property_id_fkey;
alter table public.jobs alter column property_id drop not null;
alter table public.jobs add constraint jobs_property_id_fkey foreign key (property_id) references public.properties(id) on delete set null;
alter table public.invoices drop constraint if exists invoices_property_id_fkey;
alter table public.invoices alter column property_id drop not null;
alter table public.invoices add constraint invoices_property_id_fkey foreign key (property_id) references public.properties(id) on delete set null;
alter table public.service_agreements drop constraint if exists service_agreements_property_id_fkey;
alter table public.service_agreements alter column property_id drop not null;
alter table public.service_agreements add constraint service_agreements_property_id_fkey foreign key (property_id) references public.properties(id) on delete set null;

-- Estimate and Walkthrough historical links.
alter table public.walkthroughs drop constraint if exists walkthroughs_estimate_id_fkey;
alter table public.walkthroughs add constraint walkthroughs_estimate_id_fkey foreign key (estimate_id) references public.estimates(id) on delete set null;
alter table public.proposals drop constraint if exists proposals_estimate_id_fkey;
alter table public.proposals add constraint proposals_estimate_id_fkey foreign key (estimate_id) references public.estimates(id) on delete set null;
alter table public.jobs drop constraint if exists jobs_estimate_id_fkey;
alter table public.jobs add constraint jobs_estimate_id_fkey foreign key (estimate_id) references public.estimates(id) on delete set null;
alter table public.proposals drop constraint if exists proposals_walkthrough_id_fkey;
alter table public.proposals add constraint proposals_walkthrough_id_fkey foreign key (walkthrough_id) references public.walkthroughs(id) on delete set null;
alter table public.jobs drop constraint if exists jobs_walkthrough_id_fkey;
alter table public.jobs add constraint jobs_walkthrough_id_fkey foreign key (walkthrough_id) references public.walkthroughs(id) on delete set null;

-- Proposal links; proposal_history remains subordinate and is explicitly removed by the RPC.
alter table public.jobs drop constraint if exists jobs_proposal_id_fkey;
alter table public.jobs alter column proposal_id drop not null;
alter table public.jobs add constraint jobs_proposal_id_fkey foreign key (proposal_id) references public.proposals(id) on delete set null;
alter table public.invoices drop constraint if exists invoices_proposal_id_fkey;
alter table public.invoices add constraint invoices_proposal_id_fkey foreign key (proposal_id) references public.proposals(id) on delete set null;
alter table public.service_agreements drop constraint if exists service_agreements_proposal_id_fkey;
alter table public.service_agreements add constraint service_agreements_proposal_id_fkey foreign key (proposal_id) references public.proposals(id) on delete set null;

-- Job links retain financial, mileage, time, and occurrence history.
alter table public.invoices drop constraint if exists invoices_job_id_fkey;
alter table public.invoices alter column job_id drop not null;
alter table public.invoices add constraint invoices_job_id_fkey foreign key (job_id) references public.jobs(id) on delete set null;
alter table public.payments drop constraint if exists payments_job_id_fkey;
alter table public.payments add constraint payments_job_id_fkey foreign key (job_id) references public.jobs(id) on delete set null;
alter table public.expenses drop constraint if exists expenses_job_id_fkey;
alter table public.expenses add constraint expenses_job_id_fkey foreign key (job_id) references public.jobs(id) on delete set null;
alter table public.mileage_entries drop constraint if exists mileage_entries_job_id_fkey;
alter table public.mileage_entries add constraint mileage_entries_job_id_fkey foreign key (job_id) references public.jobs(id) on delete set null;
alter table public.time_entries drop constraint if exists time_entries_job_id_fkey;
alter table public.time_entries add constraint time_entries_job_id_fkey foreign key (job_id) references public.jobs(id) on delete set null;
alter table public.service_occurrences drop constraint if exists service_occurrences_job_id_fkey;
alter table public.service_occurrences add constraint service_occurrences_job_id_fkey foreign key (job_id) references public.jobs(id) on delete set null;
alter table public.jobs drop constraint if exists jobs_service_occurrence_id_fkey;
alter table public.jobs add constraint jobs_service_occurrence_id_fkey foreign key (service_occurrence_id) references public.service_occurrences(id) on delete set null;

-- Employee links; Auth profiles survive and fail closed when employee_id becomes null.
alter table public.crew_members drop constraint if exists crew_members_employee_id_fkey;
alter table public.crew_members add constraint crew_members_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete cascade;
alter table public.time_entries drop constraint if exists time_entries_employee_id_fkey;
alter table public.time_entries alter column employee_id drop not null;
alter table public.time_entries add constraint time_entries_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete set null;

-- Invoice and Vehicle links retain financial/mileage history.
alter table public.payments drop constraint if exists payments_invoice_id_fkey;
alter table public.payments alter column invoice_id drop not null;
alter table public.payments add constraint payments_invoice_id_fkey foreign key (invoice_id) references public.invoices(id) on delete restrict;
alter table public.mileage_entries drop constraint if exists mileage_entries_vehicle_id_fkey;
alter table public.mileage_entries alter column vehicle_id drop not null;
alter table public.mileage_entries add constraint mileage_entries_vehicle_id_fkey foreign key (vehicle_id) references public.vehicles(id) on delete set null;

-- Ensure already-nullable operational relationships consistently detach retained rows.
alter table public.crews drop constraint if exists crews_crew_lead_id_fkey;
alter table public.crews add constraint crews_crew_lead_id_fkey foreign key (crew_lead_id) references public.employees(id) on delete set null;
alter table public.expenses drop constraint if exists expenses_employee_id_fkey;
alter table public.expenses add constraint expenses_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete set null;
alter table public.vehicles drop constraint if exists vehicles_assigned_employee_id_fkey;
alter table public.vehicles add constraint vehicles_assigned_employee_id_fkey foreign key (assigned_employee_id) references public.employees(id) on delete set null;
alter table public.mileage_entries drop constraint if exists mileage_entries_employee_id_fkey;
alter table public.mileage_entries add constraint mileage_entries_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete set null;
alter table public.user_profiles drop constraint if exists user_profiles_employee_id_fkey;
alter table public.user_profiles add constraint user_profiles_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete set null;

alter table public.jobs drop constraint if exists jobs_assigned_crew_id_fkey;
alter table public.jobs add constraint jobs_assigned_crew_id_fkey foreign key (assigned_crew_id) references public.crews(id) on delete set null;
alter table public.vehicles drop constraint if exists vehicles_assigned_crew_id_fkey;
alter table public.vehicles add constraint vehicles_assigned_crew_id_fkey foreign key (assigned_crew_id) references public.crews(id) on delete set null;
alter table public.mileage_entries drop constraint if exists mileage_entries_crew_id_fkey;
alter table public.mileage_entries add constraint mileage_entries_crew_id_fkey foreign key (crew_id) references public.crews(id) on delete set null;
alter table public.time_entries drop constraint if exists time_entries_crew_id_fkey;
alter table public.time_entries add constraint time_entries_crew_id_fkey foreign key (crew_id) references public.crews(id) on delete set null;
alter table public.service_agreements drop constraint if exists service_agreements_assigned_crew_id_fkey;
alter table public.service_agreements add constraint service_agreements_assigned_crew_id_fkey foreign key (assigned_crew_id) references public.crews(id) on delete set null;
alter table public.service_occurrences drop constraint if exists service_occurrences_assigned_crew_id_fkey;
alter table public.service_occurrences add constraint service_occurrences_assigned_crew_id_fkey foreign key (assigned_crew_id) references public.crews(id) on delete set null;

-- Preserve operational visibility for historical Time Entries after Employee deletion.
-- This owner-executed projection remains row-scoped by auth-derived helpers and omits all pay/rate columns.
create or replace view public.time_entries_operational_safe with (security_barrier = true) as
select
  t.id,
  t.time_entry_number,
  t.employee_id,
  t.job_id,
  t.crew_id,
  t.work_date,
  t.clock_in,
  t.clock_out,
  t.break_minutes,
  t.regular_hours,
  t.overtime_hours,
  t.total_hours,
  t.entry_type,
  t.notes,
  t.status,
  t.approved_at,
  t.approved_by,
  t.created_at,
  t.updated_at,
  t.archived_at,
  coalesce(e.employee_number, 'Deleted Employee') as employee_number,
  coalesce(
    e.preferred_name,
    nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''),
    'Deleted Employee'
  ) as employee_name,
  j.job_number,
  c.crew_name
from public.time_entries t
left join public.employees e on e.id = t.employee_id
left join public.jobs j on j.id = t.job_id
left join public.crews c on c.id = t.crew_id
where public.has_any_role(array['Master Admin', 'Administrator', 'Manager'])
   or t.employee_id = public.current_employee_id()
   or public.is_assigned_to_crew(t.crew_id);

revoke all on public.time_entries_operational_safe from public, anon, authenticated;
grant select on public.time_entries_operational_safe to authenticated;

commit;
