-- Requires the preceding operational-contact migration. Apply separately.
begin;
alter table public.jobs add column on_my_way_initiated_at timestamptz;

create or replace function public.get_operational_jobs(p_start date default null, p_end date default null)
returns setof jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(
    array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']
  ) then
    raise exception 'Job access is denied.';
  end if;

  return query
    select to_jsonb(job) || jsonb_build_object(
      'client_phone', contact.phone,
      'client_first_name', contact.first_name,
      'on_my_way_initiated_at', persisted.on_my_way_initiated_at
    )
    from public._get_operational_jobs_without_contact(p_start, p_end) job
    join public.jobs persisted on persisted.id = job.id
    left join public.clients contact on contact.id = job.client_id
      and public.has_any_role(array['Crew Lead','Scrub Technician'])
      and public.current_employee_id() is not null
      and public.is_assigned_to_crew(job.assigned_crew_id)
    order by job.created_at desc;
end;
$$;

revoke all on function public.get_operational_jobs(date, date) from public, anon, authenticated;
grant execute on function public.get_operational_jobs(date, date) to authenticated;

create function public.initiate_job_on_my_way(p_job_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_phone text;
  v_started timestamptz;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then
    raise exception 'On My Way access denied.';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found or access denied.'; end if;
  if public.has_any_role(array['Crew Lead','Scrub Technician']) and
    (public.current_employee_id() is null or v_job.assigned_crew_id is null or not public.is_assigned_to_crew(v_job.assigned_crew_id)) then
    raise exception 'Job not found or access denied.';
  end if;
  if not exists(select 1 from public.get_operational_job_ids(null, null) permitted where permitted = p_job_id) then
    raise exception 'Job not found or access denied.';
  end if;
  if v_job.archived_at is not null or v_job.status in ('Completed','Cancelled','Archived')
    or v_job.scheduled_date is null or v_job.start_time is null then
    raise exception 'This Job is not eligible for On My Way.';
  end if;
  select phone into v_phone from public.clients where id = v_job.client_id;
  if v_phone is null or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 7 and 15 then
    raise exception 'A valid client phone number is required.';
  end if;
  if v_job.on_my_way_initiated_at is not null then
    return jsonb_build_object('initiated', false, 'initiated_at', v_job.on_my_way_initiated_at);
  end if;
  update public.jobs set on_my_way_initiated_at = now()
    where id = p_job_id and on_my_way_initiated_at is null
    returning on_my_way_initiated_at into v_started;
  return jsonb_build_object('initiated', true, 'initiated_at', v_started);
end;
$$;
revoke all on function public.initiate_job_on_my_way(uuid) from public, anon, authenticated;
grant execute on function public.initiate_job_on_my_way(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
