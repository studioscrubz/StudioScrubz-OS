begin;

-- ============================================================
-- StudioScrubz OS
-- Phase 1 — Immutable Job Labor Budget Snapshot
--
-- Existing planning sources remain authoritative before start:
--   jobs.labor_hours
--   jobs.recommended_crew_size
--   jobs.estimated_duration
--
-- When a job first enters In Progress, those values are frozen.
-- The original snapshot is immutable. Future approved budget
-- changes must be represented by append-only adjustments.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Immutable original labor-budget snapshot
-- ------------------------------------------------------------

create table if not exists public.job_labor_budget_snapshots (
  id uuid primary key default gen_random_uuid(),

  job_id uuid not null
    references public.jobs(id)
    on delete restrict,

  budgeted_labor_hours numeric not null default 0
    check (budgeted_labor_hours >= 0),

  recommended_crew_size integer not null default 0
    check (recommended_crew_size >= 0),

  estimated_duration numeric null
    check (estimated_duration is null or estimated_duration >= 0),

  frozen_at timestamptz not null default transaction_timestamp(),

  created_at timestamptz not null default transaction_timestamp(),

  constraint job_labor_budget_snapshots_one_original_per_job
    unique (job_id)
);


-- ------------------------------------------------------------
-- 2. Append-only post-start budget adjustments
-- ------------------------------------------------------------

create table if not exists public.job_labor_budget_adjustments (
  id uuid primary key default gen_random_uuid(),

  job_id uuid not null
    references public.jobs(id)
    on delete restrict,

  labor_hours_delta numeric not null default 0,

  crew_size_delta integer not null default 0,

  duration_delta numeric not null default 0,

  reason text not null
    check (btrim(reason) <> ''),

  created_by uuid null
    references auth.users(id)
    on delete set null,

  created_at timestamptz not null default transaction_timestamp(),

  constraint job_labor_budget_adjustments_nonzero_change
    check (
      labor_hours_delta <> 0
      or crew_size_delta <> 0
      or duration_delta <> 0
    )
);


create index if not exists
  job_labor_budget_adjustments_job_created_idx
on public.job_labor_budget_adjustments(job_id, created_at);


-- ------------------------------------------------------------
-- 3. Freeze the original planning budget
-- ------------------------------------------------------------

