-- Permanent deletion removes unused planning records, never executed work evidence.
create function private.can_purge_job_planning(p_job_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.is_master_admin() and exists(
  select 1 from public.jobs j where j.id=p_job_id
   and (j.status='Cancelled' or j.archived_at is not null)
   and j.operational_started_at is null and j.equipment_responsibility_confirmed_at is null
   and cardinality(private.job_retained_history_reasons(j.id))=0
   and not exists(select 1 from public.job_equipment_clearances c where c.job_id=j.id)
   and not exists(select 1 from public.job_equipment_handoffs h where h.job_id=j.id)
   and not exists(select 1 from public.jobsite_arrival_checks c where c.job_id=j.id)
   and not exists(select 1 from public.jobsite_arrival_exceptions e where e.job_id=j.id)
   and not exists(select 1 from public.job_equipment_responsibility_tasks t where t.job_id=j.id
    and t.status not in ('Pending Assignment','Assigned'))
 );
$$;
revoke all on function private.can_purge_job_planning(uuid) from public,anon,authenticated;

-- Keep append-only evidence protection except during authorized unused-job cleanup.
create or replace function private.protect_job_equipment_responsibility_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' and private.can_purge_job_planning(old.job_id) then return old; end if;
 raise exception 'Equipment responsibility history is append-only.';
end $$;
create or replace function private.prevent_job_lifecycle_event_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' and private.can_purge_job_planning(old.job_id) then return old; end if;
 raise exception 'Job lifecycle audit records are immutable.';
end $$;

-- Preserve the current roster guard, adding only the scoped cleanup exception.
do $$ declare definition text; replacement text; begin
 definition:=pg_get_functiondef('private.guard_job_roster()'::regprocedure);
 replacement:=replace(definition,
  'if j.status not in (''Ready to Schedule'',''Scheduled'',''Crew Assigned'')',
  'if tg_op=''DELETE'' and private.can_purge_job_planning(old.job_id) then return old; end if;
 if j.status not in (''Ready to Schedule'',''Scheduled'',''Crew Assigned'')');
 if replacement=definition then raise exception 'Job roster guard changed; review before migrating.'; end if;
 execute replacement;
end $$;

create function private.cleanup_deleted_job_planning()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Both Jobs and Archives permanent-delete RPCs run this same atomic cleanup.
 if not private.can_purge_job_planning(old.id) then
  raise exception 'This Job has recorded work, equipment confirmation, or other business evidence and cannot be permanently deleted.';
 end if;
 delete from public.job_crew_technicians where job_id=old.id;
 delete from public.job_assignment_events where job_id=old.id;
 delete from public.job_equipment_notifications where job_id=old.id;
 delete from public.job_equipment_assignment_audit where assignment_id in
  (select id from public.job_equipment_assignments where job_id=old.id);
 delete from public.job_equipment_assignments where job_id=old.id;
 delete from public.job_equipment_responsibility_events where job_id=old.id;
 delete from public.job_equipment_responsibility_tasks where job_id=old.id;
 delete from public.job_lifecycle_events where job_id=old.id;
 -- A cancelled operational job must not remain an accepted scheduled opportunity.
 update public.contractor_opportunities set linked_job_id=null,status='Cancelled',updated_at=now()
 where linked_job_id=old.id;
 return old;
end $$;
revoke all on function private.cleanup_deleted_job_planning() from public,anon,authenticated;
create trigger jobs_cleanup_unused_planning before delete on public.jobs
for each row execute function private.cleanup_deleted_job_planning();
