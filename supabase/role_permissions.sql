-- Phase 18: role permissions and user administration. REVIEW ONLY. DO NOT RUN.
-- Apply only after Phase 17 Stage B has been reviewed, applied, and verified.

alter table public.user_profiles add column if not exists employee_id uuid null;
do $$ begin
  alter table public.user_profiles add constraint user_profiles_employee_id_fkey
    foreign key (employee_id) references public.employees(id) on delete set null;
exception when duplicate_object then null; end $$;
create unique index if not exists user_profiles_employee_id_unique_idx
  on public.user_profiles(employee_id) where employee_id is not null;

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.user_profiles
  where id = (select auth.uid()) and is_active = true
$$;
create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select employee_id from public.user_profiles
  where id = (select auth.uid()) and is_active = true
$$;
create or replace function public.has_role(p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_role() = p_role, false)
$$;
create or replace function public.has_any_role(p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_role() = any(p_roles), false)
$$;
create or replace function public.is_assigned_to_crew(p_crew_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.crews c where c.id = p_crew_id
      and (c.crew_lead_id = public.current_employee_id() or exists (
        select 1 from public.crew_members cm where cm.crew_id = c.id
          and cm.employee_id = public.current_employee_id()
      ))
  )
$$;
create or replace function public.can_access_client_from_assigned_job(p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and public.current_employee_id() is not null and exists (
    select 1 from public.jobs j
    where j.client_id = p_client_id and j.archived_at is null
      and public.is_assigned_to_crew(j.assigned_crew_id)
  )
$$;
create or replace function public.can_access_property_from_assigned_job(p_property_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and public.current_employee_id() is not null and exists (
    select 1 from public.jobs j
    where j.property_id = p_property_id and j.archived_at is null
      and public.is_assigned_to_crew(j.assigned_crew_id)
  )
$$;

revoke all on function public.current_user_role() from public, anon;
revoke all on function public.current_employee_id() from public, anon;
revoke all on function public.has_role(text) from public, anon;
revoke all on function public.has_any_role(text[]) from public, anon;
revoke all on function public.is_assigned_to_crew(uuid) from public, anon;
revoke all on function public.can_access_client_from_assigned_job(uuid) from public, anon;
revoke all on function public.can_access_property_from_assigned_job(uuid) from public, anon;
grant execute on function public.current_user_role(), public.current_employee_id(), public.has_role(text), public.has_any_role(text[]), public.is_assigned_to_crew(uuid), public.can_access_client_from_assigned_job(uuid), public.can_access_property_from_assigned_job(uuid) to authenticated;

-- Master-Admin-only profile administration. Auth identities remain manually created.
create or replace function public.admin_create_user_profile(
  p_auth_user_id uuid, p_email text, p_display_name text, p_role text,
  p_employee_id uuid default null, p_is_active boolean default true
) returns public.user_profiles language plpgsql security definer set search_path = '' as $$
declare auth_email text; result public.user_profiles;
begin
  if not public.is_master_admin() then raise exception 'Master Admin access required'; end if;
  if p_role not in ('Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician') then raise exception 'Invalid role'; end if;
  select email into auth_email from auth.users where id = p_auth_user_id;
  if auth_email is null then raise exception 'Auth user was not found. Create the user in Supabase Authentication first.'; end if;
  if lower(auth_email) <> lower(trim(p_email)) then raise exception 'Auth user email does not match.'; end if;
  insert into public.user_profiles(id,email,display_name,role,employee_id,is_active)
  values(p_auth_user_id,auth_email,nullif(trim(p_display_name),''),p_role,p_employee_id,p_is_active)
  returning * into result;
  return result;
end $$;

create or replace function public.admin_update_user_profile(
  p_profile_id uuid, p_display_name text, p_role text,
  p_employee_id uuid default null, p_is_active boolean default true
) returns public.user_profiles language plpgsql security definer set search_path = '' as $$
declare current_profile public.user_profiles; result public.user_profiles; active_admins integer;
begin
  if not public.is_master_admin() then raise exception 'Master Admin access required'; end if;
  if p_role not in ('Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician') then raise exception 'Invalid role'; end if;
  perform pg_advisory_xact_lock(hashtext('studioscrubz-active-master-admin'));
  select * into current_profile from public.user_profiles where id = p_profile_id for update;
  if not found then raise exception 'User profile not found'; end if;
  if current_profile.role = 'Master Admin' and current_profile.is_active
     and (p_role <> 'Master Admin' or not p_is_active) then
    select count(*) into active_admins from public.user_profiles where role = 'Master Admin' and is_active = true;
    if active_admins <= 1 then raise exception 'At least one active Master Admin is required.'; end if;
  end if;
  update public.user_profiles set display_name=nullif(trim(p_display_name),''), role=p_role,
    employee_id=p_employee_id, is_active=p_is_active where id=p_profile_id returning * into result;
  return result;
end $$;

create or replace function public.admin_set_user_active(p_profile_id uuid, p_is_active boolean)
returns public.user_profiles language plpgsql security definer set search_path = '' as $$
declare target public.user_profiles;
begin
  if not public.is_master_admin() then raise exception 'Master Admin access required'; end if;
  select * into target from public.user_profiles where id=p_profile_id;
  if not found then raise exception 'User profile not found'; end if;
  return public.admin_update_user_profile(target.id,coalesce(target.display_name,''),target.role,target.employee_id,p_is_active);
end $$;

revoke all on function public.admin_create_user_profile(uuid,text,text,text,uuid,boolean) from public, anon;
revoke all on function public.admin_update_user_profile(uuid,text,text,uuid,boolean) from public, anon;
revoke all on function public.admin_set_user_active(uuid,boolean) from public, anon;
grant execute on function public.admin_create_user_profile(uuid,text,text,text,uuid,boolean), public.admin_update_user_profile(uuid,text,text,uuid,boolean), public.admin_set_user_active(uuid,boolean) to authenticated;

-- Full user-profile rows remain readable only by the profile owner or Master Admin.
drop policy if exists "Master Admin manages profile list" on public.user_profiles;
create policy "Master Admin manages profile list" on public.user_profiles for select to authenticated using (public.is_master_admin());

-- Operational table policies. Existing Stage B Master Admin policies remain intact.
drop policy if exists "Operations clients read" on public.clients;
drop policy if exists "Operations clients create" on public.clients;
drop policy if exists "Operations clients update" on public.clients;
create policy "Operations clients read" on public.clients for select to authenticated using (
  public.has_any_role(array['Administrator','Manager','Sales'])
  or (public.has_any_role(array['Crew Lead','Scrub Technician']) and public.can_access_client_from_assigned_job(clients.id)));
create policy "Operations clients create" on public.clients for insert to authenticated with check (public.has_any_role(array['Administrator','Manager','Sales']));
create policy "Operations clients update" on public.clients for update to authenticated
  using (public.has_any_role(array['Administrator','Manager','Sales'])) with check (public.has_any_role(array['Administrator','Manager','Sales']));

drop policy if exists "Operations properties read" on public.properties;
drop policy if exists "Operations properties create" on public.properties;
drop policy if exists "Operations properties update" on public.properties;
create policy "Operations properties read" on public.properties for select to authenticated using (
  public.has_any_role(array['Administrator','Manager','Sales'])
  or (public.has_any_role(array['Crew Lead','Scrub Technician']) and public.can_access_property_from_assigned_job(properties.id)));
create policy "Operations properties create" on public.properties for insert to authenticated with check (public.has_any_role(array['Administrator','Manager','Sales']));
create policy "Operations properties update" on public.properties for update to authenticated
  using (public.has_any_role(array['Administrator','Manager','Sales'])) with check (public.has_any_role(array['Administrator','Manager','Sales']));

do $$ declare t text; begin
  foreach t in array array['estimates','walkthroughs'] loop
    execute format('drop policy if exists %I on public.%I','Sales operations read',t);
    execute format('drop policy if exists %I on public.%I','Sales operations write',t);
    execute format('drop policy if exists %I on public.%I','Sales operations update',t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_any_role(array[''Administrator'',''Manager'',''Sales'']))','Sales operations read',t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_any_role(array[''Administrator'',''Manager'',''Sales'']))','Sales operations write',t);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_any_role(array[''Administrator'',''Manager'',''Sales''])) with check (public.has_any_role(array[''Administrator'',''Manager'',''Sales'']))','Sales operations update',t);
  end loop;
