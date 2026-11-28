create or replace function public.inventory_kit_assignees() returns table(id uuid,name text) language sql stable security definer set search_path='' as $$
 select e.id,concat_ws(' ',e.first_name,e.last_name) from public.employees e
 where exists(select 1 from public.user_profiles p where p.id=auth.uid() and p.is_active and p.role='Master Admin')
 and e.employment_status='Active' and e.archived_at is null and e.employment_type is distinct from '1099'
 and exists(select 1 from public.user_profiles p where p.employee_id=e.id and p.is_active and p.role in ('Scrub Technician','Crew Lead','Manager'))
 order by e.first_name,e.last_name
$$;
create or replace function public.inventory_issue_kit(p_id uuid,p_employee uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare k public.technician_kit_assignments; loc uuid; worker_name text;
begin
 if not exists(select 1 from public.user_profiles p where p.id=auth.uid() and p.is_active and p.role='Master Admin') then raise exception 'Master Admin required' using errcode='42501'; end if;
 select name into worker_name from public.inventory_kit_assignees() where id=p_employee;
 if not found then raise exception 'Select an active internal technician with system access'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_employee::text,12));
 select * into k from public.technician_kit_assignments where id=p_id;
 if not found then raise exception 'Kit not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended('kit:'||k.kit_number,0));
 select * into k from public.technician_kit_assignments where id=p_id for update;
 if k.returned_at is null and not exists(select 1 from public.technician_inventory_locations where id=k.location_id and location_type='central') then raise exception 'Kit is already assigned'; end if;
 if exists(select 1 from public.technician_kit_assignments a join public.technician_inventory_locations l on l.id=a.location_id where l.employee_id=p_employee and a.returned_at is null) then raise exception 'Technician already has an active kit'; end if;
 select id into loc from public.technician_inventory_locations where employee_id=p_employee and location_type='individual' order by id limit 1;
 if loc is null then insert into public.technician_inventory_locations(name,location_type,employee_id) values(worker_name,'individual',p_employee) returning id into loc; end if;
 return public.inventory_assign_kit(k.kit_number,'standard',loc);
end $$;
revoke all on function public.inventory_kit_assignees(),public.inventory_issue_kit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.inventory_kit_assignees(),public.inventory_issue_kit(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
