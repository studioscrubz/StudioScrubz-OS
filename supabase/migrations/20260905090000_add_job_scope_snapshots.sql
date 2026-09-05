begin;

create table public.scope_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  proposal_id uuid not null references public.proposals(id),
  version integer not null default 1 check (version >= 1),
  snapshot_type text not null default 'Accepted Proposal',
  scope jsonb not null default '[]'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  proposal_result jsonb not null default '{}'::jsonb,
  proposal_notes text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint scope_snapshots_job_version_key unique (job_id, version),
  constraint scope_snapshots_id_job_id_key unique (id, job_id)
);

create index scope_snapshots_proposal_id_idx on public.scope_snapshots(proposal_id);

create table public.scope_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  scope_snapshot_id uuid not null,
  job_id uuid not null references public.jobs(id),
  item_type text not null,
  name text not null,
  description text,
  quantity numeric,
  unit text,
  unit_price numeric,
  line_total numeric,
  metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint scope_snapshot_items_snapshot_job_fkey
    foreign key (scope_snapshot_id, job_id)
    references public.scope_snapshots(id, job_id)
    on delete restrict
);

create index scope_snapshot_items_snapshot_id_idx
  on public.scope_snapshot_items(scope_snapshot_id, sort_order);

alter table public.scope_snapshots enable row level security;
alter table public.scope_snapshot_items enable row level security;

revoke all on table public.scope_snapshots from public, anon, authenticated;
revoke all on table public.scope_snapshot_items from public, anon, authenticated;
grant select on table public.scope_snapshots to authenticated;
grant select on table public.scope_snapshot_items to authenticated;
grant select on table public.scope_snapshots to service_role;
grant select on table public.scope_snapshot_items to service_role;

create policy "Active users read immutable Job scope snapshots"
on public.scope_snapshots for select to authenticated
using (public.is_master_admin());

create policy "Active users read immutable Job scope snapshot items"
on public.scope_snapshot_items for select to authenticated
using (public.is_master_admin());

create view public.job_scope_operational_items
with (security_barrier = true)
as
select
  item.id,
  item.scope_snapshot_id,
  item.job_id,
  item.item_type,
  item.name,
  item.description,
  item.quantity,
  item.unit,
  item.sort_order,
  item.created_at
from public.scope_snapshot_items item
where public.has_any_role(array['Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician']);

revoke all on table public.job_scope_operational_items from public, anon, authenticated;
grant select on table public.job_scope_operational_items to authenticated;

create schema if not exists private;

