begin;

alter table public.time_entries
  add column labor_classification text not null default 'Production',
  add column labor_classification_reason text,
  add column labor_classified_at timestamptz,
  add column labor_classified_by uuid references auth.users(id) on delete restrict;

alter table public.time_entries
  add constraint time_entries_labor_classification_check
  check (labor_classification in ('Production', 'Approved Exception')),
  add constraint time_entries_exception_classification_audit_check
  check (
    labor_classification = 'Production'
    or (
      nullif(btrim(labor_classification_reason), '') is not null
      and labor_classified_at is not null
      and labor_classified_by is not null
    )
  );

create table public.time_entry_labor_classification_events (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries(id) on delete restrict,
  previous_classification text not null
    check (previous_classification in ('Production', 'Approved Exception')),
  new_classification text not null
    check (new_classification in ('Production', 'Approved Exception')),
  operational_reason text not null
    check (length(btrim(operational_reason)) between 3 and 500),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_role text not null
    check (actor_role in ('Master Admin', 'Administrator', 'Manager')),
  created_at timestamptz not null default now(),
  check (previous_classification <> new_classification)
);

create index time_entry_labor_classification_events_entry_idx
on public.time_entry_labor_classification_events(time_entry_id, created_at desc);

alter table public.time_entry_labor_classification_events enable row level security;
revoke all on table public.time_entry_labor_classification_events
from public, anon, authenticated;
grant select, insert on table public.time_entry_labor_classification_events
to service_role;

create or replace function public.guard_time_entry_labor_classification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.labor_classification <> 'Production'
      or new.labor_classification_reason is not null
      or new.labor_classified_at is not null
      or new.labor_classified_by is not null then
      raise exception 'Labor classification must be assigned through the authorized workflow.'
        using errcode = '42501';
    end if;
  elsif (
    new.labor_classification is distinct from old.labor_classification
    or new.labor_classification_reason is distinct from old.labor_classification_reason
    or new.labor_classified_at is distinct from old.labor_classified_at
    or new.labor_classified_by is distinct from old.labor_classified_by
  ) and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Labor classification must be assigned through the authorized workflow.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_time_entry_labor_classification()
from public, anon, authenticated;

create trigger time_entries_guard_labor_classification
before insert or update of labor_classification, labor_classification_reason,
  labor_classified_at, labor_classified_by
on public.time_entries
for each row execute function public.guard_time_entry_labor_classification();

create or replace view public.time_entries_operational_safe
with (security_barrier = true, security_invoker = true) as
select
  t.id, t.time_entry_number, t.employee_id, t.job_id, t.crew_id,
  t.work_date, t.clock_in, t.clock_out, t.break_minutes,
  t.regular_hours, t.overtime_hours, t.total_hours, t.entry_type,
  t.notes, t.status, t.approved_at, t.approved_by,
  t.created_at, t.updated_at, t.archived_at,
  coalesce(e.employee_number, 'Deleted Employee') as employee_number,
  coalesce(
    e.preferred_name,
    nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''),
    'Deleted Employee'
  ) as employee_name,
  j.job_number,
  c.crew_name,
  t.labor_classification,
  t.labor_classification_reason,
  t.labor_classified_at
from public.time_entries t
left join public.employees e on e.id = t.employee_id
left join public.jobs j on j.id = t.job_id
left join public.crews c on c.id = t.crew_id
where public.has_any_role(array['Master Admin', 'Administrator', 'Manager'])
   or t.employee_id = public.current_employee_id()
   or (not public.has_role('Sales') and public.is_assigned_to_crew(t.crew_id));

create or replace function public.classify_job_time_entry_labor(
  p_time_entry_id uuid,
  p_classification text,
  p_operational_reason text
)
returns public.time_entries_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.time_entries;
  result public.time_entries_operational_safe;
  actor_role text;
  reason text := nullif(btrim(coalesce(p_operational_reason, '')), '');
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin', 'Administrator', 'Manager']) then
    raise exception 'Labor classification access denied.' using errcode = '42501';
  end if;
  actor_role := public.current_user_role();
  if p_classification not in ('Production', 'Approved Exception') then
    raise exception 'Invalid labor classification.';
  end if;
  if reason is null or length(reason) not between 3 and 500 then
    raise exception 'Enter an operational reason between 3 and 500 characters.';
  end if;

  select * into entry
  from public.time_entries
  where id = p_time_entry_id
  for update;

  if not found
    or entry.job_id is null
    or entry.entry_type <> 'Job'
    or entry.status not in ('Completed', 'Approved')
    or entry.archived_at is not null then
    raise exception 'A finalized active Job time entry is required.';
  end if;
  if entry.labor_classification = p_classification then
    raise exception 'The time entry already has this labor classification.';
  end if;

  update public.time_entries
  set labor_classification = p_classification,
      labor_classification_reason = reason,
      labor_classified_at = now(),
      labor_classified_by = auth.uid()
  where id = entry.id;

  insert into public.time_entry_labor_classification_events(
    time_entry_id, previous_classification, new_classification,
    operational_reason, actor_user_id, actor_role
  ) values (
    entry.id, entry.labor_classification, p_classification,
    reason, auth.uid(), actor_role
  );

  select * into result
  from public.time_entries_operational_safe
  where id = entry.id;
  return result;