end $$;

drop policy if exists "Proposal role read" on public.proposals;
drop policy if exists "Proposal role create" on public.proposals;
drop policy if exists "Proposal role update" on public.proposals;
drop policy if exists "Proposal role history append" on public.proposal_history;
create policy "Proposal role read" on public.proposals for select to authenticated using (public.has_any_role(array['Administrator','Manager','Sales']));
create policy "Proposal role create" on public.proposals for insert to authenticated with check (public.has_any_role(array['Administrator','Manager','Sales']));
create policy "Proposal role update" on public.proposals for update to authenticated using (public.has_any_role(array['Administrator','Manager','Sales'])) with check (public.has_any_role(array['Administrator','Manager','Sales']));
create policy "Proposal role history append" on public.proposal_history for insert to authenticated
  with check (public.has_any_role(array['Administrator','Manager','Sales']));

-- RLS cannot protect individual columns, so block non-Master approval-field escalation.
create or replace function public.protect_proposal_approval_fields() returns trigger
language plpgsql security invoker set search_path = '' as $$ begin
  if public.is_master_admin() then return new; end if;
  if TG_OP = 'INSERT' then
    if new.approval_status = 'Approved' or new.approved_at is not null or new.approved_by is not null
      or new.approval_notes is not null or new.status in ('Approved','Accepted') or new.accepted = true
      or new.accepted_at is not null or new.accepted_by_name is not null or new.acceptance_method is not null
    then raise exception 'Only Master Admin may set proposal approval or acceptance fields'; end if;
  elsif ((new.approval_status = 'Approved' or old.approval_status = 'Approved') and new.approval_status is distinct from old.approval_status)
    or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by
    or new.approval_notes is distinct from old.approval_notes
    or (new.status in ('Approved','Accepted') and new.status is distinct from old.status)
    or (old.status in ('Approved','Accepted') and new.status is distinct from old.status)
    or new.accepted is distinct from old.accepted or new.accepted_at is distinct from old.accepted_at
    or new.accepted_by_name is distinct from old.accepted_by_name or new.acceptance_method is distinct from old.acceptance_method
  then raise exception 'Only Master Admin may change proposal approval or acceptance fields'; end if;
  return new;
