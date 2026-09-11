-- Sales proposal routing only; no operational Job access. Apply separately.
begin;

create or replace function public.get_sales_job_proposal_ids()
returns table(proposal_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_role('Sales') then
    raise exception 'Sales proposal routing access is denied.' using errcode = '42501';
  end if;
  -- Mirrors the Sales branch of Proposal role read: active Sales profiles may
  -- read proposals without an employee/crew restriction. Do not return Job IDs.
  return query
    select distinct p.id
    from public.proposals p
    join public.jobs j on j.proposal_id = p.id
    where j.archived_at is null;
end;
$$;

revoke all on function public.get_sales_job_proposal_ids() from public, anon, authenticated;
grant execute on function public.get_sales_job_proposal_ids() to authenticated;

commit;
