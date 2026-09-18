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
    or to_regprocedure('public.can_control_job_timer(uuid,uuid)') is null
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
  if position('can_control_job_timer' in pg_get_functiondef('public.start_operational_job(uuid)'::regprocedure))=0
    or position('Scrub Technician' in pg_get_functiondef('public.start_operational_job(uuid)'::regprocedure))=0
    or position('can_control_job_timer' in pg_get_functiondef('public.complete_in_progress_job(uuid)'::regprocedure))=0
    or position('Scrub Technician' in pg_get_functiondef('public.complete_in_progress_job(uuid)'::regprocedure))=0 then
    raise exception 'individual Scrub Technician timer authority is not wired through the timer helper';
  end if;
  definition:=pg_get_functiondef('public.can_control_job_timer(uuid,uuid)'::regprocedure);
  if position('Crew Lead' in definition)=0 or position('crew_lead_id' in definition)=0
    or position('crew_members' in definition)>0 then
    raise exception 'crew timer authority must be limited to the assigned Crew Lead';
  end if;
  definition:=pg_get_functiondef('public.can_access_job_assignment(uuid,uuid)'::regprocedure);
  if position('is_eligible_job_tech' in definition)=0 or position('crew_members' in definition)=0 then
    raise exception 'assignment access must require an eligible field employee and exact individual or crew membership';
  end if;
  definition:=pg_get_functiondef('public.is_eligible_job_tech(uuid)'::regprocedure);
  if position('employment_status' in definition)=0 or position('archived_at' in definition)=0
    or position('is_active' in definition)=0 or position('Scrub Technician' in definition)=0
    or position('Crew Lead' in definition)=0 then
    raise exception 'inactive, archived, inactive-profile, and non-field users must be denied';
  end if;
  if position('can_access_job_assignment' in pg_get_functiondef('public.can_read_job_gps(uuid,uuid)'::regprocedure))=0
    or position('can_read_job_gps' in pg_get_functiondef('public.finish_job_gps_trip(uuid,jsonb)'::regprocedure))=0
    or position('can_read_job_gps' in pg_get_functiondef('public.cancel_job_gps_trip(uuid)'::regprocedure))=0 then
    raise exception 'GPS finish/cancel authorization is not assignment-aware';
  end if;
  if position('Use Join Job' in pg_get_functiondef('public.clock_in_operational(uuid,uuid,uuid,text,timestamp with time zone,text)'::regprocedure))=0 then
    raise exception 'Job payroll creation must remain exclusive to Join Job';
  end if;
  if has_function_privilege('authenticated','public.open_job_payroll_entry(uuid,uuid,uuid,timestamp with time zone)','EXECUTE')
    or has_function_privilege('authenticated','public.close_job_payroll_entries(uuid,timestamp with time zone)','EXECUTE') then
    raise exception 'internal Job payroll open/close helpers must not be directly callable';
  end if;
  if position('start_operational_job' in pg_get_functiondef('public.update_operational_job(uuid,date,time without time zone,numeric,uuid,text,text)'::regprocedure))=0
    or position('complete_in_progress_job' in pg_get_functiondef('public.update_operational_job(uuid,date,time without time zone,numeric,uuid,text,text)'::regprocedure))=0 then
    raise exception 'legacy operational Job updates must delegate global timer changes';
  end if;
  if position('In Progress' in pg_get_functiondef('public.set_job_worker_assignment(uuid,text,uuid,uuid)'::regprocedure))=0
    or position('Completed' in pg_get_functiondef('public.set_job_worker_assignment(uuid,text,uuid,uuid)'::regprocedure))=0
    or position('Cancelled' in pg_get_functiondef('public.set_job_worker_assignment(uuid,text,uuid,uuid)'::regprocedure))=0
    or position('Archived' in pg_get_functiondef('public.set_job_worker_assignment(uuid,text,uuid,uuid)'::regprocedure))=0 then
    raise exception 'reassignment lifecycle guards are incomplete';
  end if;
end $$;

rollback;
