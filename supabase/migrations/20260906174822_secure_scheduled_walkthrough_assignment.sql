begin;
alter table public.walkthroughs add column assigned_employee_id uuid null references public.employees(id) on delete set null;
create index walkthroughs_scheduled_employee_idx on public.walkthroughs(assigned_employee_id) where status = 'Scheduled' and archived_at is null;

-- Keep existing Master Admin policies. Restrictive guards also constrain any older permissive policies.
do $$ declare t text; begin
  foreach t in array array['estimates','walkthroughs','proposals','proposal_history'] loop
    execute format('create policy "Sales pipeline boundary" on public.%I as restrictive for all to authenticated using (public.has_any_role(array[''Master Admin'',''Administrator'',''Sales''])) with check (public.has_any_role(array[''Master Admin'',''Administrator'',''Sales'']))',t);
  end loop;
  foreach t in array array['estimates','walkthroughs'] loop
    execute format('alter policy "Sales operations read" on public.%I using (public.has_any_role(array[''Administrator'',''Sales'']))',t);
    execute format('alter policy "Sales operations write" on public.%I with check (public.has_any_role(array[''Administrator'',''Sales'']))',t);
    execute format('alter policy "Sales operations update" on public.%I using (public.has_any_role(array[''Administrator'',''Sales''])) with check (public.has_any_role(array[''Administrator'',''Sales'']))',t);
  end loop;
end $$;
alter policy "Proposal role read" on public.proposals using (public.has_any_role(array['Administrator','Sales']));
alter policy "Proposal role create" on public.proposals with check (public.has_any_role(array['Administrator','Sales']));
alter policy "Proposal role update" on public.proposals using (public.has_any_role(array['Administrator','Sales'])) with check (public.has_any_role(array['Administrator','Sales']));
alter policy "Proposal role history append" on public.proposal_history with check (public.has_any_role(array['Administrator','Sales']));

-- A boolean authorization helper, never a raw-row read endpoint.
create function public.can_perform_scheduled_walkthrough(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and public.has_any_role(array['Crew Lead','Scrub Technician'])
 and public.current_employee_id() is not null and exists (
 select 1 from public.walkthroughs w where w.id=p_id and w.status='Scheduled'
 and w.archived_at is null and w.walkthrough_date is not null and w.walkthrough_time is not null
 and w.assigned_employee_id=public.current_employee_id());
$$;
revoke all on function public.can_perform_scheduled_walkthrough(uuid) from public, anon;
grant execute on function public.can_perform_scheduled_walkthrough(uuid) to authenticated;

-- Walkthrough client/property identity is returned only by the sanitized field RPC.
-- Existing assigned-job client/property helpers and policies are unchanged.

create function public.get_assigned_field_walkthroughs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; employee uuid;
begin
 employee:=public.current_employee_id();
 if auth.uid() is null or employee is null or not public.has_any_role(array['Crew Lead','Scrub Technician']) then raise exception 'Field access denied'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',w.id,'walkthrough_date',w.walkthrough_date,'walkthrough_time',w.walkthrough_time,
 'contact_name',coalesce(w.contact_name,nullif(concat_ws(' ',c.first_name,c.last_name),'')),
 'company_name',c.company_name,'phone',coalesce(w.phone,c.phone),'email',coalesce(w.email,c.email),
 'property',concat_ws(', ',p.property_name,p.address,p.address_line_2,p.city,p.state,p.zip),
 'service',w.measurements->>'serviceType',
 'scope',coalesce((select jsonb_agg(jsonb_build_object('id',x->>'id','label',x->>'label')) from jsonb_array_elements(coalesce(w.scope,'[]'::jsonb)) x),'[]'::jsonb),
 'measurements',jsonb_build_object('overallCondition',w.measurements->'overallCondition','squareFeet',w.measurements->'squareFeet','bedrooms',w.measurements->'bedrooms','bathrooms',w.measurements->'bathrooms','floors',w.measurements->'floors','restrooms',w.measurements->'restrooms','kitchenAreas',w.measurements->'kitchenAreas','specialtyAreas',w.measurements->'specialtyAreas','accessRestrictions',w.measurements->'accessRestrictions','parkingLoading',w.measurements->'parkingLoading','waterAccess',w.measurements->'waterAccess','powerAccess',w.measurements->'powerAccess','securityAlarm',w.measurements->'securityAlarm','pets',w.measurements->'pets','heavySoilBuildup',coalesce(nullif(w.measurements->'heavySoilBuildup','null'::jsonb),'false'::jsonb),'damageObserved',w.measurements->'damageObserved','hazardsObserved',w.measurements->'hazardsObserved')
 ) order by w.walkthrough_date,w.walkthrough_time),'[]'::jsonb) into result
 from public.walkthroughs w left join public.clients c on c.id=w.client_id left join public.properties p on p.id=w.property_id
 where w.assigned_employee_id=employee and w.status='Scheduled' and w.archived_at is null
 and w.walkthrough_date is not null and w.walkthrough_time is not null;
 return result;
