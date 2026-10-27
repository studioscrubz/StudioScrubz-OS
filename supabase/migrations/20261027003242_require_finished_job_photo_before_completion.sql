-- Require durable finished-job photo evidence before the atomic END JOB workflow.

create or replace function private.require_finished_job_photo(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.jobs job
    cross join lateral jsonb_array_elements(coalesce(job.photos, '[]'::jsonb)) photo
    join storage.objects object
      on object.bucket_id = 'operational-photos'
     and object.name = photo->>'storagePath'
    where job.id = p_job_id
      and photo->>'category' = 'After'
      and photo->>'storagePath' like 'jobs/' || p_job_id::text || '/after/%'
      and public.is_valid_operational_photo_path('jobs', p_job_id, photo->>'storagePath')
      and photo->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and photo->>'mimeType' in ('image/jpeg','image/png','image/webp','image/heic','image/heif')
      and case
        when photo->>'sizeBytes' ~ '^[0-9]{1,8}$' then (photo->>'sizeBytes')::bigint
        else 0
      end between 1 and 10485760
  ) then
    raise exception 'Upload finished-job photos before ending this job.';
  end if;
end;
$$;

revoke all on function private.require_finished_job_photo(uuid)
from public, anon, authenticated, service_role;

-- Preserve the existing equipment-clearance wrapper and its delegation to the
-- atomic team completion routine. The photo check happens before any payroll,
-- attendance, Job status, or invoice handoff can change.
create or replace function public.complete_in_progress_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.jobs;
  unresolved integer;
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then
    raise exception 'Job completion permission denied.';
  end if;

  select * into job
  from public.jobs
  where id = p_job_id
  for update;

  if not found or not public.can_control_job_timer(job.assigned_employee_id, job.assigned_crew_id) then
    raise exception 'Job not found or access denied.';
  end if;

  if job.status = 'In Progress' then
    perform private.require_finished_job_photo(job.id);

    select count(*) into unresolved
    from public.job_equipment_assignments assignment
    where assignment.job_id = job.id
      and assignment.released_at is null
      and not exists (
        select 1
        from public.job_equipment_clearances clearance
        where clearance.assignment_id = assignment.id
          and clearance.checkpoint = 'End Job'
          and clearance.status = 'Cleared'
      );

    if unresolved > 0 then
      raise exception '% equipment custodian(s) must complete End Job clearance.', unresolved;
    end if;
  end if;

  return public.complete_in_progress_job_before_equipment(job.id);
end;
$$;

revoke all on function public.complete_in_progress_job(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.complete_in_progress_job(uuid) to authenticated;

-- Defense in depth for any present or future path that transitions a Job to
-- Completed without calling complete_in_progress_job. A trigger exception
-- rolls the containing statement/transaction back, so clock-out and invoice
-- work cannot partially commit.
create or replace function private.enforce_finished_job_photo_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'Completed' and old.status is distinct from 'Completed' then
    perform private.require_finished_job_photo(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_require_finished_photo_before_completion on public.jobs;
create trigger jobs_require_finished_photo_before_completion
before update of status on public.jobs
for each row execute function private.enforce_finished_job_photo_on_completion();

revoke all on function private.enforce_finished_job_photo_on_completion()
from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
