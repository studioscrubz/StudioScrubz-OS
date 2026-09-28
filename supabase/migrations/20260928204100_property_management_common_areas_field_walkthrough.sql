begin;

alter function public.get_assigned_field_walkthroughs()
  rename to get_assigned_field_walkthroughs_commercial_phase_20260928;
revoke all on function public.get_assigned_field_walkthroughs_commercial_phase_20260928()
from public, anon, authenticated;

create function public.get_assigned_field_walkthroughs()
returns jsonb language sql stable security definer set search_path = '' as $function$
  with projected as (
    select item.value, item.ordinality
    from jsonb_array_elements(public.get_assigned_field_walkthroughs_commercial_phase_20260928())
      with ordinality as item(value, ordinality)
  )
  select coalesce(jsonb_agg(projected.value || jsonb_build_object(
    'measurements', coalesce(projected.value->'measurements','{}'::jsonb) || jsonb_build_object(
      'propertyManagementCommonAreasAssessment', jsonb_build_object(
        'fieldWalkthrough', walkthrough.measurements->'propertyManagementCommonAreasAssessment'->'fieldWalkthrough'
      )
    )
  ) order by projected.ordinality), '[]'::jsonb)
  from projected
  join public.walkthroughs walkthrough on walkthrough.id=(projected.value->>'id')::uuid;
$function$;

alter function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean)
  rename to submit_assigned_field_walkthrough_commercial_phase_20260928;
revoke all on function public.submit_assigned_field_walkthrough_commercial_phase_20260928(uuid,jsonb,boolean)
from public, anon, authenticated;

create function public.submit_assigned_field_walkthrough(p_id uuid,p_measurements jsonb,p_complete boolean default false)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  walkthrough public.walkthroughs; employee uuid:=public.current_employee_id(); normalized jsonb:=p_measurements;
  incoming jsonb; field_data jsonb; answers jsonb; existing jsonb; key_name text; value_json jsonb; required_key text; obs_index integer;
