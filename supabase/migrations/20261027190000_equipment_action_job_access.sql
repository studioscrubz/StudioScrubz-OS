-- Allow the current equipment custodian to access ONLY jobs with an outstanding
-- final sign-out or incoming handoff, even after financial handoff hides the Job
-- from ordinary operational lists. Never widen normal job visibility.
create or replace function public.get_my_equipment_action_jobs()
returns setof jsonb
language sql stable security definer set search_path=''
as $$
  select to_jsonb(job)
  from public.jobs_operational_safe job
  where auth.uid() is not null
    and public.current_employee_id() is not null
    and (
      exists (
        select 1 from public.get_my_pending_equipment_signouts() pending
        where pending.job_id=job.id
      )
      or exists (
        select 1 from public.job_equipment_handoffs handoff
        where handoff.job_id=job.id
          and handoff.to_employee_id=public.current_employee_id()
          and handoff.acknowledged_at is null
      )
    )
  order by job.created_at desc;
$$;

-- Return ONLY unacknowledged handoffs addressed to the signed-in employee.
create or replace function public.get_my_pending_job_equipment_handoffs(p_job_id uuid)
returns table (handoff_id uuid, reason text, created_at timestamptz)
language sql stable security definer set search_path=''
as $$
  select h.id,h.reason,h.created_at
  from public.job_equipment_handoffs h
  where auth.uid() is not null
    and h.job_id=p_job_id
    and h.to_employee_id=public.current_employee_id()
    and h.acknowledged_at is null
  order by h.created_at desc;
$$;

revoke all on function public.get_my_equipment_action_jobs() from public,anon,authenticated;
grant execute on function public.get_my_equipment_action_jobs() to authenticated;
revoke all on function public.get_my_pending_job_equipment_handoffs(uuid) from public,anon,authenticated;
grant execute on function public.get_my_pending_job_equipment_handoffs(uuid) to authenticated;

notify pgrst,'reload schema';
