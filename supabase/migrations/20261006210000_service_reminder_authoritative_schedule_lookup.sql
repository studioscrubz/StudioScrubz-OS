-- Service Reminder must use the same two scheduling sources shown by the
-- operational Schedule: materialized Jobs and generated recurring occurrences
-- that have not yet been materialized into Jobs.
begin;

drop function public.get_upcoming_client_jobs(uuid, integer);

create function public.get_upcoming_client_jobs(
  p_client_id uuid,
  p_days integer default 365
)
returns table (
  source_type text,
  source_id uuid,
  client_id uuid,
  property_id uuid,
  service_name text,
  scheduled_date date,
  start_time time without time zone,
  property_address text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text := coalesce(
    (select settings.timezone from public.business_settings settings limit 1),
    'America/Los_Angeles'
  );
  v_now timestamp without time zone;
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin', 'Administrator', 'Manager', 'Sales'])
  then
    raise exception 'Communication scheduled service access is denied.' using errcode = '42501';
  end if;

  if p_client_id is null or p_days is null or p_days < 1 or p_days > 3660 then
    raise exception 'A valid client and day range are required.' using errcode = '22023';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names zone where zone.name = v_timezone) then
    v_timezone := 'America/Los_Angeles';
  end if;
  v_now := clock_timestamp() at time zone v_timezone;

  return query
    with scheduled_services as (
      select
        'Job'::text as source_type,
        job.id as source_id,
        job.client_id,
        job.property_id,
        coalesce(nullif(btrim(job.service_name), ''), 'Scheduled Service') as service_name,
        job.scheduled_date,
        job.start_time,
        job.created_at,
        nullif(concat_ws(', ',
          nullif(btrim(property.address), ''),
          nullif(btrim(property.address_line_2), ''),
          nullif(concat_ws(' ',
            nullif(concat_ws(', ', nullif(btrim(property.city), ''), nullif(btrim(property.state), '')), ''),
            nullif(btrim(property.zip), '')
          ), '')
        ), '') as property_address
      from public.jobs job
      left join public.properties property on property.id = job.property_id
      where job.client_id = p_client_id
        and job.scheduled_date between v_now::date and v_now::date + p_days
        and job.scheduled_date + coalesce(job.start_time, time '23:59:59') >= v_now
        and job.archived_at is null
        and job.status in ('Ready to Schedule', 'Scheduled', 'Crew Assigned')

      union all

      select
        'Service Occurrence'::text,
        occurrence.id,
        agreement.client_id,
        agreement.property_id,
        coalesce(nullif(btrim(agreement.service_name), ''), 'Scheduled Service'),
        occurrence.scheduled_date,
        occurrence.scheduled_start_time,
        occurrence.created_at,
        nullif(concat_ws(', ',
          nullif(btrim(property.address), ''),
          nullif(btrim(property.address_line_2), ''),
          nullif(concat_ws(' ',
            nullif(concat_ws(', ', nullif(btrim(property.city), ''), nullif(btrim(property.state), '')), ''),
            nullif(btrim(property.zip), '')
          ), '')
        ), '')
      from public.service_occurrences occurrence
      join public.service_agreements agreement on agreement.id = occurrence.agreement_id
      left join public.properties property on property.id = agreement.property_id
      where agreement.client_id = p_client_id
        and agreement.status = 'Active'
        and agreement.archived_at is null
        and occurrence.job_id is null
        and occurrence.status = 'Scheduled'
        and occurrence.scheduled_date between v_now::date and v_now::date + p_days
        and occurrence.scheduled_date + coalesce(occurrence.scheduled_start_time, time '23:59:59') >= v_now
    )
    select
      service.source_type,
      service.source_id,
      service.client_id,
      service.property_id,
      service.service_name,
      service.scheduled_date,
      service.start_time,
      service.property_address
    from scheduled_services service
    order by service.scheduled_date, service.start_time nulls last, service.created_at, service.source_id;
end;
$$;

revoke all on function public.get_upcoming_client_jobs(uuid, integer)
from public, anon, authenticated;
grant execute on function public.get_upcoming_client_jobs(uuid, integer)
to authenticated;

notify pgrst, 'reload schema';
commit;