create or replace function public.freeze_job_labor_budget_snapshot(
  p_job_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
begin
  select *
  into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Job not found.';
  end if;

  insert into public.job_labor_budget_snapshots (
    job_id,
    budgeted_labor_hours,
    recommended_crew_size,
    estimated_duration,
    frozen_at
  )
  values (
    v_job.id,
    greatest(coalesce(v_job.labor_hours, 0), 0),
    greatest(coalesce(v_job.recommended_crew_size, 0), 0),
    case
      when v_job.estimated_duration is null then null
      else greatest(v_job.estimated_duration, 0)
    end,
    transaction_timestamp()
  )
  on conflict (job_id) do nothing;
end;
$$;

revoke all
on function public.freeze_job_labor_budget_snapshot(uuid)
from public, anon, authenticated;


-- ------------------------------------------------------------
-- 4. Automatically freeze when Job first enters In Progress
--
-- BEFORE trigger is used so every start path is covered,
-- including the Phase 0B crew-presence start workflow.
-- ------------------------------------------------------------

create or replace function public.capture_job_labor_budget_on_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'In Progress'
     and old.status is distinct from 'In Progress' then

    insert into public.job_labor_budget_snapshots (
      job_id,
      budgeted_labor_hours,
      recommended_crew_size,
      estimated_duration,
      frozen_at
    )
    values (
      new.id,
      greatest(coalesce(new.labor_hours, 0), 0),
      greatest(coalesce(new.recommended_crew_size, 0), 0),
      case
        when new.estimated_duration is null then null
        else greatest(new.estimated_duration, 0)
      end,
      transaction_timestamp()
    )
    on conflict (job_id) do nothing;

  end if;

  return new;
end;
$$;

drop trigger if exists
  trg_capture_job_labor_budget_on_start
on public.jobs;

create trigger trg_capture_job_labor_budget_on_start
before update of status
on public.jobs
for each row
execute function public.capture_job_labor_budget_on_start();


-- ------------------------------------------------------------
-- 5. Prevent mutation/deletion of original snapshots
-- ------------------------------------------------------------

create or replace function public.prevent_job_labor_budget_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'Original job labor budget snapshots are immutable.';
end;
$$;

drop trigger if exists
  trg_job_labor_budget_snapshot_immutable
on public.job_labor_budget_snapshots;

create trigger trg_job_labor_budget_snapshot_immutable
before update or delete
on public.job_labor_budget_snapshots
for each row
execute function public.prevent_job_labor_budget_snapshot_mutation();


-- ------------------------------------------------------------
-- 6. Prevent adjustment mutation/deletion
-- ------------------------------------------------------------

create or replace function public.prevent_job_labor_budget_adjustment_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'Job labor budget adjustments are append-only.';
end;
$$;

drop trigger if exists
  trg_job_labor_budget_adjustments_append_only
on public.job_labor_budget_adjustments;

create trigger trg_job_labor_budget_adjustments_append_only
before update or delete
on public.job_labor_budget_adjustments
for each row
execute function public.prevent_job_labor_budget_adjustment_mutation();


-- ------------------------------------------------------------
-- 7. Controlled adjustment RPC
--
-- Master Admin / Administrator / Manager may record an
-- operational budget adjustment after the original snapshot
-- exists. Historical snapshot values are never rewritten.
-- ------------------------------------------------------------

create or replace function public.add_job_labor_budget_adjustment(
  p_job_id uuid,
  p_labor_hours_delta numeric default 0,
  p_crew_size_delta integer default 0,
  p_duration_delta numeric default 0,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adjustment_id uuid;
begin
  if auth.uid() is null
     or not public.has_any_role(
       array['Master Admin', 'Administrator', 'Manager']
     ) then
    raise exception 'Labor budget adjustment permission denied.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.job_labor_budget_snapshots
    where job_id = p_job_id
  ) then
    raise exception
      'The job labor budget has not been frozen yet.';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required for a labor budget adjustment.';
  end if;

  if coalesce(p_labor_hours_delta, 0) = 0
     and coalesce(p_crew_size_delta, 0) = 0
     and coalesce(p_duration_delta, 0) = 0 then
    raise exception 'At least one labor budget value must change.';
  end if;

  insert into public.job_labor_budget_adjustments (
    job_id,
    labor_hours_delta,
    crew_size_delta,
    duration_delta,
    reason,
    created_by
  )
  values (
    p_job_id,
    coalesce(p_labor_hours_delta, 0),
    coalesce(p_crew_size_delta, 0),
    coalesce(p_duration_delta, 0),
    btrim(p_reason),
    auth.uid()
  )
  returning id into v_adjustment_id;

  return v_adjustment_id;
end;
$$;

revoke all
on function public.add_job_labor_budget_adjustment(
  uuid,
  numeric,
  integer,
  numeric,
  text
)
from public, anon;

grant execute
on function public.add_job_labor_budget_adjustment(
  uuid,
  numeric,
  integer,
  numeric,
  text
)
to authenticated;


-- ------------------------------------------------------------
-- 8. Effective budget projection
--
-- Original frozen budget + all append-only adjustments.
-- ------------------------------------------------------------

create or replace function public.get_job_labor_budget(
  p_job_id uuid
)
returns table (
  job_id uuid,
  original_labor_hours numeric,
  original_crew_size integer,
  original_estimated_duration numeric,
  adjusted_labor_hours numeric,
  adjusted_crew_size integer,
  adjusted_estimated_duration numeric,
  frozen_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.job_id,

    s.budgeted_labor_hours,
    s.recommended_crew_size,
    s.estimated_duration,

    greatest(
      s.budgeted_labor_hours
      + coalesce(sum(a.labor_hours_delta), 0),
      0
    ),

    greatest(
      s.recommended_crew_size
      + coalesce(sum(a.crew_size_delta), 0),
      0
    )::integer,

    case
      when s.estimated_duration is null
           and coalesce(sum(a.duration_delta), 0) = 0
        then null
      else greatest(
        coalesce(s.estimated_duration, 0)
        + coalesce(sum(a.duration_delta), 0),
        0
      )
    end,

    s.frozen_at

  from public.job_labor_budget_snapshots s

  left join public.job_labor_budget_adjustments a
    on a.job_id = s.job_id

  where s.job_id = p_job_id

  group by
    s.job_id,
    s.budgeted_labor_hours,
    s.recommended_crew_size,
    s.estimated_duration,
    s.frozen_at;
$$;

revoke all
on function public.get_job_labor_budget(uuid)
from public, anon;

grant execute
on function public.get_job_labor_budget(uuid)
to authenticated;


-- ------------------------------------------------------------
-- 9. Lock down tables
-- ------------------------------------------------------------

alter table public.job_labor_budget_snapshots
enable row level security;

alter table public.job_labor_budget_adjustments
enable row level security;

revoke all
on public.job_labor_budget_snapshots
from public, anon, authenticated;

revoke all
on public.job_labor_budget_adjustments
from public, anon, authenticated;


notify pgrst, 'reload schema';

commit;