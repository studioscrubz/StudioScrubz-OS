begin;

alter table public.user_profiles
drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
add constraint user_profiles_role_check check (role in (
  'Master Admin','Administrator','Manager','Sales','Lead Representative',
  'Crew Lead','Scrub Technician'
));

create or replace function private.is_eligible_lead_representative_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees employee
    where employee.id = p_employee_id
      and employee.department = 'Lead Representative'
      and employee.employment_status = 'Active'
      and employee.archived_at is null
  )
$$;

revoke all on function private.is_eligible_lead_representative_employee(uuid)
from public, anon, authenticated;

create or replace function private.validate_lead_representative_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'Lead Representative' and new.is_active and (
    new.employee_id is null
    or not private.is_eligible_lead_representative_employee(new.employee_id)
  ) then
    raise exception 'An active Lead Representative profile requires an active, unarchived Lead Representative employee.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_lead_representative_profile()
from public, anon, authenticated;

create trigger user_profiles_validate_lead_representative
before insert or update of role, employee_id, is_active
on public.user_profiles
for each row execute function private.validate_lead_representative_profile();

create or replace function public.is_current_lead_representative_eligible()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles profile
    where profile.id = auth.uid()
      and profile.is_active
      and profile.role = 'Lead Representative'
      and private.is_eligible_lead_representative_employee(profile.employee_id)
  )
$$;

revoke all on function public.is_current_lead_representative_eligible()
from public, anon, authenticated;
grant execute on function public.is_current_lead_representative_eligible()
to authenticated;

create or replace function public.admin_create_user_profile(
  p_auth_user_id uuid, p_email text, p_display_name text, p_role text,
  p_employee_id uuid default null, p_is_active boolean default true
) returns public.user_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare auth_email text; result public.user_profiles;
begin
  if not public.is_master_admin() then raise exception 'Master Admin access required'; end if;
  if p_role not in ('Master Admin','Administrator','Manager','Sales','Lead Representative','Crew Lead','Scrub Technician') then raise exception 'Invalid role'; end if;
  if p_role = 'Lead Representative' and p_is_active and (
    p_employee_id is null or not private.is_eligible_lead_representative_employee(p_employee_id)
  ) then raise exception 'An active Lead Representative profile requires an active, unarchived Lead Representative employee.'; end if;
  select email into auth_email from auth.users where id = p_auth_user_id;
  if auth_email is null then raise exception 'Auth user was not found. Create the user in Supabase Authentication first.'; end if;
  if lower(auth_email) <> lower(trim(p_email)) then raise exception 'Auth user email does not match.'; end if;
  insert into public.user_profiles(id,email,display_name,role,employee_id,is_active)
  values(p_auth_user_id,auth_email,nullif(trim(p_display_name),''),p_role,p_employee_id,p_is_active)
  returning * into result;
  return result;
end;
$$;

create or replace function public.admin_update_user_profile(
  p_profile_id uuid, p_display_name text, p_role text,
  p_employee_id uuid default null, p_is_active boolean default true
) returns public.user_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare current_profile public.user_profiles; result public.user_profiles; active_admins integer;
begin
  if not public.is_master_admin() then raise exception 'Master Admin access required'; end if;
  if p_role not in ('Master Admin','Administrator','Manager','Sales','Lead Representative','Crew Lead','Scrub Technician') then raise exception 'Invalid role'; end if;
  if p_role = 'Lead Representative' and p_is_active and (
    p_employee_id is null or not private.is_eligible_lead_representative_employee(p_employee_id)
  ) then raise exception 'An active Lead Representative profile requires an active, unarchived Lead Representative employee.'; end if;
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
end;
$$;

revoke all on function public.admin_create_user_profile(uuid,text,text,text,uuid,boolean),
  public.admin_update_user_profile(uuid,text,text,uuid,boolean)
from public, anon, authenticated;
grant execute on function public.admin_create_user_profile(uuid,text,text,text,uuid,boolean),
  public.admin_update_user_profile(uuid,text,text,uuid,boolean)
to authenticated;

create table public.estimate_lead_representative_attribution_events (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete restrict,
  previous_lead_representative_id uuid references public.employees(id) on delete restrict,
  lead_representative_id uuid references public.employees(id) on delete restrict,
  event_type text not null check (event_type in ('Attributed','Reassigned','Unattributed')),
  changed_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (previous_lead_representative_id is distinct from lead_representative_id)
);

create index estimate_lead_rep_attribution_events_estimate_idx
on public.estimate_lead_representative_attribution_events(estimate_id, created_at desc);
create index estimate_lead_rep_attribution_events_representative_idx
on public.estimate_lead_representative_attribution_events(lead_representative_id, created_at desc)
where lead_representative_id is not null;

alter table public.estimate_lead_representative_attribution_events enable row level security;
revoke all on table public.estimate_lead_representative_attribution_events
from public, anon, authenticated;
grant select on table public.estimate_lead_representative_attribution_events to authenticated;

create policy "Lead attribution history management read"
on public.estimate_lead_representative_attribution_events
for select to authenticated
using (public.has_any_role(array['Master Admin','Administrator','Manager','Sales']));

