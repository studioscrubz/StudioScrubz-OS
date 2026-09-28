begin;

alter function public.get_assigned_field_walkthroughs()
  rename to get_assigned_field_walkthroughs_move_phase_20260928;
revoke all on function public.get_assigned_field_walkthroughs_move_phase_20260928()
from public, anon, authenticated;

create function public.get_assigned_field_walkthroughs()
returns jsonb language sql stable security definer set search_path = '' as $function$
  with projected as (
    select item.value, item.ordinality
    from jsonb_array_elements(public.get_assigned_field_walkthroughs_move_phase_20260928())
      with ordinality as item(value, ordinality)
  )
  select coalesce(jsonb_agg(projected.value || jsonb_build_object(
    'measurements', coalesce(projected.value->'measurements','{}'::jsonb) || jsonb_build_object(
      'commercialJanitorialAssessment', jsonb_build_object(
        'fieldWalkthrough', walkthrough.measurements->'commercialJanitorialAssessment'->'fieldWalkthrough'
      )
    )
  ) order by projected.ordinality), '[]'::jsonb)
  from projected
  join public.walkthroughs walkthrough on walkthrough.id=(projected.value->>'id')::uuid;
$function$;

alter function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean)
  rename to submit_assigned_field_walkthrough_move_phase_20260928;
revoke all on function public.submit_assigned_field_walkthrough_move_phase_20260928(uuid,jsonb,boolean)
from public, anon, authenticated;

create function public.submit_assigned_field_walkthrough(p_id uuid,p_measurements jsonb,p_complete boolean default false)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  walkthrough public.walkthroughs; employee uuid:=public.current_employee_id(); normalized jsonb:=p_measurements;
  incoming jsonb; field_data jsonb; answers jsonb; existing jsonb;
  key_name text; value_json jsonb; required_key text;