end $$;
revoke all on function public.protect_proposal_approval_fields() from public, anon, authenticated;
drop trigger if exists proposals_protect_approval_fields on public.proposals;
create trigger proposals_protect_approval_fields before insert or update on public.proposals for each row execute function public.protect_proposal_approval_fields();

drop policy if exists "Agreement role read" on public.service_agreements;
drop policy if exists "Agreement role create" on public.service_agreements;
drop policy if exists "Agreement role update" on public.service_agreements;
create policy "Agreement role read" on public.service_agreements for select to authenticated using (public.has_any_role(array['Administrator','Manager','Sales']));
create policy "Agreement role create" on public.service_agreements for insert to authenticated with check (public.has_any_role(array['Administrator','Manager','Sales']));
create policy "Agreement role update" on public.service_agreements for update to authenticated using (public.has_any_role(array['Administrator','Manager','Sales'])) with check (public.has_any_role(array['Administrator','Manager','Sales']));
drop policy if exists "Occurrence role read" on public.service_occurrences;
drop policy if exists "Occurrence role create" on public.service_occurrences;
drop policy if exists "Occurrence role update" on public.service_occurrences;
create policy "Occurrence role read" on public.service_occurrences for select to authenticated using (public.has_any_role(array['Administrator','Manager','Sales']));
create policy "Occurrence role create" on public.service_occurrences for insert to authenticated with check (public.has_any_role(array['Administrator','Manager','Sales']));
create policy "Occurrence role update" on public.service_occurrences for update to authenticated using (public.has_any_role(array['Administrator','Manager','Sales'])) with check (public.has_any_role(array['Administrator','Manager','Sales']));

drop policy if exists "Invoice operations read" on public.invoices;
drop policy if exists "Invoice administrator create" on public.invoices;
drop policy if exists "Invoice administrator update" on public.invoices;
create policy "Invoice operations read" on public.invoices for select to authenticated using (public.has_any_role(array['Administrator','Manager']));
create policy "Invoice administrator create" on public.invoices for insert to authenticated with check (public.has_role('Administrator'));
create policy "Invoice administrator update" on public.invoices for update to authenticated using (public.has_role('Administrator')) with check (public.has_role('Administrator'));

-- Limited operational views deliberately omit employee pay and job financial columns.
-- These are deliberately owner-executed, security-barrier projection views. Each view
-- contains its own auth.uid()-derived row predicate and exposes no sensitive columns.
-- Mutations never occur through views; the scoped RPCs below enforce every write.
create or replace view public.employee_directory_safe with (security_barrier=true) as
select id,employee_number,first_name,last_name,preferred_name,email,phone,department,job_title,
  employment_status,employment_type,hire_date,notes,created_at,updated_at,archived_at
from public.employees e where public.has_any_role(array['Master Admin','Administrator','Manager'])
  or e.id=public.current_employee_id()
  or exists (
    select 1 from public.crews c where public.is_assigned_to_crew(c.id)
      and (c.crew_lead_id=e.id or exists(select 1 from public.crew_members cm where cm.crew_id=c.id and cm.employee_id=e.id))
  );
create or replace view public.jobs_operational_safe with (security_barrier=true) as
select id,job_number,proposal_id,service_occurrence_id,estimate_id,walkthrough_id,client_id,property_id,
  division,client_name,property_name,service_name,frequency,status,scheduled_date,start_time,
  estimated_duration,assigned_crew_id,assigned_crew_name,crew_lead_name,assigned_team,scope,checklist,
  access_instructions,internal_notes,completed_at,created_at,updated_at,archived_at
