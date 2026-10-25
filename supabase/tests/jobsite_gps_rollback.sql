\set ON_ERROR_STOP on
begin;
\ir ../migrations/20261025164300_jobsite_gps_arrival_v1.sql
\ir ../migrations/20261025194500_walkthrough_jobsite_gps.sql
do $$ begin
 if to_regclass('public.jobsite_geofence_settings') is null then raise exception 'Jobsite migration not visible before rollback'; end if;
 if to_regprocedure('public.capture_walkthrough_jobsite_gps(uuid,jsonb,integer)') is null then raise exception 'Walkthrough GPS migration not visible before rollback'; end if;
end $$;
rollback;
do $$ begin
 if to_regclass('public.jobsite_geofence_settings') is not null
 or to_regprocedure('public.verify_jobsite_arrival(uuid,jsonb)') is not null
 or to_regprocedure('public.capture_walkthrough_jobsite_gps(uuid,jsonb,integer)') is not null
 then raise exception 'Jobsite migration escaped external rollback'; end if;
end $$;
