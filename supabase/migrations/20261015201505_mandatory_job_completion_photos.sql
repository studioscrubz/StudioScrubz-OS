-- Require three persisted After photos before a Job can become Completed.
-- Existing Completed Jobs are historical and are not changed or backfilled.
begin;

create table public.job_completion_photo_overrides (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  administrator_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 15 and 2000),
  after_photo_count integer not null check (after_photo_count between 0 and 2),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint job_completion_photo_override_completion check (
    completed_at is null or completed_at >= created_at
  )
);

create index job_completion_photo_overrides_job_idx
  on public.job_completion_photo_overrides(job_id, created_at desc);

alter table public.job_completion_photo_overrides enable row level security;
revoke all on table public.job_completion_photo_overrides from public, anon, authenticated;
grant select on table public.job_completion_photo_overrides to authenticated;
create policy job_completion_photo_overrides_master_admin_read
on public.job_completion_photo_overrides for select to authenticated
using ((select auth.uid()) is not null and public.has_role('Master Admin'));

-- A private, transaction-local-by-lifecycle capability lets only the existing
-- archive restoration RPC restore a historically Completed Job. The trigger
-- consumes the row during that exact UPDATE, so it cannot authorize a later or
-- arbitrary status change.
create table private.job_completion_photo_restore_authorizations (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  actor_id uuid not null,
  historical_completed_at timestamptz not null,
  created_at timestamptz not null default now()
);
revoke all on table private.job_completion_photo_restore_authorizations from public, anon, authenticated;

