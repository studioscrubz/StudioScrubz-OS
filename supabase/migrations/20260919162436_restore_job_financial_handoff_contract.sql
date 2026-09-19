-- Restore the application-facing Job financial-handoff lookup to the tracked
-- migration chain. The underlying handoff predicate and operational Job RPCs
-- are already migration-backed and match their verified live definitions.
create or replace function public.get_financially_handed_off_job_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.has_any_role(array[
      'Master Admin',
      'Administrator',
      'Manager'
    ])
  then
    raise exception 'Financial Job handoff access is denied.';
  end if;

  return query
    select job.id
    from public.jobs job
    where public.is_job_financially_handed_off(job.id);
end;
$$;

revoke all on function public.get_financially_handed_off_job_ids()
from public, anon, authenticated;

grant execute on function public.get_financially_handed_off_job_ids()
to authenticated;
