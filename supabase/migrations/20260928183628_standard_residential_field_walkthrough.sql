begin;

create or replace function public.get_assigned_field_walkthroughs()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare result jsonb; employee uuid;
begin
  employee := public.current_employee_id();
  if (select auth.uid()) is null or employee is null
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
    'scope', coalesce((select jsonb_agg(jsonb_build_object('id', item->>'id', 'label', item->>'label')) from jsonb_array_elements(coalesce(w.scope, '[]'::jsonb)) item), '[]'::jsonb),
    'included_addons', coalesce((select jsonb_agg(addon->>'name') from jsonb_array_elements(coalesce(w.measurements->'catalogAddons', '[]'::jsonb)) addon where nullif(btrim(addon->>'name'), '') is not null), '[]'::jsonb),
    'standard_residential_context', jsonb_build_object(
      'customerProperty', concat_ws(' — ', coalesce(c.company_name, nullif(concat_ws(' ', c.first_name, c.last_name), '')), concat_ws(', ', p.property_name, p.address, p.city, p.state, p.zip)),
      'service', w.measurements->>'serviceType',
      'bedrooms', w.measurements->'bedrooms',
      'bathrooms', w.measurements->'bathrooms',
      'squareFeet', w.measurements->'squareFeet',
      'pets', w.measurements->'pets',
      'currentCleanerVendor', w.measurements->'currentCleaningSituation',
      'majorConcerns', w.measurements->'majorServiceConcerns',
      'propertyContext', w.measurements->'propertyContext',
      'accessConsiderations', w.measurements->'accessRestrictions',
      'customerNotes', e.notes,
      'walkthroughDateTime', concat_ws(' at ', w.walkthrough_date::text, left(w.walkthrough_time::text, 5)),
      'walkthroughMethod', w.measurements->'assessmentMethod'
    ),
    'measurements', jsonb_build_object(
      'overallCondition', w.measurements->'overallCondition', 'squareFeet', w.measurements->'squareFeet',
      'bedrooms', w.measurements->'bedrooms', 'bathrooms', w.measurements->'bathrooms', 'floors', w.measurements->'floors',
      'restrooms', w.measurements->'restrooms', 'kitchenAreas', w.measurements->'kitchenAreas',
      'specialtyAreas', w.measurements->'specialtyAreas', 'accessRestrictions', w.measurements->'accessRestrictions',
      'parkingLoading', w.measurements->'parkingLoading', 'waterAccess', w.measurements->'waterAccess',
      'powerAccess', w.measurements->'powerAccess', 'securityAlarm', w.measurements->'securityAlarm',
      'pets', w.measurements->'pets',
      'heavySoilBuildup', coalesce(nullif(w.measurements->'heavySoilBuildup', 'null'::jsonb), 'false'::jsonb),
      'damageObserved', w.measurements->'damageObserved', 'hazardsObserved', w.measurements->'hazardsObserved',
      'postConstructionAssessment', jsonb_build_object('fieldWalkthrough', w.measurements->'postConstructionAssessment'->'fieldWalkthrough'),
      'standardResidentialAssessment', jsonb_build_object('fieldWalkthrough', w.measurements->'standardResidentialAssessment'->'fieldWalkthrough')
    )
  ) order by w.walkthrough_date, w.walkthrough_time), '[]'::jsonb)
  into result
  from public.walkthroughs w
  left join public.clients c on c.id = w.client_id
  left join public.properties p on p.id = w.property_id
  left join public.estimates e on e.id = w.estimate_id
  where w.assigned_employee_id = employee and w.status = 'Scheduled' and w.archived_at is null
    and w.walkthrough_date is not null and w.walkthrough_time is not null;
  return result;
end;
$function$;