end $$;
revoke all on function public.get_assigned_field_walkthroughs() from public, anon;
grant execute on function public.get_assigned_field_walkthroughs() to authenticated;

create function public.submit_assigned_field_walkthrough(p_id uuid,p_measurements jsonb,p_complete boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.walkthroughs; employee uuid; k text; v jsonb;
begin
 employee:=public.current_employee_id();
 if auth.uid() is null or employee is null or not public.has_any_role(array['Crew Lead','Scrub Technician']) then raise exception 'Field access denied'; end if;
 select * into w from public.walkthroughs where id=p_id for update;
 if not found or w.status<>'Scheduled' or w.archived_at is not null or w.assigned_employee_id is distinct from employee
 or w.walkthrough_date is null or w.walkthrough_time is null then raise exception 'Scheduled assignment no longer available'; end if;
 if p_measurements is null or jsonb_typeof(p_measurements)<>'object' then raise exception 'Measurements must be an object'; end if;
 for k,v in select * from jsonb_each(p_measurements) loop
   if not k=any(array['overallCondition','squareFeet','bedrooms','bathrooms','floors','restrooms','kitchenAreas','specialtyAreas','accessRestrictions','parkingLoading','waterAccess','powerAccess','securityAlarm','pets','heavySoilBuildup','damageObserved','hazardsObserved']) then raise exception 'Field is not writable: %',k; end if;
   if k='overallCondition' and v<>'null'::jsonb and not (v#>>'{}')=any(array['','Light','Average','Heavy','Extreme']) then raise exception 'Invalid overall condition'; end if;
   if k=any(array['squareFeet','bedrooms','bathrooms','floors','restrooms','kitchenAreas']) then
     if v<>'null'::jsonb and (jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric<0) then raise exception 'Invalid measurement'; end if;
   elsif k='heavySoilBuildup' then
     if jsonb_typeof(v)<>'boolean' then raise exception 'Invalid condition'; end if;
   elsif v<>'null'::jsonb and (jsonb_typeof(v)<>'string' or length(v#>>'{}')>5000) then raise exception 'Invalid observation'; end if;
 end loop;
 update public.walkthroughs set measurements=coalesce(w.measurements,'{}'::jsonb)||p_measurements,
 status=case when p_complete then 'Completed' else 'Scheduled' end where id=p_id;
end $$;
revoke all on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) from public, anon;
grant execute on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) to authenticated;

create or replace function public.can_read_operational_photo_record(
  p_record_type text,
  p_record_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then return false; end if;
  if p_record_type = 'walkthroughs' then
    return (public.has_any_role(array['Master Admin','Administrator','Sales']) and exists(select 1 from public.walkthroughs where id=p_record_id)) or public.can_perform_scheduled_walkthrough(p_record_id);
  end if;
  v_role := public.current_user_role();
  if v_role in ('Master Admin', 'Administrator', 'Manager') then
    if p_record_type = 'walkthroughs' then return exists(select 1 from public.walkthroughs where id = p_record_id); end if;
    if p_record_type = 'jobs' then return exists(select 1 from public.jobs where id = p_record_id); end if;
    return false;
  end if;
  if p_record_type = 'walkthroughs' then
    -- Mirrors role_permissions.sql: Sales has read access to all Walkthrough rows.
    return v_role = 'Sales' and exists(select 1 from public.walkthroughs where id = p_record_id);
  end if;
  if p_record_type = 'jobs' then
    return v_role in ('Crew Lead', 'Scrub Technician') and exists(
      select 1 from public.jobs j
      where j.id = p_record_id and public.is_assigned_to_crew(j.assigned_crew_id)
    );
  end if;
  return false;
end;
$$;

create or replace function public.can_write_operational_photo_record(
  p_record_type text,
  p_record_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then return false; end if;
  if p_record_type = 'walkthroughs' then
    return (public.has_any_role(array['Master Admin','Administrator','Sales']) and exists(select 1 from public.walkthroughs where id=p_record_id)) or public.can_perform_scheduled_walkthrough(p_record_id);
  end if;
  v_role := public.current_user_role();
  if v_role in ('Master Admin', 'Administrator', 'Manager') then
    if p_record_type = 'walkthroughs' then return exists(select 1 from public.walkthroughs where id = p_record_id); end if;
    if p_record_type = 'jobs' then return exists(select 1 from public.jobs where id = p_record_id); end if;
    return false;
  end if;
  if p_record_type = 'jobs' then
    return v_role in ('Crew Lead', 'Scrub Technician') and exists(
      select 1 from public.jobs j
      where j.id = p_record_id and public.is_assigned_to_crew(j.assigned_crew_id)
    );
  end if;
  return false;
end;
$$;

create or replace function public.can_delete_operational_photo_record(
  p_record_type text,
  p_record_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then return false; end if;
  if p_record_type = 'walkthroughs' then
    return (public.has_any_role(array['Master Admin','Administrator','Sales']) and exists(select 1 from public.walkthroughs where id=p_record_id)) or false;
  end if;
  v_role := public.current_user_role();
  if v_role not in ('Master Admin', 'Administrator', 'Manager') then return false; end if;
  if p_record_type = 'walkthroughs' then return exists(select 1 from public.walkthroughs where id = p_record_id); end if;
  if p_record_type = 'jobs' then return exists(select 1 from public.jobs where id = p_record_id); end if;
  return false;
end;
$$;

create or replace function public.set_operational_photos(p_record_type text, p_record_id uuid, p_photos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_existing jsonb;
begin
  if not public.can_write_operational_photo_record(p_record_type, p_record_id) then raise exception 'Photo update denied.'; end if;
  perform public.validate_operational_photos(p_record_type, p_record_id, p_photos);
  if p_record_type = 'walkthroughs' then select photos into v_existing from public.walkthroughs where id = p_record_id for update;
  elsif p_record_type = 'jobs' then select photos into v_existing from public.jobs where id = p_record_id for update;
  else raise exception 'Unsupported operational photo record type.';
  end if;
  if not found then raise exception 'Operational record not found.'; end if;
  if p_record_type='walkthroughs' and not public.can_write_operational_photo_record(p_record_type,p_record_id) then raise exception 'Photo assignment no longer available'; end if;
  if p_record_type='walkthroughs' and public.has_any_role(array['Crew Lead','Scrub Technician']) then
    if exists(select 1 from jsonb_array_elements(coalesce(v_existing,'[]'::jsonb)) old_photo
      where not p_photos @> jsonb_build_array(old_photo)) then raise exception 'Existing photos cannot be changed by field upload'; end if;
    if exists(select 1 from jsonb_array_elements(p_photos) x where not coalesce(v_existing,'[]'::jsonb) @> jsonb_build_array(x)
      and (x->>'uploadedBy' is distinct from auth.uid()::text or x->>'customerVisible' is distinct from 'false')) then raise exception 'Invalid field photo'; end if;
  end if;
  if not public.can_delete_operational_photo_record(p_record_type, p_record_id) and exists(
    select 1 from jsonb_array_elements(coalesce(v_existing, '[]'::jsonb)) old_photo
    where not exists(
      select 1 from jsonb_array_elements(p_photos) new_photo
      where new_photo->>'id' = old_photo->>'id'
        and new_photo->>'storagePath' = old_photo->>'storagePath'
    )
  ) then raise exception 'Photo deletion is restricted to administrative roles.';
  end if;
  if p_record_type = 'walkthroughs' then update public.walkthroughs set photos = p_photos where id = p_record_id;
  else update public.jobs set photos = p_photos where id = p_record_id;
  end if;
  return p_photos;
end;
$$;
revoke all on function public.can_read_operational_photo_record(text,uuid), public.can_write_operational_photo_record(text,uuid), public.can_delete_operational_photo_record(text,uuid), public.set_operational_photos(text,uuid,jsonb) from public, anon;
grant execute on function public.can_read_operational_photo_record(text,uuid), public.can_write_operational_photo_record(text,uuid), public.can_delete_operational_photo_record(text,uuid), public.set_operational_photos(text,uuid,jsonb) to authenticated;
commit;
