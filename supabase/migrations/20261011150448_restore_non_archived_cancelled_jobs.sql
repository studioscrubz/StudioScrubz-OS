-- Reopen retained Cancelled Jobs without requiring an archive round-trip.
begin;

create function public.restore_non_archived_cancelled_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_safe public.jobs_operational_safe;
  v_new_status text;
  v_actor uuid := auth.uid();
begin
  if v_actor is null
    or not public.has_any_role(array['Master Admin','Administrator','Manager'])
  then
    raise exception 'Job restore permission denied.' using errcode = '42501';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Job not found.';
  end if;

  -- A retry after a committed restoration is a read-only success. Requiring
  -- the exact immutable audit event prevents this branch from reopening or
  -- blessing an unrelated active Job.
  if v_job.archived_at is null
    and v_job.status in ('Ready to Schedule','Scheduled','Crew Assigned')
    and exists (
      select 1
      from public.job_lifecycle_events event
      where event.job_id = v_job.id
        and event.event_type = 'Restored and Reopened'
        and event.previous_status = 'Cancelled'
        and event.new_status = v_job.status
        and event.metadata @> '{"restoration_kind":"non_archived_cancelled_job"}'::jsonb
    )
  then
    select * into v_safe
    from public.jobs_operational_safe
    where id = v_job.id;
    if not found then
      raise exception 'Restored Job is outside your permitted scope.';
    end if;
    return v_safe;
  end if;

  if v_job.archived_at is not null
    or v_job.status is distinct from 'Cancelled'
  then
    raise exception 'Only a non-archived Cancelled Job can be restored.';
  end if;

  if public.is_job_financially_handed_off(v_job.id)
    or exists (select 1 from public.invoices invoice where invoice.job_id = v_job.id)
    or exists (select 1 from public.invoice_job_lines line where line.job_id = v_job.id)
    or exists (select 1 from public.payments payment where payment.job_id = v_job.id)
    or exists (
      select 1
      from public.payments payment
      join public.invoices invoice on invoice.id = payment.invoice_id
      where invoice.job_id = v_job.id
    )
    or exists (
      select 1
      from public.payments payment
      join public.invoice_job_lines line on line.invoice_id = payment.invoice_id
      where line.job_id = v_job.id
    )
  then
    raise exception 'This Cancelled Job cannot be restored because it has invoice, payment, or financial handoff history that must be retained.';
  end if;

  if v_job.proposal_id is not null
    and v_job.service_occurrence_id is null
    and exists (
      select 1
      from public.jobs other
      where other.id <> v_job.id
        and other.proposal_id = v_job.proposal_id
        and other.service_occurrence_id is null
        and other.archived_at is null
        and other.status not in ('Cancelled','Archived')
    )
  then
    raise exception 'This Cancelled Job cannot be restored because another active one-time Job already exists for its Proposal.';
  end if;

  if v_job.service_occurrence_id is not null
    and exists (
      select 1
      from public.jobs other
      where other.id <> v_job.id
        and other.service_occurrence_id = v_job.service_occurrence_id
        and other.archived_at is null
        and other.status not in ('Cancelled','Archived')
    )
  then
    raise exception 'This Cancelled Job cannot be restored because another active Job already exists for its Service occurrence.';
  end if;

  if num_nonnulls(v_job.assigned_employee_id, v_job.assigned_crew_id) > 1 then
    raise exception 'This Cancelled Job has an invalid worker assignment and cannot be restored.';
  end if;

  if v_job.scheduled_date is not null
    and v_job.start_time is not null
    and coalesce(v_job.estimated_duration, 0) > 0
    and exists (
      select 1
      from public.jobs other
      where other.id <> v_job.id
        and other.archived_at is null
        and other.status not in ('Cancelled','Archived')
        and other.scheduled_date = v_job.scheduled_date
        and other.start_time is not null
        and coalesce(other.estimated_duration, 0) > 0
        and (
          (v_job.assigned_crew_id is not null and other.assigned_crew_id = v_job.assigned_crew_id)
          or (v_job.assigned_employee_id is not null and other.assigned_employee_id = v_job.assigned_employee_id)
        )
        and other.start_time < v_job.start_time
          + make_interval(mins => round(v_job.estimated_duration * 60)::integer)
        and v_job.start_time < other.start_time
          + make_interval(mins => round(other.estimated_duration * 60)::integer)
    )
  then
    raise exception 'This Cancelled Job cannot be restored because its assigned worker has a scheduling conflict.';
  end if;

  v_new_status := case
    when v_job.scheduled_date is null then 'Ready to Schedule'
    when num_nonnulls(v_job.assigned_employee_id, v_job.assigned_crew_id) = 0 then 'Scheduled'
    else 'Crew Assigned'
  end;

  update public.jobs
  set status = v_new_status
  where id = v_job.id;

  insert into public.job_lifecycle_events(
    job_id,
    job_number,
    event_type,
    previous_status,
    new_status,
    actor_user_id,
    metadata
  ) values (
    v_job.id,
    v_job.job_number,
    'Restored and Reopened',
    'Cancelled',
    v_new_status,
    v_actor,
    jsonb_build_object(
      'restoration_kind', 'non_archived_cancelled_job',
      'history_retained', true
    )
  );

  select * into v_safe
  from public.jobs_operational_safe
  where id = v_job.id;
  if not found then
    raise exception 'Restored Job is outside your permitted scope.';
  end if;
  return v_safe;
exception
  when unique_violation then
    raise exception 'This Cancelled Job cannot be restored because another active Job conflicts with its Proposal or Service occurrence.';
end;
$$;

revoke all on function public.restore_non_archived_cancelled_job(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.restore_non_archived_cancelled_job(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
