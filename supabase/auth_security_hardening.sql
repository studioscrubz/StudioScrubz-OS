-- Phase 17 Stage B: FINAL SECURITY HARDENING. REVIEW ONLY. DO NOT RUN
-- until Stage A login/profile behavior has been manually verified end-to-end.

create or replace function public.is_master_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_profiles
    where id = (select auth.uid()) and role = 'Master Admin' and is_active = true
  );
$$;
revoke all on function public.is_master_admin() from public, anon;
grant execute on function public.is_master_admin() to authenticated;

alter table public.clients enable row level security;
alter table public.properties enable row level security;
alter table public.estimates enable row level security;
alter table public.walkthroughs enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_history enable row level security;
alter table public.jobs enable row level security;
alter table public.employees enable row level security;
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.vehicles enable row level security;
alter table public.mileage_entries enable row level security;
alter table public.time_entries enable row level security;
alter table public.service_agreements enable row level security;
alter table public.service_occurrences enable row level security;

-- Remove only the known temporary/development policies created during Phases 1-16.
-- These explicit names ensure future role policies survive if Stage B is rerun.
drop policy if exists "Authenticated users can read clients" on public.clients;
drop policy if exists "Authenticated users can create clients" on public.clients;
drop policy if exists "Authenticated users can update clients" on public.clients;
drop policy if exists "Authenticated users can read properties" on public.properties;
drop policy if exists "Authenticated users can create properties" on public.properties;
drop policy if exists "Authenticated users can update properties" on public.properties;
drop policy if exists "Authenticated users can read estimates" on public.estimates;
drop policy if exists "Authenticated users can create estimates" on public.estimates;
drop policy if exists "Authenticated users can update estimates" on public.estimates;
drop policy if exists "Temporary walkthrough read access" on public.walkthroughs;
drop policy if exists "Temporary walkthrough create access" on public.walkthroughs;
drop policy if exists "Temporary walkthrough update access" on public.walkthroughs;
drop policy if exists "Temporary proposal read" on public.proposals;
drop policy if exists "Temporary proposal create" on public.proposals;
drop policy if exists "Temporary proposal update" on public.proposals;
drop policy if exists "Temporary proposal history read" on public.proposal_history;
drop policy if exists "Temporary proposal history append" on public.proposal_history;
drop policy if exists "Temporary job read" on public.jobs;
drop policy if exists "Temporary job create" on public.jobs;
drop policy if exists "Temporary job update" on public.jobs;
drop policy if exists "Temporary employees read" on public.employees;
drop policy if exists "Temporary employees create" on public.employees;
drop policy if exists "Temporary employees update" on public.employees;
drop policy if exists "Temporary crews read" on public.crews;
drop policy if exists "Temporary crews create" on public.crews;
drop policy if exists "Temporary crews update" on public.crews;
drop policy if exists "Temporary crew members read" on public.crew_members;
drop policy if exists "Temporary crew members add" on public.crew_members;
drop policy if exists "Temporary crew members remove" on public.crew_members;
drop policy if exists "Temporary invoice read" on public.invoices;
drop policy if exists "Temporary invoice create" on public.invoices;
drop policy if exists "Temporary invoice update" on public.invoices;
drop policy if exists "Temporary payment read" on public.payments;
drop policy if exists "Temporary payment create" on public.payments;
drop policy if exists "Temporary expense read" on public.expenses;
drop policy if exists "Temporary expense create" on public.expenses;
drop policy if exists "Temporary expense update" on public.expenses;
drop policy if exists "vehicles development select" on public.vehicles;
drop policy if exists "vehicles development insert" on public.vehicles;
drop policy if exists "vehicles development update" on public.vehicles;
drop policy if exists "mileage development select" on public.mileage_entries;
drop policy if exists "mileage development insert" on public.mileage_entries;
drop policy if exists "mileage development update" on public.mileage_entries;
drop policy if exists "time entries development select" on public.time_entries;
drop policy if exists "time entries development insert" on public.time_entries;
drop policy if exists "time entries development update" on public.time_entries;
drop policy if exists "agreement dev read" on public.service_agreements;
drop policy if exists "agreement dev insert" on public.service_agreements;
drop policy if exists "agreement dev update" on public.service_agreements;
drop policy if exists "occurrence dev read" on public.service_occurrences;
drop policy if exists "occurrence dev insert" on public.service_occurrences;
drop policy if exists "occurrence dev update" on public.service_occurrences;

