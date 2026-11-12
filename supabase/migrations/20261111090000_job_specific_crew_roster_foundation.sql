-- Job-specific crew rosters. No changes to existing payroll until the
-- legacy clock-in RPCs are replaced and regression-tested.
alter table public.crews
  add column if not exists technician_capacity integer not null default 4
  constraint crews_technician_capacity_valid check (technician_capacity between 0 and 50);

create table if not exists public.job_crew_technicians (
  job_id uuid not null references public.jobs(id) on delete restrict,
  crew_id uuid not null references public.crews(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  assigned_by_employee_id uuid not null references public.employees(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (job_id, employee_id)
);
create index if not exists job_crew_technicians_employee_idx
  on public.job_crew_technicians(employee_id, job_id);
alter table public.job_crew_technicians enable row level security;
revoke all on public.job_crew_technicians from public, anon, authenticated;

create or replace function public.set_job_crew_technicians(
  p_job_id uuid, p_employee_ids uuid[]
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  j public.jobs;
  c public.crews;
  v_lead uuid := public.current_employee_id();
  v_ids uuid[];
begin
  if auth.uid() is null or v_lead is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into j from public.jobs where id = p_job_id for update;
  if not found or j.assigned_crew_id is null or j.archived_at is not null
     or j.status not in ('Scheduled','Crew Assigned') then
    raise exception 'An assigned, not-yet-started crew job is required.';
  end if;
  select * into c from public.crews where id = j.assigned_crew_id
    and status = 'Active' and archived_at is null;
  if not found or c.crew_lead_id is distinct from v_lead
     or not public.has_role('Crew Lead') then
    raise exception 'Only this job''s assigned Crew Lead may select technicians.'
      using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids
  from unnest(coalesce(p_employee_ids, '{}'::uuid[])) x;
  if array_position(v_ids, null) is not null
     or cardinality(v_ids) <> cardinality(coalesce(p_employee_ids, '{}'::uuid[]))
     or cardinality(v_ids) > c.technician_capacity
     or c.crew_lead_id = any(v_ids) then
    raise exception 'Invalid crew technician selection or capacity exceeded.';
  end if;
  if exists (
    select 1 from unnest(v_ids) x
    where not public.is_eligible_job_tech(x)
      or not exists(select 1 from public.employees e
        where e.id=x and e.department='Scrub Technicians')
  ) then
    raise exception 'Only active eligible technicians can be assigned.';
  end if;
  delete from public.job_crew_technicians where job_id = p_job_id;
  insert into public.job_crew_technicians(job_id, crew_id, employee_id, assigned_by_employee_id)
  select p_job_id, c.id, x, v_lead from unnest(v_ids) x;
  return cardinality(v_ids);
end $$;
revoke all on function public.set_job_crew_technicians(uuid,uuid[])
  from public,anon,authenticated;
grant execute on function public.set_job_crew_technicians(uuid,uuid[])
  to authenticated;
notify pgrst, 'reload schema';
