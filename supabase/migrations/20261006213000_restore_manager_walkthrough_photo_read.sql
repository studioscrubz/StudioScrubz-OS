-- Keep Walkthrough photo reads aligned with the existing Walkthrough read policy.
-- Job photo authorization is intentionally unchanged.
create or replace function public.can_read_operational_photo_record(
  p_record_type text,
  p_record_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then return false; end if;

  if p_record_type = 'walkthroughs' then
    return (
      public.has_any_role(array['Master Admin', 'Administrator', 'Manager', 'Sales'])
      and exists (select 1 from public.walkthroughs where id = p_record_id)
    ) or public.can_perform_scheduled_walkthrough(p_record_id);
  end if;

  v_role := public.current_user_role();
  if v_role in ('Master Admin', 'Administrator', 'Manager') then
    if p_record_type = 'jobs' then
      return exists (select 1 from public.jobs where id = p_record_id);
    end if;
    return false;
  end if;

  if p_record_type = 'jobs' then
    return v_role in ('Crew Lead', 'Scrub Technician') and exists (
      select 1 from public.jobs job
      where job.id = p_record_id
        and public.is_assigned_to_crew(job.assigned_crew_id)
    );
  end if;

  return false;
end;
$$;

revoke all on function public.can_read_operational_photo_record(text, uuid)
from public, anon, authenticated;
grant execute on function public.can_read_operational_photo_record(text, uuid)
to authenticated;

