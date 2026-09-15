-- Client-scoped, read-only scheduled Job projection for Communication Log.
-- Jobs remain the scheduling system of record. This does not grant operational
-- Job access or expose financial/internal Job fields.
begin;

create function public.get_upcoming_client_jobs(
  p_client_id uuid,
  p_days integer default 365
)
returns table (
  job_id uuid,
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
  v_start date := (
    clock_timestamp() at time zone coalesce(
      (select settings.timezone from public.business_settings settings limit 1),
      'America/Los_Angeles'
    )
  )::date;
begin
  if auth.uid() is null
    or not public.has_any_role(array['Master Admin', 'Administrator', 'Manager', 'Sales'])
  then
    raise exception 'Communication scheduled Job access is denied.' using errcode = '42501';
  end if;

  if p_client_id is null or p_days is null or p_days < 1 or p_days > 3660 then
    raise exception 'A valid client and day range are required.' using errcode = '22023';
  end if;

  return query
    select
      j.id,
      j.client_id,
      j.property_id,
      j.service_name,
      j.scheduled_date,
      j.start_time,
      nullif(concat_ws(', ',
        nullif(btrim(p.address), ''),
        nullif(btrim(p.address_line_2), ''),
        nullif(concat_ws(' ',
          nullif(concat_ws(', ', nullif(btrim(p.city), ''), nullif(btrim(p.state), '')), ''),
          nullif(btrim(p.zip), '')
        ), '')
      ), '')
    from public.jobs j
    left join public.properties p on p.id = j.property_id
    where j.client_id = p_client_id
      and j.scheduled_date between v_start and v_start + p_days
      and j.archived_at is null
      and j.status in ('Scheduled', 'Crew Assigned', 'In Progress')
    order by j.scheduled_date, j.start_time nulls last, j.created_at;
end;
$$;

revoke all on function public.get_upcoming_client_jobs(uuid, integer)
from public, anon, authenticated;
grant execute on function public.get_upcoming_client_jobs(uuid, integer)
to authenticated;

notify pgrst, 'reload schema';
commit;