revoke all on public.clients, public.properties, public.estimates, public.walkthroughs,
  public.proposals, public.proposal_history, public.jobs, public.employees, public.crews,
  public.crew_members, public.invoices, public.payments, public.expenses, public.vehicles,
  public.mileage_entries, public.time_entries, public.service_agreements,
  public.service_occurrences from public, anon;

grant select, insert, update on public.clients, public.properties, public.estimates,
  public.walkthroughs, public.proposals, public.jobs, public.employees, public.crews,
  public.invoices, public.expenses, public.vehicles, public.mileage_entries,
  public.time_entries, public.service_agreements, public.service_occurrences to authenticated;
grant select, insert on public.proposal_history to authenticated;
grant select on public.payments to authenticated;
grant select, insert, delete on public.crew_members to authenticated;

-- Master Admin CRUD policies, excluding DELETE (handled separately and only for archives).
do $$
declare t text;
begin
  foreach t in array array[
    'clients','properties','estimates','walkthroughs','proposals','jobs','employees','crews',
    'invoices','expenses','vehicles','mileage_entries','time_entries','service_agreements','service_occurrences'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'Master Admin read', t);
    execute format('drop policy if exists %I on public.%I', 'Master Admin insert', t);
    execute format('drop policy if exists %I on public.%I', 'Master Admin update', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_master_admin()))', 'Master Admin read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_master_admin()))', 'Master Admin insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.is_master_admin())) with check ((select public.is_master_admin()))', 'Master Admin update', t);
  end loop;
end $$;

drop policy if exists "Master Admin history read" on public.proposal_history;
drop policy if exists "Master Admin history insert" on public.proposal_history;
drop policy if exists "Master Admin payments read" on public.payments;
drop policy if exists "Master Admin payments insert" on public.payments;
drop policy if exists "Master Admin crew members read" on public.crew_members;
drop policy if exists "Master Admin crew members insert" on public.crew_members;
drop policy if exists "Master Admin crew members delete" on public.crew_members;
create policy "Master Admin history read" on public.proposal_history for select to authenticated using ((select public.is_master_admin()));
create policy "Master Admin history insert" on public.proposal_history for insert to authenticated with check ((select public.is_master_admin()));
create policy "Master Admin payments read" on public.payments for select to authenticated using ((select public.is_master_admin()));
create policy "Master Admin crew members read" on public.crew_members for select to authenticated using ((select public.is_master_admin()));
create policy "Master Admin crew members insert" on public.crew_members for insert to authenticated with check ((select public.is_master_admin()));
create policy "Master Admin crew members delete" on public.crew_members for delete to authenticated using ((select public.is_master_admin()));

-- Permanent deletion is authenticated, role-derived from auth.uid(), and archived-only.
-- Cascade parents remain blocked from direct Data API DELETE:
-- proposals -> proposal_history, crews -> crew_members, and
-- service_agreements -> service_occurrences. A future security-definer RPC must
-- perform explicit history/dependency checks before any deletion of those parents.
revoke delete on public.proposals, public.crews, public.service_agreements from authenticated;
grant delete on public.clients, public.properties, public.estimates, public.walkthroughs,
  public.jobs, public.employees, public.invoices,
  public.expenses, public.vehicles, public.mileage_entries, public.time_entries to authenticated;
do $$
declare t text;
begin
  foreach t in array array[
    'clients','properties','estimates','walkthroughs','jobs','employees',
    'invoices','expenses','vehicles','mileage_entries','time_entries'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'Master Admin delete archived', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.is_master_admin()) and archived_at is not null)', 'Master Admin delete archived', t);
  end loop;
end $$;

-- Profiles fail closed. Users read themselves; Master Admin may read profiles for future administration.
drop policy if exists "Users read own profile" on public.user_profiles;
drop policy if exists "Master Admin reads profiles" on public.user_profiles;
create policy "Users read own profile" on public.user_profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Master Admin reads profiles" on public.user_profiles for select to authenticated using ((select public.is_master_admin()));
revoke all on public.user_profiles from public, anon;
revoke insert, update, delete on public.user_profiles from authenticated;
grant select on public.user_profiles to authenticated;
