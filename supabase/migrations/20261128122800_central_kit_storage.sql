-- Central storage is not employee custody. Only managers can place or transfer kits.
create or replace function public.inventory_assign_kit(p_number text,p_kit text,p_location uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; existing public.technician_kit_assignments; destination_type text; source_type text;
begin
 if not private.inventory_manager() then raise exception 'Inventory manager required' using errcode='42501'; end if;
 p_number := nullif(btrim(p_number),'');
 if p_number is null then raise exception 'Kit identification required'; end if;
 select location_type into destination_type from public.technician_inventory_locations where id=p_location;
 if not found then raise exception 'Valid inventory location required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('kit:'||p_number,0));
 select * into existing from public.technician_kit_assignments where kit_number=p_number for update;
 if found then
   if existing.kit_id<>p_kit then raise exception 'Existing kit standard does not match'; end if;
   select location_type into source_type from public.technician_inventory_locations where id=existing.location_id;
   if existing.returned_at is null and existing.location_id=p_location then return existing.id; end if;
   if existing.returned_at is null and source_type<>'central' then raise exception 'Record physical return before reassigning an issued kit'; end if;
   update public.technician_kit_assignments set location_id=p_location,issued_by=auth.uid(),assigned_at=now(),acknowledged_by=null,acknowledged_at=null,return_required=false,returned_at=null,returned_by=null,return_notes=null where id=existing.id returning id into result;
 else
   insert into public.technician_kit_assignments(kit_number,kit_id,location_id,issued_by) values(p_number,p_kit,p_location,auth.uid()) returning id into result;
 end if;
 return result;
end $$;
-- The existing unique index remains unchanged, including its central location limit.