from public.jobs
where public.has_any_role(array['Master Admin','Administrator','Manager'])
   or public.is_assigned_to_crew(assigned_crew_id);
create or replace view public.time_entries_operational_safe with (security_barrier=true) as
select t.id,t.time_entry_number,t.employee_id,t.job_id,t.crew_id,t.work_date,t.clock_in,t.clock_out,t.break_minutes,
  t.regular_hours,t.overtime_hours,t.total_hours,t.entry_type,t.notes,t.status,t.approved_at,t.approved_by,
  t.created_at,t.updated_at,t.archived_at,coalesce(e.employee_number,'Deleted Employee') as employee_number,
  coalesce(e.preferred_name,nullif(trim(coalesce(e.first_name,'')||' '||coalesce(e.last_name,'')),''),'Deleted Employee') as employee_name,
  j.job_number,c.crew_name
from public.time_entries t left join public.employees e on e.id=t.employee_id
left join public.jobs j on j.id=t.job_id left join public.crews c on c.id=t.crew_id
where public.has_any_role(array['Master Admin','Administrator','Manager'])
   or t.employee_id=public.current_employee_id()
   or public.is_assigned_to_crew(t.crew_id);
create or replace view public.crew_directory_safe with (security_barrier=true) as
select c.id,c.crew_name,c.crew_lead_id,c.status,c.notes,c.created_at,c.updated_at,c.archived_at
from public.crews c
where public.has_any_role(array['Master Admin','Administrator','Manager']) or public.is_assigned_to_crew(c.id);
create or replace view public.crew_members_directory_safe with (security_barrier=true) as
select cm.id,cm.crew_id,cm.employee_id,cm.created_at,e.employee_number,e.first_name,e.last_name,
  e.preferred_name,e.email,e.phone,e.department,e.job_title,e.employment_status,e.employment_type,
  e.hire_date,e.notes,e.created_at as employee_created_at,e.updated_at as employee_updated_at,e.archived_at as employee_archived_at
from public.crew_members cm join public.employees e on e.id=cm.employee_id
where public.has_any_role(array['Master Admin','Administrator','Manager']) or public.is_assigned_to_crew(cm.crew_id);
revoke all on public.employee_directory_safe, public.jobs_operational_safe, public.time_entries_operational_safe from public, anon, authenticated;
grant select on public.employee_directory_safe, public.jobs_operational_safe, public.time_entries_operational_safe to authenticated;
revoke all on public.crew_directory_safe, public.crew_members_directory_safe from public, anon, authenticated;
grant select on public.crew_directory_safe, public.crew_members_directory_safe to authenticated;

-- Scoped Job reads and mutations. Financial columns are never returned or accepted.
-- Explicit drops make the return-type hardening rerunnable over an earlier Phase 18 draft.
drop function if exists public.save_operational_time_entry(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,integer,text);
drop function if exists public.review_operational_time_entry(uuid,text,text);
drop function if exists public.clock_out_operational(uuid,timestamptz,integer);
drop function if exists public.clock_in_operational(uuid,uuid,uuid,text,timestamptz,text);
drop function if exists public.update_operational_job(uuid,date,time,numeric,uuid,text,text);
drop function if exists public.admin_operational_create_employee(text,text,text,text,text,text,text,text,text,text,date,text);
drop function if exists public.admin_operational_update_employee(uuid,text,text,text,text,text,text,text,text,text,date,text,boolean);
drop function if exists public.manage_operational_crew(uuid,text,uuid,text,text,boolean);
drop function if exists public.add_operational_crew_member(uuid,uuid);
drop function if exists public.remove_operational_crew_member(uuid);

create or replace function public.get_operational_jobs(p_start date default null, p_end date default null)
returns setof public.jobs_operational_safe language sql stable security definer set search_path='' as $$
  select * from public.jobs_operational_safe j
  where (p_start is null or j.scheduled_date >= p_start) and (p_end is null or j.scheduled_date <= p_end)
  order by j.created_at desc
