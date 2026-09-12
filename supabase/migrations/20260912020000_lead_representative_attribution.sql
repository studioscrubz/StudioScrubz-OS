-- Lead attribution only. Review/apply separately; no login role or pricing changes.

begin;

alter table public.employees
drop constraint if exists employees_department_check;

alter table public.employees
add constraint employees_department_check
check (
  department in (
    'Scrub Technicians',
    'Sales',
    'Lead Representative',
    'Administration',
    'Management'
  )
);


alter table public.estimates
add column lead_representative_id uuid
references public.employees(id)
on delete restrict;

alter table public.proposals
add column lead_representative_id uuid
references public.employees(id)
on delete restrict;

alter table public.jobs
add column lead_representative_id uuid
references public.employees(id)
on delete restrict;


create index estimates_lead_representative_idx
on public.estimates(lead_representative_id)
where lead_representative_id is not null;

create index proposals_lead_representative_idx
on public.proposals(lead_representative_id)
where lead_representative_id is not null;

create index jobs_lead_representative_idx
on public.jobs(lead_representative_id)
where lead_representative_id is not null;


create function public.get_lead_representatives(
  p_estimate_id uuid default null
)
returns table(
  id uuid,
  display_name text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_id uuid;
begin

  -- These are the existing estimate-viewing roles,
  -- not a new employee/login role.
  if auth.uid() is null
    or not public.has_any_role(
      array['Master Admin', 'Administrator', 'Sales']
    )
  then
    raise exception
      'Lead Representative lookup access denied.'
      using errcode = '42501';
  end if;


  select e.lead_representative_id
  into selected_id
  from public.estimates e
  where e.id = p_estimate_id;


  return query

  select
    e.id,

    coalesce(
      nullif(
        btrim(e.preferred_name),
        ''
      ),
      btrim(
        e.first_name || ' ' || e.last_name
      )
    ),

    (
      e.department = 'Lead Representative'
      and e.employment_status = 'Active'
      and e.archived_at is null
    )

  from public.employees e

  where
    (
      e.department = 'Lead Representative'
      and e.employment_status = 'Active'
      and e.archived_at is null
    )
    or e.id = selected_id

  order by
    2,
    e.id;

end
$$;


revoke all
on function public.get_lead_representatives(uuid)
from public, anon, authenticated;

grant execute
on function public.get_lead_representatives(uuid)
to authenticated;


create function public.validate_estimate_lead_representative()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin

  -- Preserve an unchanged historical value,
  -- including an inactive Lead Representative.
  if tg_op = 'UPDATE'
    and new.lead_representative_id
      is not distinct from old.lead_representative_id
  then
    return new;
  end if;


  -- Null means None / Direct Lead.
  if new.lead_representative_id is null then
    return new;
  end if;


  if auth.uid() is null
    or not public.has_any_role(
      array['Master Admin', 'Administrator', 'Sales']
    )
  then
    raise exception
      'Lead Representative selection access denied.'
      using errcode = '42501';
  end if;


  -- New selections must be active Lead Representatives.
  perform 1
  from public.employees e
  where e.id = new.lead_representative_id
    and e.department = 'Lead Representative'
    and e.employment_status = 'Active'
    and e.archived_at is null
  for share;


  if not found then
    raise exception
      'Select an active Lead Representative or None / Direct Lead.';
  end if;


  return new;

end
$$;


-- Trigger-only function.
-- Callers still need the existing table write/RPC permission.
--
-- Copies only attribution.
-- Source pricing, status and representative_name remain untouched.
create function public.inherit_lead_representative()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inherited uuid;
  source_estimate uuid;
  source_proposal uuid;
begin

  if tg_table_name = 'proposals' then

    -- Once a proposal exists, its Lead Representative
    -- remains the inherited snapshot from its source.
    if tg_op = 'UPDATE'
      and new.estimate_id
        is not distinct from old.estimate_id
      and new.walkthrough_id
        is not distinct from old.walkthrough_id
    then

      if new.lead_representative_id
        is distinct from old.lead_representative_id
      then
        raise exception
          'Proposal Lead Representative is inherited from its source.';
      end if;

      return new;

    end if;


    source_estimate := new.estimate_id;


    -- Walkthrough-created proposals inherit from
    -- the walkthrough's source estimate.
    if source_estimate is null
      and new.walkthrough_id is not null
    then

      select w.estimate_id
      into source_estimate
      from public.walkthroughs w
      where w.id = new.walkthrough_id
      for share;

    end if;


    select e.lead_representative_id
    into inherited
    from public.estimates e
    where e.id = source_estimate
    for share;


  elsif tg_table_name = 'jobs' then

    -- Jobs retain the attribution inherited from their source.
    if tg_op = 'UPDATE'
      and new.proposal_id
        is not distinct from old.proposal_id
      and new.estimate_id
        is not distinct from old.estimate_id
      and new.walkthrough_id
        is not distinct from old.walkthrough_id
      and new.service_occurrence_id
        is not distinct from old.service_occurrence_id
    then

      if new.lead_representative_id
        is distinct from old.lead_representative_id
      then
        raise exception
          'Job Lead Representative is inherited from its source.';
      end if;

      return new;

    end if;


    source_proposal := new.proposal_id;


    -- Agreement/service-occurrence Jobs inherit
    -- from the proposal attached to the agreement.
    if source_proposal is null
      and new.service_occurrence_id is not null
    then

      select a.proposal_id
      into source_proposal
      from public.service_occurrences o
      join public.service_agreements a
        on a.id = o.agreement_id
      where o.id = new.service_occurrence_id
      for share of o, a;

    end if;


    if source_proposal is not null then

      select p.lead_representative_id
      into inherited
      from public.proposals p
      where p.id = source_proposal
      for share;

    else

      source_estimate := new.estimate_id;


      if source_estimate is null
        and new.walkthrough_id is not null
      then

        select w.estimate_id
        into source_estimate
        from public.walkthroughs w
        where w.id = new.walkthrough_id
        for share;

      end if;


      select e.lead_representative_id
      into inherited
      from public.estimates e
      where e.id = source_estimate
      for share;

    end if;


  else

    raise exception
      'Unsupported Lead Representative attribution target.';

  end if;


  -- Inserts may not override source attribution.
  if tg_op = 'INSERT'
    and new.lead_representative_id is not null
    and new.lead_representative_id
      is distinct from inherited
  then
    raise exception
      'Lead Representative must match the source attribution.';
  end if;


  new.lead_representative_id := inherited;

  return new;

end
$$;


revoke all
on function
  public.validate_estimate_lead_representative(),
  public.inherit_lead_representative()
from public, anon, authenticated;


create trigger estimates_lead_representative
before insert or update
on public.estimates
for each row
execute function public.validate_estimate_lead_representative();


create trigger proposals_lead_representative
before insert or update
on public.proposals
for each row
execute function public.inherit_lead_representative();


create trigger jobs_lead_representative
before insert or update
on public.jobs
for each row
execute function public.inherit_lead_representative();


notify pgrst, 'reload schema';

commit;