begin
  if jsonb_typeof(normalized#>'{commercialJanitorialAssessment,fieldWalkthrough}')='null' then normalized:=normalized-'commercialJanitorialAssessment'; end if;
  if not normalized?'commercialJanitorialAssessment' then
    perform public.submit_assigned_field_walkthrough_move_phase_20260928(p_id,normalized,p_complete); return;
  end if;
  if (select auth.uid()) is null or employee is null or not public.has_any_role(array['Crew Lead','Scrub Technician']) then raise exception 'Field access denied' using errcode='42501'; end if;
  select * into walkthrough from public.walkthroughs where id=p_id for update;
  if not found or walkthrough.status<>'Scheduled' or walkthrough.archived_at is not null
    or walkthrough.assigned_employee_id is distinct from employee
    or walkthrough.walkthrough_date is null or walkthrough.walkthrough_time is null then raise exception 'Scheduled assignment no longer available'; end if;
  if not coalesce(walkthrough.measurements->>'serviceType','')=any(array[
    'Office Cleaning','Barbershop / Salon Cleaning','Gym / Spa Cleaning','Restaurant Cleaning','Recording Studio Cleaning',
    'Tattoo Shop Cleaning','Warehouse Cleaning','Retail Cleaning','Apartment Building / Complex Cleaning','Event Venue Cleaning','Other Cleaning'
  ]) then raise exception 'Commercial/Janitorial observations require a canonical Commercial service'; end if;

  incoming:=normalized->'commercialJanitorialAssessment'; field_data:=incoming->'fieldWalkthrough'; answers:=field_data->'answers';
  if jsonb_typeof(incoming)<>'object' or exists(select 1 from jsonb_object_keys(incoming) key where key<>'fieldWalkthrough')
    or jsonb_typeof(field_data)<>'object' or exists(select 1 from jsonb_object_keys(field_data) key where key<>'answers')
    or jsonb_typeof(answers)<>'object' then raise exception 'Invalid Commercial/Janitorial field walkthrough'; end if;

  for key_name,value_json in select * from jsonb_each(answers) loop
    if not key_name=any(array[
      'facilityType','facilityTypeOther','operatingStatus','operatingAccessNotes','overallCondition','flooring','flooringOther','floorHeavyBuildup','floorStaining','floorStickyResidue','floorPrecautions','flooringNotes',
      'restroomCount','restroomCondition','restroomMineralBuildup','toiletUrinalDetailing','restroomFixtureBuildup','restroomFloorBuildup','restroomOdor','mildewLikeBuildup',
      'breakroomCondition','breakroomGrease','breakroomSink','breakroomCounters','breakroomCabinets','breakroomAppliances','breakroomTrash',
      'workspaceCondition','workstations','workspaceHighTouch','furnitureCleaning','workspaceDust','workspaceClutter','workspaceAccessNotes',
      'entryCondition','entryGlass','entryFloor','entryHighTouch','entryDebris','entryPresentation','wasteLevel','multipleWastePoints','largeReceptacles','unusualWaste','dumpsterAccess','wasteRestrictions','wasteNotes',
      'interiorGlass','entryGlassBuildup','partitionsMirrors','tracksSills','glassAccessLimits','glassAccessNotes','dustCondition','highSurfaceDust','ventDust','ledgeDust','shelvingDust','equipmentAreaDust',
      'specialPrecautions','specialAreaTypes','specialAreaNotes','keysFob','alarmProcedure','restrictedAreas','elevatorAccess','loadingRestrictions','afterHoursRestrictions','accessSecurityNotes',
      'extraAttention','extraAttentionOther','frequencyObservation','frequencyNotes','serviceSuitable','serviceNotes','laborLevel','recommendedCrew','serviceDuration','materialException','exceptionNotes','technicianConfirmation'
    ]) then raise exception 'Invalid Commercial/Janitorial answer: %',key_name; end if;
    if jsonb_typeof(value_json)='string' and length(value_json#>>'{}')>5000 then raise exception 'Commercial/Janitorial answer is too long: %',key_name; end if;
    if jsonb_typeof(value_json)='array' and (jsonb_array_length(value_json)>20 or exists(select 1 from jsonb_array_elements(value_json) item where jsonb_typeof(item)<>'string' or length(item#>>'{}')>200)) then raise exception 'Invalid Commercial/Janitorial selection: %',key_name; end if;
    if jsonb_typeof(value_json)='number' and (key_name<>'restroomCount' or (value_json#>>'{}')::numeric<0) then raise exception 'Invalid Commercial/Janitorial quantity: %',key_name; end if;
    if jsonb_typeof(value_json) not in ('string','array','number','boolean','null') then raise exception 'Invalid Commercial/Janitorial answer type: %',key_name; end if;
  end loop;

  if p_complete then
    foreach required_key in array array[
      'operatingStatus','overallCondition','flooring','floorHeavyBuildup','floorStaining','floorStickyResidue','floorPrecautions',
      'restroomCondition','restroomMineralBuildup','toiletUrinalDetailing','restroomFixtureBuildup','restroomFloorBuildup','restroomOdor','mildewLikeBuildup',
      'breakroomCondition','workspaceCondition','workstations','workspaceHighTouch','furnitureCleaning','workspaceDust','workspaceClutter','entryCondition',
      'wasteLevel','multipleWastePoints','largeReceptacles','unusualWaste','dumpsterAccess','wasteRestrictions',
      'interiorGlass','entryGlassBuildup','partitionsMirrors','tracksSills','glassAccessLimits','dustCondition','highSurfaceDust','ventDust','ledgeDust','shelvingDust','equipmentAreaDust',
      'specialPrecautions','keysFob','alarmProcedure','restrictedAreas','elevatorAccess','loadingRestrictions','afterHoursRestrictions',
      'extraAttention','frequencyObservation','serviceSuitable','laborLevel','recommendedCrew','serviceDuration','materialException'
    ] loop if not answers?required_key or answers->required_key in ('null'::jsonb,'""'::jsonb,'[]'::jsonb) then raise exception 'Required Commercial/Janitorial answer is missing: %',required_key; end if; end loop;
    if coalesce(walkthrough.measurements->>'serviceType','') in ('Warehouse Cleaning','Event Venue Cleaning','Other Cleaning') and nullif(btrim(answers->>'facilityType'),'') is null then raise exception 'Facility type is required'; end if;
    if answers->>'facilityType'='Other' and nullif(btrim(answers->>'facilityTypeOther'),'') is null then raise exception 'Other facility notes are required'; end if;
    if answers->>'operatingStatus' in ('Occupied during service','Mixed/partial access') and nullif(btrim(answers->>'operatingAccessNotes'),'') is null then raise exception 'Operating access notes are required'; end if;
    if answers->'flooring'?'Other' and nullif(btrim(answers->>'flooringOther'),'') is null then raise exception 'Other flooring description is required'; end if;
    if (answers->>'floorHeavyBuildup'='Yes' or answers->>'floorStaining'='Yes' or answers->>'floorStickyResidue'='Yes' or answers->>'floorPrecautions'='Yes') and nullif(btrim(answers->>'flooringNotes'),'') is null then raise exception 'Flooring notes are required'; end if;
    if walkthrough.measurements->'restrooms' is null and (not answers?'restroomCount' or jsonb_typeof(answers->'restroomCount')<>'number') then raise exception 'Restroom count is required'; end if;
    if answers->>'breakroomCondition'<>'Not present' then foreach required_key in array array['breakroomGrease','breakroomSink','breakroomCounters','breakroomCabinets','breakroomAppliances','breakroomTrash'] loop if nullif(btrim(answers->>required_key),'') is null then raise exception 'Required breakroom answer is missing: %',required_key; end if; end loop; end if;
    if answers->>'entryCondition'<>'Not applicable' then foreach required_key in array array['entryGlass','entryFloor','entryHighTouch','entryDebris','entryPresentation'] loop if nullif(btrim(answers->>required_key),'') is null then raise exception 'Required entry answer is missing: %',required_key; end if; end loop; end if;
    if (answers->>'unusualWaste'='Yes' or answers->>'wasteRestrictions'='Yes') and nullif(btrim(answers->>'wasteNotes'),'') is null then raise exception 'Waste notes are required'; end if;
    if answers->>'workspaceClutter'='Yes' and nullif(btrim(answers->>'workspaceAccessNotes'),'') is null then raise exception 'Workspace access notes are required'; end if;
    if answers->>'glassAccessLimits'='Yes' and nullif(btrim(answers->>'glassAccessNotes'),'') is null then raise exception 'Glass access notes are required'; end if;
    if answers->>'specialPrecautions'='Yes' and (answers->'specialAreaTypes' in ('null'::jsonb,'[]'::jsonb) or nullif(btrim(answers->>'specialAreaNotes'),'') is null) then raise exception 'Specialty-area selections and notes are required'; end if;
    if (answers->>'keysFob'='Yes' or answers->>'alarmProcedure'='Yes' or answers->>'restrictedAreas'='Yes' or answers->>'elevatorAccess'='Yes' or answers->>'loadingRestrictions'='Yes' or answers->>'afterHoursRestrictions'='Yes') and nullif(btrim(answers->>'accessSecurityNotes'),'') is null then raise exception 'Access and security notes are required'; end if;
    if answers->'extraAttention'?'Other' and nullif(btrim(answers->>'extraAttentionOther'),'') is null then raise exception 'Other extra-attention notes are required'; end if;
    if answers->>'frequencyObservation'<>'Existing/scheduled frequency appears appropriate' and nullif(btrim(answers->>'frequencyNotes'),'') is null then raise exception 'Frequency notes are required'; end if;
    if answers->>'serviceSuitable'<>'Yes — scheduled Commercial/Janitorial service appears appropriate' and nullif(btrim(answers->>'serviceNotes'),'') is null then raise exception 'Service suitability notes are required'; end if;
    if answers->>'materialException'='Yes' and nullif(btrim(answers->>'exceptionNotes'),'') is null then raise exception 'Walkthrough exception notes are required'; end if;
    if answers->'technicianConfirmation' is distinct from 'true'::jsonb then raise exception 'Final technician confirmation is required'; end if;
  end if;

  perform public.submit_assigned_field_walkthrough_move_phase_20260928(p_id,normalized-'commercialJanitorialAssessment',p_complete);
  existing:=coalesce(walkthrough.measurements->'commercialJanitorialAssessment','{}'::jsonb);
  update public.walkthroughs set measurements=jsonb_set(measurements,'{commercialJanitorialAssessment}',jsonb_set(existing,'{fieldWalkthrough}',field_data,true),true) where id=p_id;
end;
$function$;

revoke all on function public.get_assigned_field_walkthroughs() from public,anon,authenticated;
revoke all on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.get_assigned_field_walkthroughs() to authenticated;
grant execute on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
