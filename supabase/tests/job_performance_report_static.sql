-- Static regression guards; this file is intentionally safe to inspect without
-- connecting to hosted Supabase.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.get_job_performance_rows(date,date)'::regprocedure) into v_definition;
  if v_definition not like '%job.operational_ended_at - job.operational_started_at%' then raise exception 'Master timestamps are not the duration source.'; end if;
  if v_definition like '%time_entries%' or v_definition like '%invoices%' or v_definition like '%payments%' then raise exception 'Report must not depend on labor or financial data.'; end if;
  if v_definition not like '%job.status = ''Completed''%' or v_definition not like '%job.archived_at is null%' then raise exception 'Measured population guards are missing.'; end if;
  if v_definition not like '%Master Admin%Administrator%Manager%' then raise exception 'Management authorization guard is missing.'; end if;
end;
$$;
