begin;

-- Extend the established assigned-field RPCs without broadening table grants.
-- The technician projection exposes only the assigned visit and the technician
-- portion of the structured Post-Construction assessment snapshot.
create or replace function public.get_assigned_field_walkthroughs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  employee uuid;
begin
  employee := public.current_employee_id();
  if auth.uid() is null or employee is null
    or not public.has_any_role(array['Crew Lead', 'Scrub Technician']) then
    raise exception 'Field access denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', w.id,
    'walkthrough_date', w.walkthrough_date,
    'walkthrough_time', w.walkthrough_time,
    'contact_name', coalesce(w.contact_name, nullif(concat_ws(' ', c.first_name, c.last_name), '')),
    'company_name', c.company_name,
    'phone', coalesce(w.phone, c.phone),
    'email', coalesce(w.email, c.email),
    'property', concat_ws(', ', p.property_name, p.address, p.address_line_2, p.city, p.state, p.zip),
    'service', w.measurements->>'serviceType',
    'scope', coalesce((
      select jsonb_agg(jsonb_build_object('id', item->>'id', 'label', item->>'label'))
      from jsonb_array_elements(coalesce(w.scope, '[]'::jsonb)) item
    ), '[]'::jsonb),
    'measurements', jsonb_build_object(
      'overallCondition', w.measurements->'overallCondition',
      'squareFeet', w.measurements->'squareFeet',
      'bedrooms', w.measurements->'bedrooms',
      'bathrooms', w.measurements->'bathrooms',
      'floors', w.measurements->'floors',
      'restrooms', w.measurements->'restrooms',
      'kitchenAreas', w.measurements->'kitchenAreas',
      'specialtyAreas', w.measurements->'specialtyAreas',
      'accessRestrictions', w.measurements->'accessRestrictions',
      'parkingLoading', w.measurements->'parkingLoading',
      'waterAccess', w.measurements->'waterAccess',
      'powerAccess', w.measurements->'powerAccess',
      'securityAlarm', w.measurements->'securityAlarm',
      'pets', w.measurements->'pets',
      'heavySoilBuildup', coalesce(nullif(w.measurements->'heavySoilBuildup', 'null'::jsonb), 'false'::jsonb),
      'damageObserved', w.measurements->'damageObserved',
      'hazardsObserved', w.measurements->'hazardsObserved',
      'postConstructionAssessment', jsonb_build_object(
        'fieldWalkthrough', w.measurements->'postConstructionAssessment'->'fieldWalkthrough'
      )
    )
  ) order by w.walkthrough_date, w.walkthrough_time), '[]'::jsonb)
  into result
  from public.walkthroughs w
  left join public.clients c on c.id = w.client_id
  left join public.properties p on p.id = w.property_id
  where w.assigned_employee_id = employee
    and w.status = 'Scheduled'
    and w.archived_at is null
    and w.walkthrough_date is not null
    and w.walkthrough_time is not null;

  return result;
end;
$function$;