begin
  if jsonb_typeof(normalized#>'{propertyManagementCommonAreasAssessment,fieldWalkthrough}')='null' then normalized:=normalized-'propertyManagementCommonAreasAssessment'; end if;
  if not normalized?'propertyManagementCommonAreasAssessment' then
    perform public.submit_assigned_field_walkthrough_commercial_phase_20260928(p_id,normalized,p_complete); return;
  end if;
  if (select auth.uid()) is null or employee is null or not public.has_any_role(array['Crew Lead','Scrub Technician']) then raise exception 'Field access denied' using errcode='42501'; end if;
  select * into walkthrough from public.walkthroughs where id=p_id for update;
  if not found or walkthrough.status<>'Scheduled' or walkthrough.archived_at is not null
    or walkthrough.assigned_employee_id is distinct from employee
    or walkthrough.walkthrough_date is null or walkthrough.walkthrough_time is null then raise exception 'Scheduled assignment no longer available'; end if;
  if coalesce(walkthrough.measurements->>'serviceType','')<>'Apartment Building / Complex Cleaning' then raise exception 'Common Areas observations require PM-COMMON'; end if;

  incoming:=normalized->'propertyManagementCommonAreasAssessment'; field_data:=incoming->'fieldWalkthrough'; answers:=field_data->'answers';
  if jsonb_typeof(incoming)<>'object' or exists(select 1 from jsonb_object_keys(incoming) key where key<>'fieldWalkthrough')
    or jsonb_typeof(field_data)<>'object' or exists(select 1 from jsonb_object_keys(field_data) key where key<>'answers')
    or jsonb_typeof(answers)<>'object' then raise exception 'Invalid Common Areas field walkthrough'; end if;
  for key_name,value_json in select * from jsonb_each(answers) loop
    if not key_name=any(array[
      'unitCount','floorCount','buildingCount','interiorCorridors','exteriorWalkways','occupancy','gatedAccess','keyFob','restrictedAreas','elevatorAccess','parkingRestrictions','serviceHourRestrictions','accessNotes','overallCondition',
      'entryCondition','entryObservation1','entryObservation2','entryObservation3','entryObservation4','entryObservation5',
      'hallwayCondition','hallwayObservation1','hallwayObservation2','hallwayObservation3','hallwayObservation4','hallwayObservation5','hallwayObservation6',
      'stairwellCondition','stairwellObservation1','stairwellObservation2','stairwellObservation3','stairwellObservation4','stairwellObservation5',
      'elevatorCondition','elevatorObservation1','elevatorObservation2','elevatorObservation3','elevatorObservation4','elevatorObservation5',
      'laundryCondition','laundryObservation1','laundryObservation2','laundryObservation3','laundryObservation4','laundryObservation5','laundryObservation6',
      'trashCondition','trashObservation1','trashObservation2','trashObservation3','trashObservation4','trashObservation5',
      'exteriorAreas','exteriorCondition','exteriorOther','amenities','amenityCondition','amenityNotes','parkingType','parkingTrash','parkingDust','parkingOil','parkingEdges','parkingAccess',
      'flooring','floorBuildup','floorStaining','floorSticky','floorPrecautions','floorNotes','entryGlass','commonGlass','mirrors','tracksSills','glassBuildup','glassAccess','glassNotes',
      'touchHandles','touchRailings','touchElevator','touchMail','touchFixtures','touchOther','touchOtherNotes','petHair','petSoiling','residentObstruction','recurringTrash','residentImpactNotes',
      'extraAttention','extraAttentionOther','frequencyObservation','frequencyNotes','serviceSuitable','recommendedServices','serviceNotes','laborLevel','recommendedCrew','serviceDuration','materialException','exceptionNotes','technicianConfirmation'
    ]) then raise exception 'Invalid Common Areas answer: %',key_name; end if;
    if jsonb_typeof(value_json)='string' and length(value_json#>>'{}')>5000 then raise exception 'Common Areas answer is too long: %',key_name; end if;
    if jsonb_typeof(value_json)='array' and (jsonb_array_length(value_json)>20 or exists(select 1 from jsonb_array_elements(value_json) item where jsonb_typeof(item)<>'string' or length(item#>>'{}')>200)) then raise exception 'Invalid Common Areas selection: %',key_name; end if;
    if jsonb_typeof(value_json)='number' and (key_name not in ('unitCount','floorCount','buildingCount') or (value_json#>>'{}')::numeric<0) then raise exception 'Invalid Common Areas quantity: %',key_name; end if;
    if jsonb_typeof(value_json) not in ('string','array','number','boolean','null') then raise exception 'Invalid Common Areas answer type: %',key_name; end if;
  end loop;

  if p_complete then
    foreach required_key in array array[
      'unitCount','buildingCount','interiorCorridors','exteriorWalkways','occupancy','gatedAccess','keyFob','restrictedAreas','elevatorAccess','parkingRestrictions','serviceHourRestrictions','overallCondition',
      'entryCondition','hallwayCondition','stairwellCondition','elevatorCondition','laundryCondition','trashCondition','exteriorAreas','exteriorCondition','amenities','amenityCondition','parkingType',
      'flooring','floorBuildup','floorStaining','floorSticky','floorPrecautions','entryGlass','commonGlass','mirrors','tracksSills','glassBuildup','glassAccess',
      'touchHandles','touchRailings','touchElevator','touchMail','touchFixtures','touchOther','petHair','petSoiling','residentObstruction','recurringTrash',
      'extraAttention','frequencyObservation','serviceSuitable','laborLevel','recommendedCrew','serviceDuration','materialException'
    ] loop if not answers?required_key or answers->required_key in ('null'::jsonb,'""'::jsonb,'[]'::jsonb) then raise exception 'Required Common Areas answer is missing: %',required_key; end if; end loop;
    if walkthrough.measurements->'floors' is null and (not answers?'floorCount' or jsonb_typeof(answers->'floorCount')<>'number') then raise exception 'Floor count is required'; end if;
    foreach key_name in array array['entry','hallway','stairwell','elevator','laundry','trash'] loop
      if answers->>(key_name||'Condition')<>'Not applicable' then
        for obs_index in 1..case when key_name in ('hallway','laundry') then 6 else 5 end loop
          if nullif(btrim(answers->>(key_name||'Observation'||obs_index)),'') is null then raise exception 'Required % observation is missing',key_name; end if;
        end loop;
      end if;
    end loop;
    if (answers->>'gatedAccess'='Yes' or answers->>'keyFob'='Yes' or answers->>'restrictedAreas'='Yes' or answers->>'parkingRestrictions'='Yes' or answers->>'serviceHourRestrictions'='Yes') and nullif(btrim(answers->>'accessNotes'),'') is null then raise exception 'Access restriction notes are required'; end if;
    if (answers->'flooring'?'Other' or answers->>'floorBuildup'='Yes' or answers->>'floorStaining'='Yes' or answers->>'floorSticky'='Yes' or answers->>'floorPrecautions'='Yes') and nullif(btrim(answers->>'floorNotes'),'') is null then raise exception 'Flooring notes are required'; end if;
    if answers->>'glassAccess'='Yes' and nullif(btrim(answers->>'glassNotes'),'') is null then raise exception 'Glass access notes are required'; end if;
    if answers->>'touchOther'='Yes' and nullif(btrim(answers->>'touchOtherNotes'),'') is null then raise exception 'Other high-touch notes are required'; end if;
    if (answers->>'petSoiling'='Yes' or answers->>'residentObstruction'='Yes' or answers->>'recurringTrash'='Yes') and nullif(btrim(answers->>'residentImpactNotes'),'') is null then raise exception 'Resident impact notes are required'; end if;
    if answers->'extraAttention'?'Other' and nullif(btrim(answers->>'extraAttentionOther'),'') is null then raise exception 'Other extra-attention notes are required'; end if;
    if answers->>'frequencyObservation'<>'Existing/scheduled frequency appears appropriate' and nullif(btrim(answers->>'frequencyNotes'),'') is null then raise exception 'Frequency notes are required'; end if;
    if answers->>'serviceSuitable'='Additional service may be required' and (answers->'recommendedServices' is null or answers->'recommendedServices'='[]'::jsonb) then raise exception 'Recommended service selection is required'; end if;
    if answers->>'serviceSuitable'<>'Yes — Common Area Cleaning appears appropriate' and nullif(btrim(answers->>'serviceNotes'),'') is null then raise exception 'Service suitability notes are required'; end if;
    if answers->>'materialException'='Yes' and nullif(btrim(answers->>'exceptionNotes'),'') is null then raise exception 'Walkthrough exception notes are required'; end if;
    if answers->'technicianConfirmation' is distinct from 'true'::jsonb then raise exception 'Final technician confirmation is required'; end if;
  end if;

  perform public.submit_assigned_field_walkthrough_commercial_phase_20260928(p_id,normalized-'propertyManagementCommonAreasAssessment',p_complete);
  existing:=coalesce(walkthrough.measurements->'propertyManagementCommonAreasAssessment','{}'::jsonb);
  update public.walkthroughs set measurements=jsonb_set(measurements,'{propertyManagementCommonAreasAssessment}',jsonb_set(existing,'{fieldWalkthrough}',field_data,true),true) where id=p_id;
end;
$function$;

revoke all on function public.get_assigned_field_walkthroughs() from public,anon,authenticated;
revoke all on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.get_assigned_field_walkthroughs() to authenticated;
grant execute on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
