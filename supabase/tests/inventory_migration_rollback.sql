\set ON_ERROR_STOP on
begin;
\ir ../migrations/20261127122018_inventory_equipment_management.sql
\ir ../migrations/20261127124030_inventory_readiness_integration.sql
\ir ../migrations/20261127124955_inventory_training_and_kit_assignments.sql
rollback;
do $$ begin
 if to_regclass('public.technician_inventory_stock') is not null or to_regclass('public.technician_kit_assignments') is not null then raise exception 'Inventory migration rollback retained new tables'; end if;
 if to_regprocedure('public.start_operational_job(uuid)') is null or to_regprocedure('public.confirm_job_equipment_responsibility(uuid)') is null then raise exception 'Rollback did not restore original lifecycle functions'; end if;
 if to_regprocedure('public.start_operational_job_before_inventory(uuid)') is not null then raise exception 'Function rename escaped transaction rollback'; end if;
end $$;
\echo 'Externally managed rollback of all inventory migrations passed'
