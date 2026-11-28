create or replace function private.inventory_asset_recipient(p_location uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.inventory_employee() and private.inventory_location_access(p_location) and exists (
    select 1
    from public.technician_inventory_locations l
    where l.id = p_location
      and (
        l.employee_id = public.current_employee_id()
        or exists (
          select 1 from public.crews c
          where c.id = l.crew_id and c.crew_lead_id = public.current_employee_id()
        )
      )
  )
$$;
revoke all on function private.inventory_asset_recipient(uuid) from public, anon, authenticated;

create or replace function public.inventory_acknowledgeable_assets()
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(a.id), '{}'::uuid[])
  from public.technician_equipment_assets a
  where a.acknowledged_at is null
    and private.inventory_asset_recipient(a.location_id)
$$;
revoke all on function public.inventory_acknowledgeable_assets() from public, anon;
grant execute on function public.inventory_acknowledgeable_assets() to authenticated;

create or replace function public.inventory_acknowledge_asset(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.technician_equipment_assets
  set acknowledged_at = now(), acknowledged_by = auth.uid()
  where id = p_id
    and acknowledged_at is null
    and private.inventory_asset_recipient(location_id);
  if not found then
    raise exception 'Equipment receipt can only be acknowledged by the current assignee or assigned crew lead, once per assignment.'
      using errcode='42501';
  end if;
end
$$;
