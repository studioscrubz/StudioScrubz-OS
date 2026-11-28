-- Kit identification remains globally unique; locations may store multiple physical kits of the same standard.
create index if not exists technician_active_kits_location_standard on public.technician_kit_assignments(location_id,kit_id) where returned_at is null;
drop index if exists public.technician_one_active_kit;