$$;
create or replace function public.update_operational_job(
  p_job_id uuid, p_scheduled_date date default null, p_start_time time default null,
  p_estimated_duration numeric default null, p_assigned_crew_id uuid default null,
  p_internal_notes text default null, p_status text default null
) returns public.jobs_operational_safe language plpgsql security definer set search_path='' as $$
declare r text; j public.jobs; safe_result public.jobs_operational_safe; crew public.crews; team jsonb;
begin
  r:=public.current_user_role(); select * into j from public.jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if r not in ('Master Admin','Administrator','Manager','Crew Lead') then raise exception 'Job operation not permitted'; end if;
  if r='Crew Lead' and not public.is_assigned_to_crew(j.assigned_crew_id) then raise exception 'Job is not assigned to your crew'; end if;
  if p_status is not null and p_status not in ('Ready to Schedule','Scheduled','Crew Assigned','In Progress','Completed','Cancelled') then raise exception 'Invalid operational status'; end if;
  if r='Crew Lead' then
    if p_scheduled_date is not null or p_start_time is not null or p_estimated_duration is not null or p_assigned_crew_id is not null
      then raise exception 'Crew Leads cannot reschedule or reassign jobs'; end if;
    if p_status is not null and p_status not in ('In Progress','Completed') then raise exception 'Crew Leads may only start or complete assigned jobs'; end if;
    if p_status='In Progress' and j.status not in ('Scheduled','Crew Assigned') then raise exception 'Job is not ready to start'; end if;
    if p_status='Completed' and j.status<>'In Progress' then raise exception 'Only an in-progress job may be completed'; end if;
  end if;
  if p_assigned_crew_id is not null then
    select * into crew from public.crews where id=p_assigned_crew_id and status='Active' and archived_at is null;
    if not found then raise exception 'Active crew not found'; end if;
    select coalesce(jsonb_agg(coalesce(e.preferred_name,nullif(trim(e.first_name||' '||e.last_name),'')) order by e.last_name),'[]'::jsonb) into team
      from public.crew_members cm join public.employees e on e.id=cm.employee_id where cm.crew_id=crew.id;
  end if;
  update public.jobs set scheduled_date=coalesce(p_scheduled_date,scheduled_date), start_time=coalesce(p_start_time,start_time),
    estimated_duration=coalesce(p_estimated_duration,estimated_duration), internal_notes=coalesce(p_internal_notes,internal_notes),
    status=coalesce(p_status,status), completed_at=case when p_status='Completed' then now() when p_status is not null then null else completed_at end,
    assigned_crew_id=coalesce(p_assigned_crew_id,assigned_crew_id),
    assigned_crew_name=case when p_assigned_crew_id is null then assigned_crew_name else crew.crew_name end,
    crew_lead_name=case when p_assigned_crew_id is null then crew_lead_name else (select coalesce(e.preferred_name,trim(e.first_name||' '||e.last_name)) from public.employees e where e.id=crew.crew_lead_id) end,
    assigned_team=case when p_assigned_crew_id is null then assigned_team else team end where id=p_job_id returning * into j;
  select * into safe_result from public.jobs_operational_safe where id=j.id;
  if not found then raise exception 'Updated job is outside your permitted scope'; end if;
  return safe_result;
end $$;

-- Time Clock RPCs hide all rates/pay and prevent employee identity spoofing.
create or replace function public.clock_in_operational(p_employee_id uuid,p_job_id uuid,p_crew_id uuid,p_entry_type text,p_clock_in timestamptz,p_notes text)
returns public.time_entries_operational_safe language plpgsql security definer set search_path='' as $$
declare r text; target uuid; result public.time_entries; safe_result public.time_entries_operational_safe; n text; job_crew uuid; effective_clock_in timestamptz;
begin
  r:=public.current_user_role(); target:=case when r in ('Scrub Technician','Sales') then public.current_employee_id() else p_employee_id end;
  if target is null then raise exception 'An employee link is required'; end if;
  if r not in ('Master Admin','Administrator','Manager','Crew Lead','Scrub Technician','Sales') then raise exception 'Time Clock access denied'; end if;
  if r='Crew Lead' and target<>public.current_employee_id() and not exists(select 1 from public.crew_members cm where cm.employee_id=target and public.is_assigned_to_crew(cm.crew_id)) then raise exception 'Employee is not in your crew'; end if;
  if r in ('Scrub Technician','Sales') and target<>public.current_employee_id() then raise exception 'Employee identity mismatch'; end if;
  if p_crew_id is not null and r in ('Crew Lead','Scrub Technician','Sales') and not public.is_assigned_to_crew(p_crew_id) then raise exception 'Crew is outside your permitted scope'; end if;
  if p_job_id is not null and r in ('Crew Lead','Scrub Technician','Sales') then
    select assigned_crew_id into job_crew from public.jobs where id=p_job_id;
    if not found or job_crew is null or not public.is_assigned_to_crew(job_crew) then raise exception 'Job is outside your permitted scope'; end if;
    if p_crew_id is not null and p_crew_id is distinct from job_crew then raise exception 'Job and crew do not match'; end if;
  end if;
  effective_clock_in:=case when r in ('Master Admin','Administrator') then p_clock_in else now() end;
  if effective_clock_in is null then raise exception 'Clock-in time is required'; end if;
  if exists(select 1 from public.time_entries t where t.employee_id=target and t.status='Open' and t.clock_out is null and t.archived_at is null) then raise exception 'Employee is already clocked in'; end if;
  n:='TIME-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(floor(random()*10000)::text,4,'0');
  insert into public.time_entries(time_entry_number,employee_id,job_id,crew_id,work_date,clock_in,entry_type,notes,status)
  values(n,target,p_job_id,p_crew_id,(effective_clock_in at time zone current_setting('TIMEZONE'))::date,effective_clock_in,p_entry_type,p_notes,'Open') returning * into result;
  select * into safe_result from public.time_entries_operational_safe where id=result.id;
  if not found then raise exception 'Created time entry is outside your permitted scope'; end if;
  return safe_result;
