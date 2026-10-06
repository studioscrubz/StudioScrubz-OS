begin;

create function public.get_job_live_labor_burn(p_job_id uuid)
returns table (
  job_id uuid,
  effective_labor_hours numeric,
  live_performance_labor_hours numeric,
  labor_burn_percent numeric,
  current_threshold integer,
  job_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job public.jobs;
  budget numeric;
  live_hours numeric;
  burn numeric;
begin
  if auth.uid() is null
    or not public.has_any_role(array[
      'Master Admin', 'Administrator', 'Manager', 'Crew Lead', 'Scrub Technician'
    ]) then
    raise exception 'Live labor visibility denied.' using errcode = '42501';
  end if;

  select * into job
  from public.jobs
  where id = p_job_id;

  if not found
    or job.status <> 'In Progress'
    or job.archived_at is not null
    or not public.can_access_job_assignment(
      job.assigned_employee_id,
      job.assigned_crew_id
    ) then
    raise exception 'Active Job is not available.' using errcode = '42501';
  end if;

  select case
    when snapshot.job_id is null then null
    else greatest(
      snapshot.budgeted_labor_hours
      + coalesce(adjustment.labor_hours_delta, 0),
      0
    )
  end
  into budget
  from public.jobs selected_job
  left join public.job_labor_budget_snapshots snapshot
    on snapshot.job_id = selected_job.id
  left join lateral (
    select coalesce(sum(item.labor_hours_delta), 0) as labor_hours_delta
    from public.job_labor_budget_adjustments item
    where item.job_id = selected_job.id
  ) adjustment on true
  where selected_job.id = job.id;

  select coalesce(sum(
    case
      when entry.status in ('Completed', 'Approved') then entry.total_hours
      when entry.status = 'Open' and entry.clock_out is null then greatest(
        extract(epoch from (now() - entry.clock_in)) / 3600
        - greatest(entry.break_minutes, 0) / 60.0,
        0
      )
      else 0
    end
  ), 0)
  into live_hours
  from public.time_entries entry
  where entry.job_id = job.id
    and entry.employee_id is not null
    and entry.entry_type = 'Job'
    and entry.labor_classification = 'Production'
    and entry.status in ('Open', 'Completed', 'Approved')
    and entry.archived_at is null;

  burn := case
    when budget is not null and budget > 0
      then round((live_hours / budget) * 100, 2)
    else null
  end;

  return query select
    job.id,
    budget,
    live_hours,
    burn,
    case
      when burn >= 110 then 110
      when burn >= 100 then 100
      when burn >= 90 then 90
      when burn >= 75 then 75
      else null
    end,
    job.status;
end;
$$;

revoke all on function public.get_job_live_labor_burn(uuid)
from public, anon, authenticated;
grant execute on function public.get_job_live_labor_burn(uuid)
to authenticated;

notify pgrst, 'reload schema';
commit;
