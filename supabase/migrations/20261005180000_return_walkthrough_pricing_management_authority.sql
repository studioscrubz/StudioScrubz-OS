begin;

create or replace function public.return_walkthrough_pricing_to_assessment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  walkthrough public.walkthroughs;
begin
  if (select auth.uid()) is null
    or not public.has_any_role(array['Master Admin', 'Administrator']) then
    raise exception 'Management pricing correction access denied' using errcode = '42501';
  end if;

  select *
  into walkthrough
  from public.walkthroughs
  where id = p_id
  for update;

  if not found
    or walkthrough.status <> 'Completed'
    or walkthrough.archived_at is not null
    or walkthrough.walkthrough_date is null
    or walkthrough.walkthrough_time is null then
    raise exception 'Completed walkthrough is not available' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.proposals proposal
    where proposal.walkthrough_id = p_id
      and proposal.archived_at is null
  ) then
    raise exception 'An active Proposal already exists' using errcode = '23505';
  end if;

  update public.walkthroughs
  set status = 'Scheduled',
      sales_stage = 'Assessment In Progress'
  where id = p_id;
end;
$$;

revoke all on function public.return_walkthrough_pricing_to_assessment(uuid)
from public, anon, authenticated;
grant execute on function public.return_walkthrough_pricing_to_assessment(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
