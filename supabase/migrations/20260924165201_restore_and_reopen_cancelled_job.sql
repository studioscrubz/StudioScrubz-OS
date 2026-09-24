-- Restore archived Cancelled Jobs without rewriting retained history.
begin;

alter table public.jobs
  add column archived_from_status text;

alter table public.jobs
  add constraint jobs_archived_from_status_check
  check (archived_from_status is null or archived_from_status in
    ('Ready to Schedule','Scheduled','Crew Assigned','In Progress','Completed','Cancelled')) not valid;
alter table public.jobs validate constraint jobs_archived_from_status_check;

create table public.job_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid,
  job_number text not null,
  event_type text not null,
  previous_status text not null,
  new_status text not null,
  actor_user_id uuid,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
alter table public.job_lifecycle_events enable row level security;
revoke all on table public.job_lifecycle_events from public, anon, authenticated;

create or replace function private.prevent_job_lifecycle_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Job lifecycle audit records are immutable.';
end $$;
revoke all on function private.prevent_job_lifecycle_event_mutation() from public, anon, authenticated;

create trigger job_lifecycle_events_immutable
before update or delete on public.job_lifecycle_events
for each row execute function private.prevent_job_lifecycle_event_mutation();

create or replace function public.archive_operational_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_safe public.jobs_operational_safe;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Job archive permission denied.' using errcode = '42501';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.archived_at is not null or v_job.status = 'Archived' then raise exception 'Job is already archived.'; end if;
  if v_job.status is null or v_job.status not in ('Ready to Schedule','Scheduled','Crew Assigned','In Progress','Completed','Cancelled') then
    raise exception 'Job cannot be archived from its current status.';
  end if;
  if exists (select 1 from public.time_entries where job_id = v_job.id and status = 'Open' and clock_out is null and archived_at is null) then
    raise exception 'A Job with active time entries cannot be archived.';
  end if;
  update public.jobs set archived_from_status = v_job.status, status = 'Archived', archived_at = now() where id = v_job.id;
  select * into v_safe from public.jobs_operational_safe where id = v_job.id;
  if not found then raise exception 'Archived Job is outside your permitted scope.'; end if;
  return v_safe;
end $$;

create or replace function public.get_archived_operational_jobs()
returns setof public.jobs_operational_safe
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Archived Job access denied.' using errcode = '42501';
  end if;
  return query select job.* from public.jobs_operational_safe job
    where job.archived_at is not null and job.status = 'Archived'
    order by job.archived_at desc;
end $$;

create function public.get_reopenable_archived_cancelled_job_ids()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select j.id from public.jobs j
  where auth.uid() is not null
    and public.has_any_role(array['Master Admin','Administrator','Manager'])
    and j.archived_at is not null and j.status = 'Archived' and j.archived_from_status = 'Cancelled'
$$;

create function public.restore_and_reopen_cancelled_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_safe public.jobs_operational_safe; v_new_status text; v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Job restore and reopen permission denied.' using errcode = '42501';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.archived_at is null or v_job.status is distinct from 'Archived' or v_job.archived_from_status is distinct from 'Cancelled' then
    raise exception 'Only a Job archived from Cancelled status can be restored and reopened.';
  end if;
  if public.is_job_financially_handed_off(v_job.id)
    or exists (select 1 from public.invoices i where i.job_id = v_job.id)
    or exists (select 1 from public.invoice_job_lines ijl where ijl.job_id = v_job.id)
    or exists (select 1 from public.payments p where p.job_id = v_job.id)
    or exists (select 1 from public.payments p join public.invoices i on i.id = p.invoice_id where i.job_id = v_job.id)
    or exists (select 1 from public.payments p join public.invoice_job_lines ijl on ijl.invoice_id = p.invoice_id where ijl.job_id = v_job.id)
  then
    raise exception 'This Cancelled Job cannot be restored because it has invoice, payment, or financial handoff history that must be retained.';
  end if;
  if v_job.proposal_id is not null and v_job.service_occurrence_id is null and exists (
    select 1 from public.jobs other where other.id <> v_job.id and other.proposal_id = v_job.proposal_id
      and other.service_occurrence_id is null and other.archived_at is null
  ) then
    raise exception 'This Cancelled Job cannot be restored because another active one-time Job already exists for its Proposal.';
  end if;
  if v_job.service_occurrence_id is not null and exists (
    select 1 from public.jobs other where other.id <> v_job.id and other.service_occurrence_id = v_job.service_occurrence_id
      and other.archived_at is null
  ) then
    raise exception 'This Cancelled Job cannot be restored because another active Job already exists for its Service occurrence.';
  end if;
  if num_nonnulls(v_job.assigned_employee_id, v_job.assigned_crew_id) > 1 then
    raise exception 'This Cancelled Job has an invalid worker assignment and cannot be restored.';
  end if;
  v_new_status := case
    when v_job.scheduled_date is null then 'Ready to Schedule'
    when num_nonnulls(v_job.assigned_employee_id, v_job.assigned_crew_id) = 0 then 'Scheduled'
    else 'Crew Assigned'
  end;
  update public.jobs set archived_at = null, archived_from_status = null, status = v_new_status where id = v_job.id;
  insert into public.job_lifecycle_events(job_id, job_number, event_type, previous_status, new_status, actor_user_id, metadata)
  values (v_job.id, v_job.job_number, 'Restored and Reopened', 'Cancelled', v_new_status, v_actor,
    jsonb_build_object('archived_record_status', 'Archived', 'history_retained', true));
  select * into v_safe from public.jobs_operational_safe where id = v_job.id;
  if not found then raise exception 'Restored Job is outside your permitted scope.'; end if;
  return v_safe;
exception when unique_violation then
  raise exception 'This Cancelled Job cannot be restored because another active Job conflicts with its Proposal or Service occurrence.';
end $$;

revoke all on function public.archive_operational_job(uuid), public.get_archived_operational_jobs(),
  public.get_reopenable_archived_cancelled_job_ids(), public.restore_and_reopen_cancelled_job(uuid)
from public, anon, authenticated;
grant execute on function public.archive_operational_job(uuid), public.get_archived_operational_jobs(),
  public.get_reopenable_archived_cancelled_job_ids(), public.restore_and_reopen_cancelled_job(uuid)
to authenticated;

notify pgrst, 'reload schema';
commit;