create or replace function public.submit_assigned_field_walkthrough(
  p_id uuid,
  p_measurements jsonb,
  p_complete boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  walkthrough public.walkthroughs;
  employee uuid;
  key_name text;
  value_json jsonb;
  incoming_assessment jsonb;
  incoming_field jsonb;
  incoming_answers jsonb;
  incoming_confirmations jsonb;
  existing_assessment jsonb;
  merged_measurements jsonb;
  required_key text;
begin
  employee := public.current_employee_id();
  if auth.uid() is null or employee is null
    or not public.has_any_role(array['Crew Lead', 'Scrub Technician']) then
    raise exception 'Field access denied' using errcode = '42501';
  end if;

  select * into walkthrough
  from public.walkthroughs
  where id = p_id
  for update;

  if not found or walkthrough.status <> 'Scheduled' or walkthrough.archived_at is not null
    or walkthrough.assigned_employee_id is distinct from employee
    or walkthrough.walkthrough_date is null or walkthrough.walkthrough_time is null then
    raise exception 'Scheduled assignment no longer available';
  end if;
  if p_measurements is null or jsonb_typeof(p_measurements) <> 'object' then
    raise exception 'Measurements must be an object';
  end if;

  for key_name, value_json in select * from jsonb_each(p_measurements) loop
    if not key_name = any(array[
      'overallCondition','squareFeet','bedrooms','bathrooms','floors','restrooms','kitchenAreas',
      'specialtyAreas','accessRestrictions','parkingLoading','waterAccess','powerAccess','securityAlarm',
      'pets','heavySoilBuildup','damageObserved','hazardsObserved','postConstructionAssessment'
    ]) then raise exception 'Field is not writable: %', key_name; end if;
    if key_name = 'overallCondition' and value_json <> 'null'::jsonb
      and not (value_json#>>'{}') = any(array['','Light','Average','Heavy','Extreme']) then raise exception 'Invalid overall condition'; end if;
    if key_name = any(array['squareFeet','bedrooms','bathrooms','floors','restrooms','kitchenAreas']) then
      if value_json <> 'null'::jsonb and (jsonb_typeof(value_json) <> 'number' or (value_json#>>'{}')::numeric < 0) then raise exception 'Invalid measurement'; end if;
    elsif key_name = 'heavySoilBuildup' then
      if jsonb_typeof(value_json) <> 'boolean' then raise exception 'Invalid condition'; end if;
    elsif key_name <> 'postConstructionAssessment' and value_json <> 'null'::jsonb
      and (jsonb_typeof(value_json) <> 'string' or length(value_json#>>'{}') > 5000) then raise exception 'Invalid observation'; end if;
  end loop;

  incoming_assessment := coalesce(p_measurements->'postConstructionAssessment', '{}'::jsonb);
  if jsonb_typeof(incoming_assessment) <> 'object'
    or exists (select 1 from jsonb_object_keys(incoming_assessment) key where key <> 'fieldWalkthrough') then
    raise exception 'Only the technician field walkthrough is writable';
  end if;
  incoming_field := incoming_assessment->'fieldWalkthrough';
  if incoming_field is not null and (
    jsonb_typeof(incoming_field) <> 'object'
    or exists (select 1 from jsonb_object_keys(incoming_field) key where key not in ('answers', 'sectionConfirmations'))
    or jsonb_typeof(incoming_field->'answers') <> 'object'
    or jsonb_typeof(incoming_field->'sectionConfirmations') <> 'object'
  ) then raise exception 'Invalid field walkthrough'; end if;

  incoming_answers := coalesce(incoming_field->'answers', '{}'::jsonb);
  incoming_confirmations := coalesce(incoming_field->'sectionConfirmations', '{}'::jsonb);
  for key_name, value_json in select * from jsonb_each(incoming_answers) loop
    if not key_name = any(array[
      'includedAreas','excludedAreas','pricingReviewItems','siteReady','measurementsVerified','cleaningStandard',
      'windowsGlass','floorsResidue','cabinetScope','applianceScope','debrisExclusions','specialtySurfaces',
      'accessUtilities','scheduleDeadline','activeTrades','crewRestrictions','finalSignOff'
    ]) or jsonb_typeof(value_json) <> 'string' or length(value_json#>>'{}') > 5000 then
      raise exception 'Invalid technician walkthrough answer: %', key_name;
    end if;
  end loop;
  for key_name, value_json in select * from jsonb_each(incoming_confirmations) loop
    if key_name !~ '^(?:[1-9]|1[0-5])$' or jsonb_typeof(value_json) <> 'string'
      or not (value_json#>>'{}') = any(array['Yes','No','Unknown / Confirm Later']) then
      raise exception 'Invalid technician section status: %', key_name;
    end if;
  end loop;

  if p_complete and coalesce(walkthrough.measurements->>'serviceType', '') ~* 'post[- ]construction' then
    if incoming_field is null or exists (
      select 1 from generate_series(1, 15) section_number
      where nullif(btrim(incoming_confirmations->>section_number::text), '') is null
    ) then raise exception 'All 15 guided walkthrough sections require answers or follow-up markers'; end if;
    foreach required_key in array array[
      'includedAreas','siteReady','measurementsVerified','cleaningStandard','windowsGlass',
      'floorsResidue','cabinetScope','applianceScope','debrisExclusions','specialtySurfaces',
      'accessUtilities','scheduleDeadline','activeTrades','crewRestrictions','finalSignOff'
    ] loop
      if nullif(btrim(incoming_answers->>required_key), '') is null then
        raise exception 'Required guided walkthrough answer is missing: %', required_key;
      end if;
    end loop;
  end if;

  merged_measurements := coalesce(walkthrough.measurements, '{}'::jsonb) || (p_measurements - 'postConstructionAssessment');
  if p_measurements ? 'postConstructionAssessment' then
    existing_assessment := coalesce(walkthrough.measurements->'postConstructionAssessment', '{}'::jsonb);
    merged_measurements := jsonb_set(
      merged_measurements,
      '{postConstructionAssessment}',
      jsonb_set(existing_assessment, '{fieldWalkthrough}', incoming_field, true),
      true
    );
  end if;

  update public.walkthroughs
  set measurements = merged_measurements,
      status = case when p_complete then 'Completed' else 'Scheduled' end
  where id = p_id;
end;
$function$;

revoke all on function public.get_assigned_field_walkthroughs()
from public, anon, authenticated;
revoke all on function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
from public, anon, authenticated;
grant execute on function public.get_assigned_field_walkthroughs()
to authenticated;
grant execute on function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
to authenticated;

notify pgrst, 'reload schema';
commit;
