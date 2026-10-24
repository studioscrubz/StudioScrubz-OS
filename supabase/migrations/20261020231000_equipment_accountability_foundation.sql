-- Equipment accountability foundation. Feature branch only until RPC gates and UI are tested.
begin;

create table public.equipment_checklist_catalog (
  id uuid primary key default gen_random_uuid(),
  service_type text not null,
  item_name text not null,
  item_kind text not null check (item_kind in ('Equipment','Supply')),
  display_order integer not null default 0,
  active boolean not null default true,
  unique(service_type,item_name)
);

create table public.job_equipment_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  employee_id uuid not null references public.employees(id),
  assigned_by_user_id uuid not null,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  released_by_user_id uuid,
  release_reason text,
  unique(job_id,employee_id,assigned_at),
  check (released_at is null or released_at >= assigned_at)
);
create unique index job_equipment_one_active_assignment
  on public.job_equipment_assignments(job_id,employee_id) where released_at is null;
create index job_equipment_assignments_employee_idx
  on public.job_equipment_assignments(employee_id,job_id);

create table public.job_equipment_clearances (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.job_equipment_assignments(id),
  job_id uuid not null references public.jobs(id),
  employee_id uuid not null references public.employees(id),
  work_session_id uuid references public.employee_work_sessions(id),
  checkpoint text not null check (checkpoint in ('End Job','Final Sign Out')),
  status text not null default 'Pending' check (status in ('Pending','Exception Open','Cleared')),
  submitted_at timestamptz,
  cleared_at timestamptz,
  created_at timestamptz not null default now(),
  unique(assignment_id,checkpoint,work_session_id)
);
create index job_equipment_clearances_employee_idx
  on public.job_equipment_clearances(employee_id,checkpoint,status);

create table public.job_equipment_clearance_items (
  id uuid primary key default gen_random_uuid(),
  clearance_id uuid not null references public.job_equipment_clearances(id),
  catalog_item_id uuid references public.equipment_checklist_catalog(id),
  item_name text not null,
  item_kind text not null check (item_kind in ('Equipment','Supply')),
  clearance_status text not null default 'Pending'
    check (clearance_status in ('Pending','Checked','Not Needed','Missing')),
  checked_at timestamptz,
  unique(clearance_id,item_name)
);

create table public.job_equipment_exceptions (
  id uuid primary key default gen_random_uuid(),
  clearance_item_id uuid not null references public.job_equipment_clearance_items(id),
  reported_by_user_id uuid not null,
  reported_at timestamptz not null default now(),
  description text not null check (length(btrim(description)) > 0),
  resolution text,
  resolved_by_user_id uuid,
  resolved_at timestamptz,
  check ((resolved_at is null and resolved_by_user_id is null) or
         (resolved_at is not null and resolved_by_user_id is not null and length(btrim(coalesce(resolution,''))) > 0))
);
create index job_equipment_open_exceptions_idx
  on public.job_equipment_exceptions(clearance_item_id) where resolved_at is null;

create table public.job_equipment_assignment_audit (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.job_equipment_assignments(id),
  action text not null check (action in ('Assigned','Released','Reassigned','Master Admin Override')),
  actor_user_id uuid not null,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

alter table public.equipment_checklist_catalog enable row level security;
alter table public.job_equipment_assignments enable row level security;
alter table public.job_equipment_clearances enable row level security;
alter table public.job_equipment_clearance_items enable row level security;
alter table public.job_equipment_exceptions enable row level security;
alter table public.job_equipment_assignment_audit enable row level security;

-- Fail closed until dedicated authorization RPCs are implemented.
revoke all on public.equipment_checklist_catalog from public,anon,authenticated;
revoke all on public.job_equipment_assignments from public,anon,authenticated;
revoke all on public.job_equipment_clearances from public,anon,authenticated;
revoke all on public.job_equipment_clearance_items from public,anon,authenticated;
revoke all on public.job_equipment_exceptions from public,anon,authenticated;
revoke all on public.job_equipment_assignment_audit from public,anon,authenticated;

commit;