create or replace function private.saved_job_after_photo_count(p_job_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct photo->>'id')::integer
  from public.jobs job
  cross join lateral jsonb_array_elements(coalesce(job.photos, '[]'::jsonb)) photo
  join storage.objects object
    on object.bucket_id = 'operational-photos'
   and object.name = photo->>'storagePath'
  where job.id = p_job_id
    and jsonb_typeof(photo) = 'object'
    and photo->>'category' = 'After'
    and coalesce(photo->>'id', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    and public.is_valid_operational_photo_path('jobs', p_job_id, photo->>'storagePath');
$$;
revoke all on function private.saved_job_after_photo_count(uuid) from public, anon, authenticated;

-- The trigger trusts only an uncompleted audit row inserted by the definer RPC.
-- Authenticated callers have no INSERT/UPDATE permission on this table, so unlike
-- a custom session setting this capability cannot be forged through the Data API.
create or replace function private.pending_job_completion_photo_override_exists(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.job_completion_photo_overrides override_event
    where override_event.job_id = p_job_id
      and override_event.administrator_id = (select auth.uid())
      and override_event.completed_at is null
      and public.has_role('Master Admin')
  );
$$;
revoke all on function private.pending_job_completion_photo_override_exists(uuid) from public, anon, authenticated;

create or replace function private.require_job_completion_photos(p_job_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare after_count integer;
begin
  after_count := private.saved_job_after_photo_count(p_job_id);
  if after_count < 3 and not private.pending_job_completion_photo_override_exists(p_job_id) then
    raise exception 'At least 3 saved After photos are required to complete this Job. % more needed.', 3 - after_count;
  end if;
  return after_count;
end;
$$;
revoke all on function private.require_job_completion_photos(uuid) from public, anon, authenticated;

create or replace function private.consume_job_completion_photo_restore_authorization(
  p_job_id uuid,
  p_historical_completed_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare consumed boolean;
begin
  delete from private.job_completion_photo_restore_authorizations authorization
  where authorization.job_id = p_job_id
    and authorization.actor_id = (select auth.uid())
    and authorization.historical_completed_at = p_historical_completed_at
  returning true into consumed;
  return coalesce(consumed, false);
end;
$$;
revoke all on function private.consume_job_completion_photo_restore_authorization(uuid,timestamptz) from public, anon, authenticated;

create or replace function private.guard_job_completion_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'Completed' then
    if tg_op = 'INSERT' then
      perform private.require_job_completion_photos(new.id);
    elsif old.status is distinct from 'Completed' then
      if old.status = 'Archived'
        and old.archived_at is not null
        and old.completed_at is not null
        and new.archived_at is null
        and new.completed_at is not distinct from old.completed_at
        and new.operational_ended_at is not distinct from old.operational_ended_at
        and private.consume_job_completion_photo_restore_authorization(new.id, old.completed_at) then
        return new;
      end if;
      perform private.require_job_completion_photos(new.id);
    end if;
  end if;
  return new;
end;
$$;

-- Preserve the deployed archive-restoration authorization and result contract.
-- The private one-use row is created only after the archived historical state is
-- locked and validated, then consumed by the completion-photo trigger.
create or replace function public.restore_archived_operational_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_safe public.jobs_operational_safe;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator']) then
    raise exception 'Job restore permission denied.';
  end if;
  select *
  into v_job
  from public.jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'Job not found.'; end if;
  if v_job.archived_at is null or v_job.status is distinct from 'Archived' then
    raise exception 'Job is not archived.';
  end if;
  if v_job.completed_at is null then
    raise exception 'Only a historically Completed archived Job can be restored to Completed.';
  end if;

  insert into private.job_completion_photo_restore_authorizations(
    job_id,
    actor_id,
    historical_completed_at
  ) values (
    v_job.id,
    auth.uid(),
    v_job.completed_at
  );

  update public.jobs
  set archived_at = null,
      status = 'Completed'
  where id = v_job.id;

  select * into v_safe from public.jobs_operational_safe where id = v_job.id;
  if not found then raise exception 'Restored Job is outside your permitted scope.'; end if;
  return v_safe;
end;
$$;
revoke all on function private.guard_job_completion_photos() from public, anon, authenticated;
drop trigger if exists jobs_require_completion_photos on public.jobs;
create trigger jobs_require_completion_photos
before insert or update of status on public.jobs
for each row execute function private.guard_job_completion_photos();

-- Keep the deployed attendance and payroll sequence intact, but validate the
-- photo requirement before either attendance or payroll records are changed.
create or replace function public.complete_in_progress_job(p_job_id uuid)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
  safe public.jobs_operational_safe;
  ended timestamptz;
  p public.job_crew_presence;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then
    raise exception 'Job completion permission denied.';
  end if;
  select *
  into j
  from public.jobs
  where id = p_job_id
  for update;
  if not found or not public.can_control_job_timer(j.assigned_employee_id,j.assigned_crew_id) then
    raise exception 'Job not found or access denied.';
  end if;
  if j.status='Completed' then
    select * into safe from public.jobs_operational_safe where id = j.id;
    return safe;
  end if;
  if j.archived_at is not null or j.status<>'In Progress' then
    raise exception 'Only an In Progress Job can be completed.';
  end if;

  perform private.require_job_completion_photos(j.id);

  ended:=now();
  for p in select * from public.job_crew_presence where job_id = j.id and current_status = 'Late' for update loop
    update public.job_crew_presence set current_status='Needs Attendance Review',updated_at=ended where id = p.id;
    insert into public.job_crew_presence_events(job_id,employee_id,presence_id,event_type,from_status,to_status,occurred_at,actor_user_id)
      values(j.id,p.employee_id,p.id,'No Arrival - Review Required','Late','Needs Attendance Review',ended,auth.uid());
  end loop;
  perform public.close_job_payroll_entries(j.id,ended);
  update public.jobs set status='Completed',completed_at=ended,operational_ended_at=ended where id = j.id;
  select * into safe from public.jobs_operational_safe where id = j.id;
  return safe;
end;
$$;

create function public.complete_in_progress_job_with_photo_override(
  p_job_id uuid,
  p_reason text
)
returns public.jobs_operational_safe
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.jobs;
  override_id uuid;
  after_count integer;
  completed_job public.jobs_operational_safe;
  normalized_reason text := regexp_replace(btrim(coalesce(p_reason, '')), '[[:space:]]+', ' ', 'g');
begin
  if auth.uid() is null or not public.has_role('Master Admin') then
    raise exception 'Only an active Master Admin may override completion photo requirements.' using errcode='42501';
  end if;
  if char_length(normalized_reason) < 15 or char_length(normalized_reason) > 2000 then
    raise exception 'Enter an override reason of at least 15 characters.';
  end if;
  select *
  into job_row
  from public.jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'Job not found.'; end if;
  if job_row.archived_at is not null or job_row.status <> 'In Progress' then
    raise exception 'Only an In Progress Job can be completed with an override.';
  end if;
  after_count := private.saved_job_after_photo_count(job_row.id);
  if after_count >= 3 then
    raise exception 'This Job already has the required completion photos; an override is not permitted.';
  end if;
  insert into public.job_completion_photo_overrides(job_id,administrator_id,reason,after_photo_count)
  values(job_row.id,auth.uid(),normalized_reason,after_count)
  returning id into override_id;

  completed_job := public.complete_in_progress_job(job_row.id);

  update public.job_completion_photo_overrides
  set completed_at = now()
  where id = override_id
    and job_id = job_row.id
    and administrator_id = auth.uid()
    and completed_at is null;
  if not found then
    raise exception 'The completion-photo override audit could not be finalized.';
  end if;

  return completed_job;
end;
$$;

revoke all on function public.complete_in_progress_job(uuid) from public, anon, authenticated;
grant execute on function public.complete_in_progress_job(uuid) to authenticated;
revoke all on function public.complete_in_progress_job_with_photo_override(uuid,text) from public, anon, authenticated;
grant execute on function public.complete_in_progress_job_with_photo_override(uuid,text) to authenticated;
revoke all on function public.restore_archived_operational_job(uuid) from public, anon, authenticated;
grant execute on function public.restore_archived_operational_job(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