end $$;
create or replace function public.clock_out_operational(p_time_entry_id uuid,p_clock_out timestamptz,p_break_minutes integer)
returns public.time_entries_operational_safe language plpgsql security definer set search_path='' as $$
declare r text; t public.time_entries; safe_result public.time_entries_operational_safe; e public.employees; hours numeric; used_regular numeric; regular numeric; overtime numeric; ot_rate numeric; effective_clock_out timestamptz;
begin
  r:=public.current_user_role(); select * into t from public.time_entries where id=p_time_entry_id for update;
  if not found or t.status<>'Open' or t.clock_out is not null then raise exception 'Time entry is not open'; end if;
  if r in ('Crew Lead','Scrub Technician','Sales') and t.employee_id<>public.current_employee_id()
    and not (r='Crew Lead' and exists(select 1 from public.crew_members cm where cm.employee_id=t.employee_id and public.is_assigned_to_crew(cm.crew_id))) then raise exception 'Time entry access denied'; end if;
  if r not in ('Master Admin','Administrator','Manager','Crew Lead','Scrub Technician','Sales') then raise exception 'Time Clock access denied'; end if;
  effective_clock_out:=case when r in ('Master Admin','Administrator') then p_clock_out else now() end;
  if effective_clock_out is null or effective_clock_out<t.clock_in then raise exception 'Clock-out time is invalid'; end if;
  hours:=greatest(extract(epoch from (effective_clock_out-t.clock_in))/3600-greatest(p_break_minutes,0)/60.0,0);
  select * into e from public.employees where id=t.employee_id;
  select coalesce(sum(x.regular_hours),0) into used_regular from public.time_entries x
    where x.employee_id=t.employee_id and x.work_date=t.work_date and x.id<>t.id
      and x.status in ('Completed','Approved') and x.archived_at is null;
  regular:=least(hours,greatest(8-used_regular,0)); overtime:=greatest(hours-regular,0);
  ot_rate:=case when e.overtime_rate>0 then e.overtime_rate else e.hourly_rate*1.5 end;
  update public.time_entries set clock_out=effective_clock_out,break_minutes=greatest(p_break_minutes,0),total_hours=hours,
    regular_hours=regular,overtime_hours=overtime,hourly_rate_snapshot=e.hourly_rate,overtime_rate_snapshot=ot_rate,
    regular_pay=regular*e.hourly_rate,overtime_pay=overtime*ot_rate,gross_pay=regular*e.hourly_rate+overtime*ot_rate,
    status='Completed' where id=t.id returning * into t;
  select * into safe_result from public.time_entries_operational_safe where id=t.id;
  if not found then raise exception 'Completed time entry is outside your permitted scope'; end if;
  return safe_result;
