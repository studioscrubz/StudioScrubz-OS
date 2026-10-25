\set ON_ERROR_STOP on

begin;
\ir ../migrations/20261025145923_workforce_time_off_phase_1.sql
do $$ begin
  if to_regclass('public.employee_time_off_requests') is null then
    raise exception 'Migration objects were not created inside the external transaction.';
  end if;
end $$;
rollback;

do $$ begin
  if to_regclass('public.employee_time_off_requests') is not null
    or to_regprocedure('public.submit_employee_time_off_request(date,date,boolean,time without time zone,time without time zone,text,text)') is not null then
    raise exception 'External rollback did not remove all migration objects.';
  end if;
end $$;