create or replace function private.ensure_job_scope_v1(
  p_job_id uuid,
  p_proposal_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.proposals;
  v_snapshot_id uuid;
begin
  select proposal.* into v_proposal
  from public.proposals proposal
  where proposal.id = p_proposal_id
    and proposal.status = 'Accepted'
    and proposal.accepted is true;

  if not found then
    raise exception 'An accepted Proposal is required for Scope V1.';
  end if;

  if not exists (
    select 1
    from public.jobs job
    where job.id = p_job_id
      and job.proposal_id = v_proposal.id
      and job.service_occurrence_id is null
  ) then
    raise exception 'Scope V1 requires the matching one-time Proposal Job.';
  end if;

  insert into public.scope_snapshots (
    job_id, proposal_id, version, snapshot_type, scope, pricing,
    proposal_result, proposal_notes, accepted_at
  ) values (
    p_job_id,
    v_proposal.id,
    1,
    'Accepted Proposal',
    case
      when jsonb_typeof(v_proposal.result->'scope') = 'array' then v_proposal.result->'scope'
      else '[]'::jsonb
    end,
    jsonb_build_object('frequency', v_proposal.frequency)
      || (coalesce(v_proposal.result, '{}'::jsonb) - 'scope' - 'terms' - 'serviceName' - 'serviceDescription'),
    coalesce(v_proposal.result, '{}'::jsonb),
    v_proposal.notes,
    v_proposal.accepted_at
  )
  on conflict (job_id, version) do nothing
  returning id into v_snapshot_id;

  if v_snapshot_id is null then
    return;
  end if;

  if nullif(btrim(v_proposal.result->>'serviceName'), '') is not null then
    insert into public.scope_snapshot_items (
      scope_snapshot_id, job_id, item_type, name, description, line_total, metadata, sort_order
    ) values (
      v_snapshot_id,
      p_job_id,
      'Service',
      btrim(v_proposal.result->>'serviceName'),
      nullif(btrim(v_proposal.result->>'serviceDescription'), ''),
      case
        when coalesce(v_proposal.result->>'baseEstimateAmount', '') ~ '^-?([0-9]+)(\.[0-9]+)?$'
          and length(v_proposal.result->>'baseEstimateAmount') <= 30
        then (v_proposal.result->>'baseEstimateAmount')::numeric
        else null
      end,
      jsonb_build_object('source', 'proposal.result'),
      0
    );
  end if;

  insert into public.scope_snapshot_items (
    scope_snapshot_id, job_id, item_type, name, metadata, sort_order
  )
  select
    v_snapshot_id,
    p_job_id,
    'Scope',
    btrim(scope_item.value->>'text'),
    scope_item.value,
    100 + scope_item.ordinality::integer
  from jsonb_array_elements(
    case
      when jsonb_typeof(v_proposal.result->'scope') = 'array' then v_proposal.result->'scope'
      else '[]'::jsonb
    end
  ) with ordinality as scope_item(value, ordinality)
  where nullif(btrim(scope_item.value->>'text'), '') is not null;

  insert into public.scope_snapshot_items (
    scope_snapshot_id, job_id, item_type, name, description, quantity, unit,
    unit_price, line_total, metadata, sort_order
  )
  select
    v_snapshot_id,
    p_job_id,
    'Add-On',
    btrim(adjustment.value->>'label'),
    nullif(btrim(adjustment.value->>'description'), ''),
    case
      when coalesce(adjustment.value->>'quantity', '') ~ '^-?([0-9]+)(\.[0-9]+)?$'
        and length(adjustment.value->>'quantity') <= 30
      then (adjustment.value->>'quantity')::numeric
      else null
    end,
    coalesce(
      nullif(btrim(adjustment.value->>'unitName'), ''),
      nullif(btrim(adjustment.value->>'unitLabel'), '')
    ),
    case
      when coalesce(adjustment.value->>'unitPrice', '') ~ '^-?([0-9]+)(\.[0-9]+)?$'
        and length(adjustment.value->>'unitPrice') <= 30
      then (adjustment.value->>'unitPrice')::numeric
      else null
    end,
    case
      when coalesce(adjustment.value->>'amount', '') ~ '^-?([0-9]+)(\.[0-9]+)?$'
        and length(adjustment.value->>'amount') <= 30
      then (adjustment.value->>'amount')::numeric
      else null
    end,
    adjustment.value,
    1000 + adjustment.ordinality::integer
  from jsonb_array_elements(
    case
      when jsonb_typeof(v_proposal.result->'adjustments') = 'array' then v_proposal.result->'adjustments'
      else '[]'::jsonb
    end
  ) with ordinality as adjustment(value, ordinality)
  where nullif(btrim(adjustment.value->>'catalogAddonId'), '') is not null
    and nullif(btrim(adjustment.value->>'label'), '') is not null;
end;
$$;

revoke all on function private.ensure_job_scope_v1(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_job_from_accepted_proposal(
  p_proposal_id uuid
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_proposal public.proposals;
  v_client public.clients;
  v_property public.properties;
  v_job public.jobs;
  v_price_text text;
  v_labor_text text;
  v_duration_text text;
  v_crew_size_text text;
  v_price numeric;
  v_labor numeric;
  v_duration numeric;
  v_crew_size integer;
  v_attempt integer;
  v_constraint_name text;
begin
  if auth.uid() is null then
    raise exception 'An active authenticated profile is required.';
  end if;
  v_role := public.current_user_role();
  if v_role not in ('Master Admin', 'Administrator', 'Manager') then
    raise exception 'Job creation permission denied.';
  end if;

  select * into v_proposal
  from public.proposals
  where id = p_proposal_id
  for update;
  if not found then raise exception 'Proposal not found.'; end if;
  if v_proposal.status is distinct from 'Accepted' or v_proposal.accepted is not true then
    raise exception 'Only an accepted Proposal can create a Job.';
  end if;
  if v_proposal.archived_at is not null then
    raise exception 'An archived Proposal cannot create a Job.';
  end if;
  if v_proposal.frequency is distinct from 'One-Time' then
    raise exception 'Recurring Proposals must create a Service Agreement.';
  end if;
  if v_proposal.division is null
    or v_proposal.division not in ('Residential', 'Commercial')
  then
    raise exception 'The accepted Proposal does not contain a valid division.';
  end if;

  select * into v_job
  from public.jobs
  where proposal_id = v_proposal.id
    and service_occurrence_id is null
  order by created_at
  limit 1;
  if found then
    perform private.ensure_job_scope_v1(v_job.id, v_proposal.id);
    return v_job;
  end if;

  select * into v_client from public.clients
  where id = v_proposal.client_id and archived_at is null;
  select * into v_property from public.properties
  where id = v_proposal.property_id
    and client_id = v_proposal.client_id
    and archived_at is null;
  if v_client.id is null or v_property.id is null then
    raise exception 'The Proposal requires active matching Client and Property relationships.';
  end if;

  v_price_text := v_proposal.result->>'perVisitTotal';
  v_labor_text := v_proposal.result->>'laborHours';
  v_duration_text := v_proposal.result->>'estimatedDuration';
  v_crew_size_text := v_proposal.result->>'crewRecommendation';
  if coalesce(v_price_text, '') !~ '^([0-9]+)(\.[0-9]+)?$'
    or length(v_price_text) > 18
  then
    raise exception 'The accepted Proposal does not contain a valid authoritative price.';
  end if;
  v_price := round(v_price_text::numeric, 2);
  v_labor := case when coalesce(v_labor_text, '') ~ '^([0-9]+)(\.[0-9]+)?$' and length(v_labor_text) <= 18 then v_labor_text::numeric else 0 end;
  v_duration := case when coalesce(v_duration_text, '') ~ '^([0-9]+)(\.[0-9]+)?$' and length(v_duration_text) <= 18 then v_duration_text::numeric else null end;
  v_crew_size := case when coalesce(v_crew_size_text, '') ~ '^[0-9]+$' and length(v_crew_size_text) <= 9 then greatest(v_crew_size_text::integer, 1) else 1 end;

  for v_attempt in 1..5 loop
    begin
      insert into public.jobs (
        job_number, proposal_id, service_occurrence_id, estimate_id, walkthrough_id,
        client_id, property_id, division, client_name, property_name, service_name,
        frequency, status, scheduled_date, start_time, estimated_duration,
        assigned_crew_id, assigned_crew_name, crew_lead_name, assigned_team,
        price, deposit, balance, labor_hours, recommended_crew_size, scope,
        checklist, photos, access_instructions, internal_notes, completed_at
      ) values (
        'JOB-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'),
        v_proposal.id, null, v_proposal.estimate_id, v_proposal.walkthrough_id,
        v_proposal.client_id, v_proposal.property_id, v_proposal.division,
        coalesce(v_proposal.client_name, v_client.company_name, nullif(concat_ws(' ', v_client.first_name, v_client.last_name), ''), 'Client'),
        coalesce(v_proposal.property_name, v_property.property_name, v_property.address),
        nullif(btrim(v_proposal.result->>'serviceName'), ''), v_proposal.frequency,
        'Ready to Schedule', null, null, v_duration,
        null, null, null, '[]'::jsonb,
        v_price, 0, v_price, v_labor, v_crew_size,
        case when jsonb_typeof(v_proposal.result->'scope') = 'array' then v_proposal.result->'scope' else '[]'::jsonb end,
        '[]'::jsonb, '[]'::jsonb,
        coalesce(nullif(btrim(v_proposal.result#>>'{terms,accessRequirements}'), ''), v_property.access_instructions),
        v_proposal.notes, null
      ) returning * into v_job;
      insert into public.proposal_history (
        proposal_id, event_type, previous_status, new_status, description, performed_by
      ) values (
        v_proposal.id, 'Job Created', 'Accepted', 'Accepted',
        'Job ' || v_job.job_number || ' created.',
        coalesce((select profile.display_name from public.user_profiles profile where profile.id = auth.uid()), v_role)
      );
      perform private.ensure_job_scope_v1(v_job.id, v_proposal.id);
      return v_job;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name is distinct from 'jobs_job_number_key' then
        raise;
      end if;
    end;
  end loop;
  raise exception 'A unique Job number could not be generated.';
end;
$$;

revoke all on function public.create_job_from_accepted_proposal(uuid) from public, anon, authenticated;
grant execute on function public.create_job_from_accepted_proposal(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
