\set ON_ERROR_STOP on

begin;

insert into auth.users(id, email, role, aud) values
  ('72000000-0000-4000-8000-000000000001', 'restore-admin@example.invalid', 'authenticated', 'authenticated'),
  ('72000000-0000-4000-8000-000000000002', 'restore-tech@example.invalid', 'authenticated', 'authenticated');

insert into public.user_profiles(id, email, display_name, role, is_active) values
  ('72000000-0000-4000-8000-000000000001', 'restore-admin@example.invalid', 'Restore Admin', 'Administrator', true),
  ('72000000-0000-4000-8000-000000000002', 'restore-tech@example.invalid', 'Restore Tech', 'Scrub Technician', true);

insert into public.crews(id, crew_name, status) values
  ('72000000-0000-4000-8000-000000000010', 'Restore Test Crew', 'Active');

insert into public.jobs(
  id, job_number, division, status, client_name, property_name, service_name,
  scheduled_date, start_time, estimated_duration, assigned_crew_id,
  assigned_crew_name, assigned_team, price, pricing_snapshot, internal_notes
) values
  (
    '72000000-0000-4000-8000-000000000020', 'JOB-RESTORE-SUCCESS',
    'Commercial', 'Cancelled', 'Restore Client', 'Restore Property', 'Restore Service',
    current_date + 5, '12:00', 5, '72000000-0000-4000-8000-000000000010',
    'Restore Test Crew', '[{"employee_id":"retained"}]'::jsonb, 425,
    '{"source":"retained"}'::jsonb, 'Retained cancellation context'
  ),
  (
    '72000000-0000-4000-8000-000000000021', 'JOB-RESTORE-UNAUTHORIZED',
    'Residential', 'Cancelled', 'Restore Client', 'Restore Property', 'Restore Service',
    current_date + 6, '09:00', 2, null, null, '[]'::jsonb, 125,
    '{"source":"retained"}'::jsonb, null
  ),
  (
    '72000000-0000-4000-8000-000000000022', 'JOB-RESTORE-CONFLICT',
    'Commercial', 'Cancelled', 'Restore Client', 'Restore Property', 'Restore Service',
    current_date + 7, '12:00', 5, '72000000-0000-4000-8000-000000000010',
    'Restore Test Crew', '[]'::jsonb, 200, null, null
  ),
  (
    '72000000-0000-4000-8000-000000000023', 'JOB-RESTORE-CONFLICT-ACTIVE',
    'Commercial', 'Crew Assigned', 'Other Client', 'Other Property', 'Other Service',
    current_date + 7, '13:00', 2, '72000000-0000-4000-8000-000000000010',
    'Restore Test Crew', '[]'::jsonb, 200, null, null
  );

create temporary table original_restore_job as
select to_jsonb(job) - array['status','updated_at']::text[] as retained
from public.jobs job
where id = '72000000-0000-4000-8000-000000000020';
grant select on original_restore_job to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);

select public.restore_non_archived_cancelled_job('72000000-0000-4000-8000-000000000020');
select public.restore_non_archived_cancelled_job('72000000-0000-4000-8000-000000000020');

reset role;
do $$
declare
  restored public.jobs;
  retained jsonb;
begin
  select * into restored from public.jobs where id = '72000000-0000-4000-8000-000000000020';
  select original_restore_job.retained into retained from original_restore_job;

  if restored.status is distinct from 'Crew Assigned' then
    raise exception 'Expected Crew Assigned, got %.', restored.status;
  end if;
  if (to_jsonb(restored) - array['status','updated_at']::text[]) is distinct from retained then
    raise exception 'Restoration changed retained Job fields.';
  end if;
  if (select count(*) from public.job_lifecycle_events where job_id = restored.id and event_type = 'Restored and Reopened') <> 1 then
    raise exception 'Restoration audit was not exactly-once.';
  end if;
  if not exists (
    select 1 from public.job_lifecycle_events
    where job_id = restored.id
      and actor_user_id = '72000000-0000-4000-8000-000000000001'
      and previous_status = 'Cancelled'
      and new_status = 'Crew Assigned'
      and metadata @> '{"restoration_kind":"non_archived_cancelled_job","history_retained":true}'::jsonb
  ) then
    raise exception 'Restoration audit attribution or metadata is missing.';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
do $$
begin
  begin
    perform public.restore_non_archived_cancelled_job('72000000-0000-4000-8000-000000000021');
    raise exception 'Expected unauthorized restoration rejection.';
  exception
    when sqlstate '42501' then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
do $$
begin
  begin
    perform public.restore_non_archived_cancelled_job('72000000-0000-4000-8000-000000000022');
    raise exception 'Expected worker scheduling conflict rejection.';
  exception
    when others then
      if sqlerrm not like '%assigned worker has a scheduling conflict%' then
        raise;
      end if;
  end;
end;
$$;

reset role;
do $$
begin
  if not exists (
    select 1 from public.jobs
    where id = '72000000-0000-4000-8000-000000000021'
      and status = 'Cancelled'
      and archived_at is null
  ) then
    raise exception 'Unauthorized test Job was changed.';
  end if;
  if not exists (
    select 1 from public.jobs
    where id = '72000000-0000-4000-8000-000000000022'
      and status = 'Cancelled'
      and archived_at is null
  ) then
    raise exception 'Conflicting test Job was changed.';
  end if;
end;
$$;

rollback;