end $$;
create or replace function public.save_operational_time_entry(p_time_entry_id uuid,p_employee_id uuid,p_job_id uuid,p_crew_id uuid,p_entry_type text,p_clock_in timestamptz,p_clock_out timestamptz,p_break_minutes integer,p_notes text)
returns public.time_entries_operational_safe language plpgsql security definer set search_path='' as $$
declare r text; target uuid; t public.time_entries; safe_result public.time_entries_operational_safe; clocked public.time_entries_operational_safe; job_crew uuid;
begin
  r:=public.current_user_role(); target:=case when r in ('Scrub Technician','Sales') then public.current_employee_id() else p_employee_id end;
  if target is null then raise exception 'An employee link is required'; end if;
  if r not in ('Master Admin','Administrator') then raise exception 'Manual time entry corrections require Administrator access'; end if;
  if p_time_entry_id is null then
    clocked:=public.clock_in_operational(target,p_job_id,p_crew_id,p_entry_type,p_clock_in,p_notes);
    select * into t from public.time_entries where id=clocked.id;
  else
    select * into t from public.time_entries where id=p_time_entry_id for update;
    if not found then raise exception 'Time entry not found'; end if;
    if r in ('Scrub Technician','Sales') and t.employee_id<>public.current_employee_id() then raise exception 'Time entry access denied'; end if;
    if r='Crew Lead' and t.employee_id<>public.current_employee_id() and not exists(select 1 from public.crew_members cm where cm.employee_id=t.employee_id and public.is_assigned_to_crew(cm.crew_id)) then raise exception 'Time entry access denied'; end if;
    if t.status not in ('Open','Completed') then raise exception 'Reviewed or archived time entries cannot be edited'; end if;
    if r='Crew Lead' and target<>public.current_employee_id() and not exists(select 1 from public.crew_members cm where cm.employee_id=target and public.is_assigned_to_crew(cm.crew_id)) then raise exception 'Target employee is not in your crew'; end if;
    if p_crew_id is not null and r in ('Crew Lead','Scrub Technician','Sales') and not public.is_assigned_to_crew(p_crew_id) then raise exception 'Crew is outside your permitted scope'; end if;
    if p_job_id is not null and r in ('Crew Lead','Scrub Technician','Sales') then
      select assigned_crew_id into job_crew from public.jobs where id=p_job_id;
      if not found or job_crew is null or not public.is_assigned_to_crew(job_crew) then raise exception 'Job is outside your permitted scope'; end if;
      if p_crew_id is not null and p_crew_id is distinct from job_crew then raise exception 'Job and crew do not match'; end if;
    end if;
    if r not in ('Master Admin','Administrator','Manager','Crew Lead','Scrub Technician','Sales') then raise exception 'Time Clock access denied'; end if;
    update public.time_entries set employee_id=target,job_id=p_job_id,crew_id=p_crew_id,entry_type=p_entry_type,
      work_date=(p_clock_in at time zone current_setting('TIMEZONE'))::date,clock_in=p_clock_in,clock_out=null,
      break_minutes=0,notes=p_notes,status='Open' where id=t.id returning * into t;
  end if;
  if p_clock_out is not null then return public.clock_out_operational(t.id,p_clock_out,p_break_minutes); end if;
  select * into safe_result from public.time_entries_operational_safe where id=t.id;
  if not found then raise exception 'Saved time entry is outside your permitted scope'; end if;
  return safe_result;
end $$;
create or replace function public.review_operational_time_entry(p_time_entry_id uuid,p_status text,p_notes text default null)
returns public.time_entries_operational_safe language plpgsql security definer set search_path='' as $$ declare t public.time_entries; safe_result public.time_entries_operational_safe; begin
  if not public.is_master_admin() then raise exception 'Final time entry review requires Master Admin'; end if;
  if p_status not in ('Approved','Rejected','Archived') then raise exception 'Invalid review status'; end if;
  update public.time_entries set status=p_status,notes=coalesce(p_notes,notes),
    approved_at=case when p_status='Approved' then now() else null end,
    approved_by=case when p_status='Approved' then coalesce((select display_name from public.user_profiles where id=auth.uid()),public.current_user_role()) else null end,
    archived_at=case when p_status='Archived' then now() else archived_at end
  where id=p_time_entry_id and clock_out is not null returning * into t;
  if not found then raise exception 'Completed time entry not found'; end if;
  select * into safe_result from public.time_entries_operational_safe where id=t.id;
  return safe_result;
end $$;

-- Administrator employee management excludes all pay-rate columns.
create or replace function public.admin_operational_create_employee(p_employee_number text,p_first_name text,p_last_name text,p_preferred_name text,p_email text,p_phone text,p_department text,p_job_title text,p_employment_status text,p_employment_type text,p_hire_date date,p_notes text)
returns public.employee_directory_safe language plpgsql security definer set search_path='' as $$ declare e public.employees; safe_result public.employee_directory_safe; begin
  if not public.has_any_role(array['Master Admin','Administrator']) then raise exception 'Employee management denied'; end if;
  insert into public.employees(employee_number,first_name,last_name,preferred_name,email,phone,department,job_title,employment_status,employment_type,hire_date,notes)
  values(p_employee_number,p_first_name,p_last_name,p_preferred_name,p_email,p_phone,p_department,p_job_title,p_employment_status,p_employment_type,p_hire_date,p_notes) returning * into e;
  select * into safe_result from public.employee_directory_safe where id=e.id; return safe_result; end $$;
