begin;

create or replace function private.prevent_property_delete_with_service_plan()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan_count integer;
begin
  select count(*)
  into v_plan_count
  from public.property_service_plans plan
  where plan.property_id = old.id;

  if v_plan_count > 0 then
    raise exception using
      errcode = '23503',
      message = 'This Property cannot be permanently deleted because it has a Property Service Plan. Permanently delete the eligible archived Service Plan first, or keep the Property archived.';
  end if;

  return old;
end;
$$;

revoke all on function private.prevent_property_delete_with_service_plan()
from public, anon, authenticated;

drop trigger if exists properties_prevent_service_plan_delete on public.properties;
create trigger properties_prevent_service_plan_delete
before delete on public.properties
for each row execute function private.prevent_property_delete_with_service_plan();

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

  if v_old.archived_at is null then
    raise exception 'Only an archived Property Service Plan can be permanently deleted.';
  end if;

  select count(*) into v_visits_count
  from public.property_service_visits
  where service_plan_id = p_id;

  if v_visits_count > 0 then
    raise exception 'This Property Service Plan cannot be permanently deleted because it has % associated Porter Visit(s). Porter Visits and their routes, reports, photos, invoices, and other operational history must be retained. Keep the plan archived.', v_visits_count using errcode = '23503';
  end if;

  delete from public.property_service_plan_areas where service_plan_id = p_id;
  delete from public.property_service_plans where id = p_id;
end;
$$;

revoke all on function public.delete_property_service_plan(uuid) from public, anon, authenticated;
grant execute on function public.delete_property_service_plan(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
