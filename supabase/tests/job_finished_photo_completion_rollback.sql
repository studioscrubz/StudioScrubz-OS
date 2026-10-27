\set ON_ERROR_STOP on

begin;
\ir ../migrations/20261027003242_require_finished_job_photo_before_completion.sql
select 1 / case when to_regprocedure('private.require_finished_job_photo(uuid)') is not null then 1 else 0 end;
rollback;

select 1 / case when to_regprocedure('private.require_finished_job_photo(uuid)') is null then 1 else 0 end;