create or replace function public.submit_assigned_field_walkthrough(p_id uuid, p_measurements jsonb, p_complete boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  walkthrough public.walkthroughs; employee uuid; key_name text; value_json jsonb;
  incoming_post jsonb; post_field jsonb; post_answers jsonb; post_confirmations jsonb;
  incoming_standard jsonb; standard_field jsonb; standard_answers jsonb;
  existing_post jsonb; existing_standard jsonb; merged_measurements jsonb; required_key text;
begin
  employee := public.current_employee_id();
  if (select auth.uid()) is null or employee is null
    or not public.has_any_role(array['Crew Lead', 'Scrub Technician']) then
    raise exception 'Field access denied' using errcode = '42501';
  end if;
  select * into walkthrough from public.walkthroughs where id = p_id for update;
  if not found or walkthrough.status <> 'Scheduled' or walkthrough.archived_at is not null
    or walkthrough.assigned_employee_id is distinct from employee
    or walkthrough.walkthrough_date is null or walkthrough.walkthrough_time is null then
    raise exception 'Scheduled assignment no longer available';
  end if;
  if p_measurements is null or jsonb_typeof(p_measurements) <> 'object' then raise exception 'Measurements must be an object'; end if;

  for key_name, value_json in select * from jsonb_each(p_measurements) loop
    if not key_name = any(array[
      'overallCondition','squareFeet','bedrooms','bathrooms','floors','restrooms','kitchenAreas','specialtyAreas',
      'accessRestrictions','parkingLoading','waterAccess','powerAccess','securityAlarm','pets','heavySoilBuildup',
      'damageObserved','hazardsObserved','postConstructionAssessment','standardResidentialAssessment'
    ]) then raise exception 'Field is not writable: %', key_name; end if;
    if key_name = 'overallCondition' and value_json <> 'null'::jsonb
      and not (value_json#>>'{}') = any(array['','Light','Average','Heavy','Extreme']) then raise exception 'Invalid overall condition'; end if;
    if key_name = any(array['squareFeet','bedrooms','bathrooms','floors','restrooms','kitchenAreas']) then
      if value_json <> 'null'::jsonb and (jsonb_typeof(value_json) <> 'number' or (value_json#>>'{}')::numeric < 0) then raise exception 'Invalid measurement'; end if;
    elsif key_name = 'heavySoilBuildup' then
      if jsonb_typeof(value_json) <> 'boolean' then raise exception 'Invalid condition'; end if;
    elsif key_name not in ('postConstructionAssessment','standardResidentialAssessment') and value_json <> 'null'::jsonb
      and (jsonb_typeof(value_json) <> 'string' or length(value_json#>>'{}') > 5000) then raise exception 'Invalid observation'; end if;
  end loop;

  incoming_post := coalesce(p_measurements->'postConstructionAssessment', '{}'::jsonb);
  if jsonb_typeof(incoming_post) <> 'object' or exists(select 1 from jsonb_object_keys(incoming_post) key where key <> 'fieldWalkthrough') then raise exception 'Only the technician field walkthrough is writable'; end if;
  post_field := incoming_post->'fieldWalkthrough';
  if post_field is not null and (jsonb_typeof(post_field) <> 'object'
    or exists(select 1 from jsonb_object_keys(post_field) key where key not in ('answers','sectionConfirmations'))
    or jsonb_typeof(post_field->'answers') <> 'object' or jsonb_typeof(post_field->'sectionConfirmations') <> 'object') then raise exception 'Invalid field walkthrough'; end if;
  post_answers := coalesce(post_field->'answers', '{}'::jsonb);
  post_confirmations := coalesce(post_field->'sectionConfirmations', '{}'::jsonb);
  for key_name, value_json in select * from jsonb_each(post_answers) loop
    if not key_name = any(array['includedAreas','excludedAreas','pricingReviewItems','siteReady','measurementsVerified','cleaningStandard','windowsGlass','floorsResidue','cabinetScope','applianceScope','debrisExclusions','specialtySurfaces','accessUtilities','scheduleDeadline','activeTrades','crewRestrictions','finalSignOff'])
      or jsonb_typeof(value_json) <> 'string' or length(value_json#>>'{}') > 5000 then raise exception 'Invalid technician walkthrough answer: %', key_name; end if;
  end loop;
  for key_name, value_json in select * from jsonb_each(post_confirmations) loop
    if key_name !~ '^(?:[1-9]|1[0-5])$' or jsonb_typeof(value_json) <> 'string'
      or not (value_json#>>'{}') = any(array['Yes','No','Unknown / Confirm Later']) then raise exception 'Invalid technician section status: %', key_name; end if;
  end loop;

  incoming_standard := coalesce(p_measurements->'standardResidentialAssessment', '{}'::jsonb);
  if jsonb_typeof(incoming_standard) <> 'object' or exists(select 1 from jsonb_object_keys(incoming_standard) key where key <> 'fieldWalkthrough') then raise exception 'Only the technician Standard Residential walkthrough is writable'; end if;
  standard_field := incoming_standard->'fieldWalkthrough';
  if standard_field is not null and (jsonb_typeof(standard_field) <> 'object'
    or exists(select 1 from jsonb_object_keys(standard_field) key where key <> 'answers')
    or jsonb_typeof(standard_field->'answers') <> 'object') then raise exception 'Invalid Standard Residential field walkthrough'; end if;
  standard_answers := coalesce(standard_field->'answers', '{}'::jsonb);
  for key_name, value_json in select * from jsonb_each(standard_answers) loop
    if not key_name = any(array[
      'occupancy','overallCondition','clutterLevel','inaccessibleAreas','flooring','flooringOther','flooringSpecialTreatment','flooringConditionNotes',
      'kitchenCondition','heavyGrease','dishesBlocking','applianceExteriors','cabinetBuildup','bathroomCondition','soapScum','mineralBuildup',
      'mildewLikeBuildup','heavyBathroomDetailing','dustCondition','petHairLevel','petStaining','petOdor','petsSecured','extraAttention',
      'extraAttentionOther','specialPrecautions','specialSurfaceTypes','specialSurfaceNotes','serviceAppropriate','serviceRecommendationNotes',
      'laborLevel','recommendedCrew','serviceDuration','materialException','exceptionNotes','technicianConfirmation'
    ]) then raise exception 'Invalid Standard Residential answer: %', key_name; end if;
    if jsonb_typeof(value_json) = 'string' and length(value_json#>>'{}') > 5000 then raise exception 'Standard Residential answer is too long: %', key_name; end if;
    if jsonb_typeof(value_json) = 'array' and (jsonb_array_length(value_json) > 20 or exists(select 1 from jsonb_array_elements(value_json) item where jsonb_typeof(item) <> 'string' or length(item#>>'{}') > 200)) then raise exception 'Invalid Standard Residential selection: %', key_name; end if;
    if jsonb_typeof(value_json) not in ('string','array','boolean','null') then raise exception 'Invalid Standard Residential answer type: %', key_name; end if;
  end loop;

  if p_complete and coalesce(walkthrough.measurements->>'serviceType', '') ~* 'post[- ]construction' then
    if post_field is null or exists(select 1 from generate_series(1,15) n where nullif(btrim(post_confirmations->>n::text),'') is null) then raise exception 'All 15 guided walkthrough sections require answers or follow-up markers'; end if;
    foreach required_key in array array['includedAreas','siteReady','measurementsVerified','cleaningStandard','windowsGlass','floorsResidue','cabinetScope','applianceScope','debrisExclusions','specialtySurfaces','accessUtilities','scheduleDeadline','activeTrades','crewRestrictions','finalSignOff'] loop
      if nullif(btrim(post_answers->>required_key),'') is null then raise exception 'Required guided walkthrough answer is missing: %', required_key; end if;
    end loop;
  end if;

  if p_complete and coalesce(walkthrough.measurements->>'serviceType','') = 'Standard Cleaning' then
    foreach required_key in array array['occupancy','overallCondition','clutterLevel','flooring','flooringSpecialTreatment','kitchenCondition','heavyGrease','dishesBlocking','applianceExteriors','cabinetBuildup','bathroomCondition','soapScum','mineralBuildup','mildewLikeBuildup','heavyBathroomDetailing','dustCondition','extraAttention','specialPrecautions','serviceAppropriate','laborLevel','recommendedCrew','serviceDuration','materialException'] loop
      if not standard_answers ? required_key or standard_answers->required_key in ('null'::jsonb,'""'::jsonb,'[]'::jsonb) then raise exception 'Required Standard Residential answer is missing: %', required_key; end if;
    end loop;
    if walkthrough.measurements->>'pets' is distinct from 'No' then foreach required_key in array array['petHairLevel','petStaining','petOdor','petsSecured'] loop if nullif(btrim(standard_answers->>required_key),'') is null then raise exception 'Required pet-impact answer is missing: %', required_key; end if; end loop; end if;
    if standard_answers->>'clutterLevel' = 'Areas inaccessible due to clutter' and nullif(btrim(standard_answers->>'inaccessibleAreas'),'') is null then raise exception 'Inaccessible area notes are required'; end if;
    if standard_answers->'flooring' ? 'Other' and nullif(btrim(standard_answers->>'flooringOther'),'') is null then raise exception 'Other flooring description is required'; end if;
    if standard_answers->>'flooringSpecialTreatment' = 'Yes' and nullif(btrim(standard_answers->>'flooringConditionNotes'),'') is null then raise exception 'Flooring condition notes are required'; end if;
    if standard_answers->'extraAttention' ? 'Other' and nullif(btrim(standard_answers->>'extraAttentionOther'),'') is null then raise exception 'Other extra-attention notes are required'; end if;
    if standard_answers->>'specialPrecautions' = 'Yes' and (standard_answers->'specialSurfaceTypes' in ('null'::jsonb,'[]'::jsonb) or nullif(btrim(standard_answers->>'specialSurfaceNotes'),'') is null) then raise exception 'Special-surface selections and notes are required'; end if;
    if standard_answers->>'serviceAppropriate' <> 'Yes' and nullif(btrim(standard_answers->>'serviceRecommendationNotes'),'') is null then raise exception 'Service recommendation notes are required'; end if;
    if standard_answers->>'materialException' = 'Yes' and nullif(btrim(standard_answers->>'exceptionNotes'),'') is null then raise exception 'Walkthrough exception notes are required'; end if;
    if standard_answers->'technicianConfirmation' is distinct from 'true'::jsonb then raise exception 'Final technician confirmation is required'; end if;
  end if;

  merged_measurements := coalesce(walkthrough.measurements, '{}'::jsonb) || (p_measurements - 'postConstructionAssessment' - 'standardResidentialAssessment');
  if p_measurements ? 'postConstructionAssessment' then
    existing_post := coalesce(walkthrough.measurements->'postConstructionAssessment','{}'::jsonb);
    merged_measurements := jsonb_set(merged_measurements,'{postConstructionAssessment}',jsonb_set(existing_post,'{fieldWalkthrough}',post_field,true),true);
  end if;
  if p_measurements ? 'standardResidentialAssessment' then
    existing_standard := coalesce(walkthrough.measurements->'standardResidentialAssessment','{}'::jsonb);
    merged_measurements := jsonb_set(merged_measurements,'{standardResidentialAssessment}',jsonb_set(existing_standard,'{fieldWalkthrough}',standard_field,true),true);
  end if;
  update public.walkthroughs set measurements = merged_measurements, status = case when p_complete then 'Completed' else 'Scheduled' end where id = p_id;
end;
$function$;

revoke all on function public.get_assigned_field_walkthroughs() from public, anon, authenticated;
revoke all on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.get_assigned_field_walkthroughs() to authenticated;
grant execute on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