create or replace function private.audit_estimate_lead_representative_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.lead_representative_id is not distinct from old.lead_representative_id then return new; end if;
  if tg_op = 'INSERT' and new.lead_representative_id is null then return new; end if;
  insert into public.estimate_lead_representative_attribution_events(
    estimate_id, previous_lead_representative_id, lead_representative_id,
    event_type, changed_by_user_id
  ) values (
    new.id, case when tg_op = 'UPDATE' then old.lead_representative_id else null end, new.lead_representative_id,
    case
      when tg_op = 'INSERT' or old.lead_representative_id is null then 'Attributed'
      when new.lead_representative_id is null then 'Unattributed'
      else 'Reassigned'
    end,
    auth.uid()
  );
  return new;
end;
$$;

revoke all on function private.audit_estimate_lead_representative_attribution()
from public, anon, authenticated;

create trigger estimates_audit_lead_representative_attribution
after insert or update of lead_representative_id on public.estimates
for each row execute function private.audit_estimate_lead_representative_attribution();

create or replace function public.get_my_lead_representative_leads()
returns table (
  estimate_id uuid,
  estimate_number text,
  customer_name text,
  customer_phone text,
  customer_email text,
  service_name text,
  submitted_at timestamptz,
  lifecycle_stage text,
  walkthrough_status text,
  proposal_status text,
  booked boolean,
  job_status text,
  paid boolean,
  terminal_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare representative_id uuid;
begin
  if auth.uid() is null or not public.is_current_lead_representative_eligible() then
    raise exception 'Lead Representative portal access denied.' using errcode = '42501';
  end if;
  representative_id := public.current_employee_id();

  return query
  select
    estimate.id,
    estimate.estimate_number,
    coalesce(
      nullif(btrim(client.company_name), ''),
      nullif(btrim(concat_ws(' ', estimate.customer_first_name, estimate.customer_last_name)), ''),
      nullif(btrim(concat_ws(' ', client.first_name, client.last_name)), ''),
      'Customer'
    ),
    coalesce(nullif(btrim(estimate.customer_phone), ''), nullif(btrim(client.phone), '')),
    coalesce(nullif(btrim(estimate.customer_email), ''), nullif(btrim(client.email), '')),
    coalesce(nullif(btrim(estimate.service_name), ''), nullif(btrim(proposal.service_name), ''), 'Service inquiry'),
    estimate.created_at,
    case
      when estimate.status = 'Declined' then 'Declined'
      when proposal.status = 'Declined' then 'Declined'
      when jobs.cancelled and not jobs.has_active_or_completed then 'Cancelled'
      when jobs.completed and financial.paid then 'Completed / Paid'
      when proposal.accepted and proposal.accepted_at is not null then 'Booked'
      when proposal.status in ('Sent','Viewed') then 'Proposal Sent'
      when walkthrough.id is not null then 'Walkthrough / Assessment'
      else 'Submitted'
    end,
    walkthrough.status,
    proposal.status,
    coalesce(proposal.accepted and proposal.accepted_at is not null, false),
    jobs.latest_status,
    coalesce(jobs.completed and financial.paid, false),
    case
      when estimate.status = 'Declined' then estimate.decline_reason
      when proposal.status = 'Declined' then proposal.decline_reason
      else null
    end
  from public.estimates estimate
  left join public.clients client on client.id = estimate.client_id
  left join lateral (
    select w.id, w.status, w.created_at
    from public.walkthroughs w
    where w.estimate_id = estimate.id and w.archived_at is null
    order by w.created_at desc, w.id desc limit 1
  ) walkthrough on true
  left join lateral (
    select p.id, p.status, p.accepted, p.accepted_at, p.decline_reason,
      p.result->>'serviceName' as service_name, p.created_at
    from public.proposals p
    where p.archived_at is null
      and (p.estimate_id = estimate.id or (walkthrough.id is not null and p.walkthrough_id = walkthrough.id))
    order by p.created_at desc, p.id desc limit 1
  ) proposal on true
  left join lateral (
    select
      (array_agg(j.status order by j.created_at desc, j.id desc))[1] as latest_status,
      bool_or(j.status = 'Completed') as completed,
      bool_or(j.status = 'Cancelled') as cancelled,
      bool_or(j.status not in ('Cancelled','Archived')) as has_active_or_completed,
      array_agg(j.id) as ids
    from public.jobs j
    where j.lead_representative_id = representative_id
      and j.archived_at is null
      and (j.estimate_id = estimate.id
        or (walkthrough.id is not null and j.walkthrough_id = walkthrough.id)
        or (proposal.id is not null and j.proposal_id = proposal.id))
  ) jobs on true
  left join lateral (
    select exists (
      select 1
      from public.invoices invoice
      where invoice.archived_at is null
        and invoice.status = 'Paid'
        and invoice.paid_at is not null
        and (
          invoice.job_id = any(coalesce(jobs.ids, '{}'::uuid[]))
          or (proposal.id is not null and invoice.proposal_id = proposal.id)
          or exists (
            select 1 from public.service_agreements agreement
            where agreement.id = invoice.service_agreement_id
              and agreement.proposal_id = proposal.id
          )
        )
    ) as paid
  ) financial on true
  where estimate.lead_representative_id = representative_id
    and estimate.archived_at is null
  order by estimate.created_at desc, estimate.id desc;
end;
$$;

revoke all on function public.get_my_lead_representative_leads()
from public, anon, authenticated;
grant execute on function public.get_my_lead_representative_leads()
to authenticated;

notify pgrst, 'reload schema';
commit;
