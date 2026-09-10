-- Management permanent deletion for Porter Visits and Property Service Reports V1.
begin;

create or replace function public.delete_porter_visit(
  p_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old public.property_service_visits;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Porter Visit access denied.' using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'Porter Visit ID is required.';
  end if;

  select * into v_old from public.property_service_visits where id = p_id for update;
  if not found then
    raise exception 'Porter Visit not found.';
  end if;

  -- Remove stop references on any route without deleting the route itself.
  delete from public.property_service_route_stops where visit_id = p_id;

  -- Remove photo metadata and storage objects associated with this visit.
  delete from public.property_service_visit_photos where visit_id = p_id;
  delete from storage.objects where bucket_id = 'operational-photos' and name like 'porter-visits/' || p_id::text || '/%';

  -- Remove issues and snapshotted service areas for this visit.
  delete from public.property_service_visit_issues where visit_id = p_id;
  delete from public.property_service_visit_areas where visit_id = p_id;

  -- Delete the visit record.
  delete from public.property_service_visits where id = p_id;
end;
$$;

revoke all on function public.delete_porter_visit(uuid) from public, anon, authenticated;
grant execute on function public.delete_porter_visit(uuid) to authenticated;

commit;
