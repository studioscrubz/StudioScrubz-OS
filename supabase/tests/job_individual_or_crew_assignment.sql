-- Static/transaction-safe regression contract for regular Job worker assignment.
begin;

do $$
declare definition text;
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='assigned_employee_id') then
    raise exception 'jobs.assigned_employee_id is missing';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='assigned_employee_name') then
    raise exception 'jobs.assigned_employee_name is missing';
  end if;
  select pg_get_constraintdef(oid) into definition from pg_constraint
   where conrelid='public.jobs'::regclass and conname='jobs_one_worker_assignment' and convalidated;
  if definition is null or definition not like '%num_nonnulls(assigned_employee_id, assigned_crew_id) <= 1%' then
    raise exception 'validated mutually-exclusive Job assignment constraint is missing';
  end if;
  if to_regprocedure('public.get_eligible_job_tech_options()') is null
    or to_regprocedure('public.can_access_job_assignment(uuid,uuid)') is null
    or to_regprocedure('public.set_job_worker_assignment(uuid,text,uuid,uuid)') is null
    or to_regprocedure('public.create_direct_operational_job_v2(uuid,uuid,uuid,uuid[],date,time,numeric,text,uuid,uuid,numeric,text,text,numeric,jsonb)') is null then
    raise exception 'Phase 1 Job assignment RPC contract is incomplete';
  end if;
  if has_table_privilege('authenticated','public.jobs','INSERT') or has_table_privilege('authenticated','public.jobs','UPDATE') then
    raise exception 'authenticated retains a direct Job assignment write path';
  end if;
  if position('assigned_employee_id' in pg_get_viewdef('public.jobs_operational_safe'::regclass,true))=0
    or position('can_access_job_assignment' in pg_get_viewdef('public.jobs_operational_safe'::regclass,true))=0 then
    raise exception 'operational Job view is not assignment-aware';
  end if;
  if position('open_job_payroll_entry' in pg_get_functiondef('public.set_job_worker_assignment(uuid,text,uuid,uuid)'::regprocedure))>0 then
    raise exception 'assignment must not create payroll time';
  end if;
  if position('open_job_payroll_entry' in pg_get_functiondef('public.start_operational_job(uuid)'::regprocedure))>0 then
    raise exception 'global Job start must remain separate from payroll';
  end if;
  if position('open_job_payroll_entry' in pg_get_functiondef('public.start_or_clock_in_to_job(uuid)'::regprocedure))=0 then
    raise exception 'Join Job must continue creating individual payroll time';
  end if;
  if position('In Progress' in pg_get_functiondef('public.set_job_worker_assignment(uuid,text,uuid,uuid)'::regprocedure))=0
    or position('Completed' in pg_get_functiondef('public.set_job_worker_assignment(uuid,text,uuid,uuid)'::regprocedure))=0
    or position('Cancelled' in pg_get_functiondef('public.set_job_worker_assignment(uuid,text,uuid,uuid)'::regprocedure))=0
    or position('Archived' in pg_get_functiondef('public.set_job_worker_assignment(uuid,text,uuid,uuid)'::regprocedure))=0 then
    raise exception 'reassignment lifecycle guards are incomplete';
  end if;
end $$;

rollback;
