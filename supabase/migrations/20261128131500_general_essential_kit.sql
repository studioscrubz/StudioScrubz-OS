-- Physical custody uses one general essential kit; legacy definitions remain job inspection profiles.
update public.technician_kit_definitions set name='General Essential Kit' where id='standard';
update public.technician_kit_assignments set kit_id='standard' where kit_id<>'standard';
create or replace function public.inventory_assign_kit(p_number text,p_kit text,p_location uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; existing public.technician_kit_assignments; destination_type text; source_type text;
begin
 if not private.inventory_manager() then raise exception 'Inventory manager required' using errcode='42501'; end if;
 p_number := nullif(btrim(p_number),'');
 if p_number is null then raise exception 'Kit identification required'; end if;
 p_kit := 'standard';
 select location_type into destination_type from public.technician_inventory_locations where id=p_location;
 if not found then raise exception 'Valid inventory location required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('kit:'||p_number,0));
 select * into existing from public.technician_kit_assignments where kit_number=p_number for update;
 if found then
   if existing.returned_at is null and existing.location_id=p_location then return existing.id; end if;
   select location_type into source_type from public.technician_inventory_locations where id=existing.location_id;
   if existing.returned_at is null and source_type<>'central' then raise exception 'Record physical return before reassigning an issued kit'; end if;
   update public.technician_kit_assignments set kit_id=p_kit,location_id=p_location,issued_by=auth.uid(),assigned_at=now(),acknowledged_by=null,acknowledged_at=null,return_required=false,returned_at=null,returned_by=null,return_notes=null where id=existing.id returning id into result;
 else
   insert into public.technician_kit_assignments(kit_number,kit_id,location_id,issued_by) values(p_number,p_kit,p_location,auth.uid()) returning id into result;
 end if;
 return result;
end $$;
alter table public.technician_kit_assignments add constraint inventory_general_kit_only check(kit_id='standard');