end;
$$;

revoke all on function public.classify_job_time_entry_labor(uuid,text,text)
from public, anon, authenticated;
grant execute on function public.classify_job_time_entry_labor(uuid,text,text)
to authenticated;

drop function if exists public.get_job_performance_rows(date,date);

create or replace function public.get_job_performance_rows(
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  id uuid, job_number text, client_id uuid, client_name text,
  property_id uuid, property_name text, service_name text, division text,
  scheduled_date date, operational_started_at timestamptz,
  operational_ended_at timestamptz, ended_business_date date,
  duration_seconds double precision, actual_labor_hours numeric,
  performance_labor_hours numeric, approved_exception_hours numeric,
  budgeted_labor_hours numeric, budgeted_crew_size integer,
  budgeted_estimated_duration numeric, effective_labor_hours numeric,
  effective_crew_size integer, effective_estimated_duration numeric,
  labor_budget_frozen_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare v_timezone text;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  if not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Job performance report permission denied.';
  end if;
  if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
    raise exception 'Report end date cannot be before start date.';
  end if;
  select coalesce(nullif(btrim(settings.timezone), ''), 'UTC') into v_timezone
  from public.business_settings settings order by settings.id limit 1;
  v_timezone := coalesce(v_timezone, 'UTC');
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'The configured business timezone is invalid.';
  end if;

  return query
  select
    job.id, job.job_number, job.client_id,
    coalesce(nullif(btrim(job.client_name), ''), 'Unnamed client'),
    job.property_id,
    coalesce(nullif(btrim(job.property_name), ''), 'Unnamed property'),
    coalesce(nullif(btrim(job.service_name), ''), 'Unspecified service'),
    job.division, job.scheduled_date, job.operational_started_at,
    job.operational_ended_at,
    (job.operational_ended_at at time zone v_timezone)::date,
    extract(epoch from (job.operational_ended_at - job.operational_started_at))::double precision,
    actual.actual_labor_hours,
    actual.performance_labor_hours,
    actual.approved_exception_hours,
    snapshot.budgeted_labor_hours, snapshot.recommended_crew_size,
    snapshot.estimated_duration,
    case when snapshot.job_id is null then null else greatest(snapshot.budgeted_labor_hours + coalesce(adjustment.labor_hours_delta, 0), 0) end,
    case when snapshot.job_id is null then null else greatest(snapshot.recommended_crew_size + coalesce(adjustment.crew_size_delta, 0), 0)::integer end,
    case when snapshot.job_id is null then null
      when snapshot.estimated_duration is null and coalesce(adjustment.duration_delta, 0) = 0 then null
      else greatest(coalesce(snapshot.estimated_duration, 0) + coalesce(adjustment.duration_delta, 0), 0) end,
    snapshot.frozen_at
  from public.jobs job
  left join public.job_labor_budget_snapshots snapshot on snapshot.job_id = job.id
  left join lateral (
    select coalesce(sum(a.labor_hours_delta), 0) as labor_hours_delta,
      coalesce(sum(a.crew_size_delta), 0)::integer as crew_size_delta,
      coalesce(sum(a.duration_delta), 0) as duration_delta
    from public.job_labor_budget_adjustments a where a.job_id = job.id
  ) adjustment on true
  left join lateral (
    select
      case when count(*) = 0 then null else sum(entry.total_hours) end as actual_labor_hours,
      case when count(*) = 0 then null else coalesce(sum(entry.total_hours) filter (where entry.labor_classification = 'Production'), 0) end as performance_labor_hours,
      case when count(*) = 0 then null else coalesce(sum(entry.total_hours) filter (where entry.labor_classification = 'Approved Exception'), 0) end as approved_exception_hours
    from public.time_entries entry
    where entry.job_id = job.id
      and entry.employee_id is not null
      and entry.entry_type = 'Job'
      and entry.status in ('Completed', 'Approved')
      and entry.archived_at is null
  ) actual on true
  where job.status = 'Completed'
    and job.archived_at is null
    and job.operational_started_at is not null
    and job.operational_ended_at is not null
    and job.operational_ended_at >= job.operational_started_at
    and (p_start_date is null or (job.operational_ended_at at time zone v_timezone)::date >= p_start_date)
    and (p_end_date is null or (job.operational_ended_at at time zone v_timezone)::date <= p_end_date)
  order by job.operational_ended_at desc;
end;
$$;

revoke all on function public.get_job_performance_rows(date,date)
from public, anon, authenticated;
grant execute on function public.get_job_performance_rows(date,date)
to authenticated;

notify pgrst, 'reload schema';
commit;
