begin;

create table public.job_labor_threshold_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  threshold_percent integer not null
    check (threshold_percent in (75, 90, 100, 110)),
  labor_burn_percent_at_crossing numeric not null
    check (labor_burn_percent_at_crossing >= threshold_percent),
  performance_labor_hours_at_crossing numeric not null
    check (performance_labor_hours_at_crossing >= 0),
  effective_labor_hours_at_crossing numeric not null
    check (effective_labor_hours_at_crossing > 0),
  crossed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (job_id, threshold_percent)
);

create index job_labor_threshold_events_crossed_idx
on public.job_labor_threshold_events(crossed_at desc);

alter table public.job_labor_threshold_events enable row level security;
revoke all on table public.job_labor_threshold_events
from public, anon, authenticated;
grant select on table public.job_labor_threshold_events to authenticated;
grant select on table public.job_labor_threshold_events to service_role;

create policy "Authorized operations read labor threshold events"
on public.job_labor_threshold_events
for select
to authenticated
using (
  public.has_any_role(array['Master Admin', 'Administrator', 'Manager'])
  or (
    public.has_role('Crew Lead')
    and exists (
      select 1
      from public.jobs job
      left join public.crews crew on crew.id = job.assigned_crew_id
      where job.id = job_labor_threshold_events.job_id
        and job.archived_at is null
        and (
          job.assigned_employee_id = public.current_employee_id()
          or crew.crew_lead_id = public.current_employee_id()
        )
    )
  )
);

create function public.evaluate_job_labor_thresholds(p_job_id uuid)
returns setof public.job_labor_threshold_events
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  job public.jobs;
  burn record;
begin
  if auth.uid() is null
    or not public.has_any_role(array[
      'Master Admin', 'Administrator', 'Manager', 'Crew Lead', 'Scrub Technician'
    ]) then
    raise exception 'Labor threshold evaluation denied.' using errcode = '42501';
  end if;

  select * into job from public.jobs where id = p_job_id;
  if not found
    or job.archived_at is not null
    or not public.can_access_job_assignment(
      job.assigned_employee_id,
      job.assigned_crew_id
    ) then
    raise exception 'Job is not available.' using errcode = '42501';
  end if;

  if job.status <> 'In Progress' then
    return;
  end if;

  select * into burn
  from public.get_job_live_labor_burn(job.id);

  if burn.labor_burn_percent is null
    or burn.effective_labor_hours is null
    or burn.effective_labor_hours <= 0 then
    return;
  end if;

  return query
  insert into public.job_labor_threshold_events(
    job_id,
    threshold_percent,
    labor_burn_percent_at_crossing,
    performance_labor_hours_at_crossing,
    effective_labor_hours_at_crossing,
    crossed_at
  )
  select
    job.id,
    threshold.threshold_percent,
    burn.labor_burn_percent,
    burn.live_performance_labor_hours,
    burn.effective_labor_hours,
    now()
  from (values (75), (90), (100), (110)) as threshold(threshold_percent)
  where burn.labor_burn_percent >= threshold.threshold_percent
  on conflict (job_id, threshold_percent) do nothing
  returning job_labor_threshold_events.*;
end;
$$;

revoke all on function public.evaluate_job_labor_thresholds(uuid)
from public, anon, authenticated;
grant execute on function public.evaluate_job_labor_thresholds(uuid)
to authenticated;

notify pgrst, 'reload schema';
commit;