create or replace function public.admin_operational_update_employee(p_employee_id uuid,p_first_name text,p_last_name text,p_preferred_name text,p_email text,p_phone text,p_department text,p_job_title text,p_employment_status text,p_employment_type text,p_hire_date date,p_notes text,p_archive boolean default false)
returns public.employee_directory_safe language plpgsql security definer set search_path='' as $$ declare e public.employees; safe_result public.employee_directory_safe; begin
  if not public.has_any_role(array['Master Admin','Administrator']) then raise exception 'Employee management denied'; end if;
  update public.employees set first_name=p_first_name,last_name=p_last_name,preferred_name=p_preferred_name,email=p_email,phone=p_phone,department=p_department,job_title=p_job_title,
    employment_status=case when p_archive then 'Archived' else p_employment_status end,employment_type=p_employment_type,hire_date=p_hire_date,notes=p_notes,
    archived_at=case when p_archive then now() else archived_at end where id=p_employee_id returning * into e;
  if not found then raise exception 'Employee not found'; end if;
  select * into safe_result from public.employee_directory_safe where id=e.id; return safe_result; end $$;

-- Administrator/Manager crew management never exposes employee pay columns.
create or replace function public.manage_operational_crew(p_crew_id uuid,p_crew_name text,p_crew_lead_id uuid,p_status text,p_notes text,p_archive boolean default false)
returns public.crew_directory_safe language plpgsql security definer set search_path='' as $$
declare c public.crews; safe_result public.crew_directory_safe;
begin
  if not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Crew management denied'; end if;
  if p_status not in ('Active','Inactive','Archived') then raise exception 'Invalid crew status'; end if;
  if p_crew_lead_id is not null and not exists(select 1 from public.employees e where e.id=p_crew_lead_id and e.archived_at is null) then raise exception 'Crew lead not found'; end if;
  if p_crew_id is null then
    insert into public.crews(crew_name,crew_lead_id,status,notes) values(trim(p_crew_name),p_crew_lead_id,p_status,p_notes) returning * into c;
  else
    update public.crews set crew_name=trim(p_crew_name),crew_lead_id=p_crew_lead_id,
      status=case when p_archive then 'Archived' else p_status end,notes=p_notes,
      archived_at=case when p_archive then now() else archived_at end where id=p_crew_id returning * into c;
    if not found then raise exception 'Crew not found'; end if;
  end if;
  select * into safe_result from public.crew_directory_safe where id=c.id; return safe_result;
end $$;
create or replace function public.add_operational_crew_member(p_crew_id uuid,p_employee_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$ declare member_id uuid; begin
  if not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Crew management denied'; end if;
  if not exists(select 1 from public.crews c where c.id=p_crew_id and c.archived_at is null) then raise exception 'Crew not found'; end if;
  if not exists(select 1 from public.employees e where e.id=p_employee_id and e.archived_at is null) then raise exception 'Employee not found'; end if;
  insert into public.crew_members(crew_id,employee_id) values(p_crew_id,p_employee_id) returning id into member_id; return member_id;
end $$;
create or replace function public.remove_operational_crew_member(p_member_id uuid)
returns void language plpgsql security definer set search_path='' as $$ begin
  if not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Crew management denied'; end if;
  delete from public.crew_members where id=p_member_id;
  if not found then raise exception 'Crew member not found'; end if;
end $$;

revoke all on function public.get_operational_jobs(date,date), public.update_operational_job(uuid,date,time,numeric,uuid,text,text),
  public.clock_in_operational(uuid,uuid,uuid,text,timestamptz,text), public.clock_out_operational(uuid,timestamptz,integer),
  public.save_operational_time_entry(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,integer,text),
  public.review_operational_time_entry(uuid,text,text),
  public.admin_operational_create_employee(text,text,text,text,text,text,text,text,text,text,date,text),
  public.admin_operational_update_employee(uuid,text,text,text,text,text,text,text,text,text,date,text,boolean),
  public.manage_operational_crew(uuid,text,uuid,text,text,boolean), public.add_operational_crew_member(uuid,uuid),
  public.remove_operational_crew_member(uuid) from public, anon;
grant execute on function public.get_operational_jobs(date,date), public.update_operational_job(uuid,date,time,numeric,uuid,text,text),
  public.clock_in_operational(uuid,uuid,uuid,text,timestamptz,text), public.clock_out_operational(uuid,timestamptz,integer),
  public.save_operational_time_entry(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,integer,text),
  public.review_operational_time_entry(uuid,text,text),
  public.admin_operational_create_employee(text,text,text,text,text,text,text,text,text,text,date,text),
  public.admin_operational_update_employee(uuid,text,text,text,text,text,text,text,text,text,date,text,boolean),
  public.manage_operational_crew(uuid,text,uuid,text,text,boolean), public.add_operational_crew_member(uuid,uuid),
  public.remove_operational_crew_member(uuid) to authenticated;

-- Finance/payroll tables receive no new non-Master policies. Stage B Master Admin
-- policies continue to protect expenses, vehicles, mileage, payments and full time/pay data.
