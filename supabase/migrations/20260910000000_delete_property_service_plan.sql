-- Management permanent deletion for Property Service Plans V1.
begin;

create or replace function public.delete_property_service_plan(
  p_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old public.property_service_plans;
  v_visits_count integer := 0;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Property Service Plan access denied.' using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'Plan ID is required.';
  end if;

  select * into v_old from public.property_service_plans where id = p_id for update;
  if not found then
    raise exception 'Property Service Plan not found.';
  end if;

  select count(*) into v_visits_count from public.property_service_visits where service_plan_id = p_id;
  if v_visits_count > 0 then
    raise exception 'This Property Service Plan cannot be permanently deleted because it has % associated Porter Visit(s). Archive the plan instead.', v_visits_count using errcode = '23503';
  end if;

  delete from public.property_service_plan_areas where service_plan_id = p_id;
  delete from public.property_service_plans where id = p_id;
end;
$$;

revoke all on function public.delete_property_service_plan(uuid) from public, anon, authenticated;
grant execute on function public.delete_property_service_plan(uuid) to authenticated;

commit;
