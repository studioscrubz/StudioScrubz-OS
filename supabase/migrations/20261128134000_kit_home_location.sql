alter table public.technician_kit_assignments add column home_location_id uuid references public.technician_inventory_locations(id);
update public.technician_kit_assignments a set home_location_id=a.location_id from public.technician_inventory_locations l where l.id=a.location_id and l.location_type='central';
-- Backfill only where a single central location makes the home unambiguous.
update public.technician_kit_assignments set home_location_id=(select id from public.technician_inventory_locations where location_type='central' limit 1) where home_location_id is null and (select count(*) from public.technician_inventory_locations where location_type='central')=1;
create or replace function private.inventory_kit_home() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.technician_inventory_locations where id=new.location_id and location_type='central') then new.home_location_id:=new.location_id;
 elsif tg_op='UPDATE' then new.home_location_id:=old.home_location_id;
 elsif (select count(*) from public.technician_inventory_locations where location_type='central')=1 then select id into new.home_location_id from public.technician_inventory_locations where location_type='central';
 end if;
 return new;
end $$;
revoke all on function private.inventory_kit_home() from public,anon,authenticated;
create trigger inventory_kit_home before insert or update of location_id on public.technician_kit_assignments for each row execute function private.inventory_kit_home();
notify pgrst,'reload schema';
