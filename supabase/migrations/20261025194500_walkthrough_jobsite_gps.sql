-- Walkthrough GPS registration; scoped to existing scheduled walkthrough permission.
create function public.get_walkthrough_jobsite_gps(p_walkthrough_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_property uuid; v_radius integer;
begin
 if not coalesce(public.can_perform_scheduled_walkthrough(p_walkthrough_id),false) then
  raise exception 'Walkthrough access denied' using errcode='42501';
 end if;
 select w.property_id into v_property from public.walkthroughs w where w.id=p_walkthrough_id and w.archived_at is null;
 select s.radius_meters into v_radius from public.jobsite_geofence_settings s where s.property_id=v_property and s.enabled;
 return jsonb_build_object('linked',v_property is not null,'configured',v_radius is not null,'radiusMeters',v_radius);
end $$;
create function public.capture_walkthrough_jobsite_gps(p_walkthrough_id uuid,p_position jsonb,p_radius_meters integer default 250)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_property uuid; v_actor uuid:=(select auth.uid());
begin
 if v_actor is null or not coalesce(public.can_perform_scheduled_walkthrough(p_walkthrough_id),false) then
  raise exception 'Walkthrough access denied' using errcode='42501';
 end if;
 select w.property_id into v_property from public.walkthroughs w
 join public.properties pr on pr.id=w.property_id and pr.archived_at is null
 where w.id=p_walkthrough_id and w.archived_at is null;
 if v_property is null then raise exception 'Active linked property required'; end if;
 perform private.jobsite_validate_position(p_position);
 if p_radius_meters is null or p_radius_meters not between 100 and 500 then raise exception 'Invalid radius'; end if;
 insert into public.jobsite_geofence_settings(property_id,latitude,longitude,radius_meters,updated_by)
 values(v_property,(p_position->>'latitude')::double precision,(p_position->>'longitude')::double precision,p_radius_meters,v_actor)
 on conflict(property_id) do nothing;
 if not found then raise exception 'GPS already registered. Contact management for corrections'; end if;
 return jsonb_build_object('configured',true,'radiusMeters',p_radius_meters);
end $$;
revoke all on function public.get_walkthrough_jobsite_gps(uuid),public.capture_walkthrough_jobsite_gps(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.get_walkthrough_jobsite_gps(uuid),public.capture_walkthrough_jobsite_gps(uuid,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
