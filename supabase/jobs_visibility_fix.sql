-- StudioScrubz OS: active Jobs workflow visibility for restricted roles.
-- REVIEW ONLY. Do not execute automatically.
-- The return type remains the non-financial Phase 18 projection view.

create or replace function public.get_operational_jobs(
  p_start date default null,
  p_end date default null
)
returns setof public.jobs_operational_safe
language sql
stable
security definer
set search_path = ''
as $$
  select j.*
  from public.jobs_operational_safe j
  where j.archived_at is null
    and j.status in (
      'Ready to Schedule',
      'Scheduled',
      'Crew Assigned',
      'In Progress',
      'Completed',
      'Cancelled'
    )
    and (p_start is null or j.scheduled_date >= p_start)
    and (p_end is null or j.scheduled_date <= p_end)
  order by j.created_at desc
$$;

revoke all on function public.get_operational_jobs(date, date)
from public, anon, authenticated;
grant execute on function public.get_operational_jobs(date, date)
to authenticated;
