-- Permit kit custody for active authorized field staff independently of employment type.
-- Keep employee-only payroll/job inspection eligibility and manager permissions unchanged.
create or replace function private.inventory_kit_custodian() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p join public.employees e on e.id=p.employee_id
 where p.id=auth.uid() and p.is_active and p.role in ('Crew Lead','Scrub Technician','Manager','Master Admin')
 and e.employment_status='Active' and e.archived_at is null)
$$;
revoke all on function private.inventory_kit_custodian() from public,anon,authenticated;
grant execute on function private.inventory_kit_custodian() to authenticated;
create or replace function public.inventory_kit_assignees() returns table(id uuid,name text) language sql stable security definer set search_path='' as $$
 select e.id,concat_ws(' ',e.first_name,e.last_name) from public.employees e
 where exists(select 1 from public.user_profiles p where p.id=auth.uid() and p.is_active and p.role='Master Admin')
 and e.employment_status='Active' and e.archived_at is null
 and exists(select 1 from public.user_profiles p where p.employee_id=e.id and p.is_active and p.role in ('Scrub Technician','Crew Lead','Manager','Master Admin'))
 order by e.first_name,e.last_name
$$;
create or replace function public.inventory_acknowledge_kit(p_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 update public.technician_kit_assignments k set acknowledged_by=auth.uid(),acknowledged_at=now()
 where k.id=p_id and k.returned_at is null and k.acknowledged_at is null and not k.return_required
 and private.inventory_kit_custodian() and exists(select 1 from public.technician_inventory_locations l where l.id=k.location_id and
 (l.employee_id=public.current_employee_id() or exists(select 1 from public.crews c where c.id=l.crew_id and c.crew_lead_id=public.current_employee_id())));
 if not found then raise exception 'Assigned kit acknowledgment denied' using errcode='42501'; end if;
end $$;
create or replace function private.inventory_location_access(p_location uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.inventory_manager() or (private.inventory_kit_custodian() and exists(
 select 1 from public.technician_inventory_locations l where l.id=p_location and
 (l.employee_id=public.current_employee_id() or exists(select 1 from public.crews c where c.id=l.crew_id and c.crew_lead_id=public.current_employee_id()))))
$$;
-- Read-only access to catalog and kit contents for eligible custodians, including 1099 personnel.
create policy inventory_custodian_catalog_read on public.technician_kit_standard_items for select to authenticated using(private.inventory_kit_custodian());
create policy inventory_custodian_kits_read on public.technician_kit_definitions for select to authenticated using(private.inventory_kit_custodian());
create policy inventory_custodian_members_read on public.technician_kit_members for select to authenticated using(private.inventory_kit_custodian());
notify pgrst,'reload schema';
