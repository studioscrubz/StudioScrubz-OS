begin;

alter function public.get_assigned_field_walkthroughs()
  rename to get_assigned_field_walkthroughs_common_areas_phase_20260928;
revoke all on function public.get_assigned_field_walkthroughs_common_areas_phase_20260928()
from public, anon, authenticated;

create function public.get_assigned_field_walkthroughs()
returns jsonb language sql stable security definer set search_path = '' as $function$
  with projected as (
    select item.value,item.ordinality
    from jsonb_array_elements(public.get_assigned_field_walkthroughs_common_areas_phase_20260928())
      with ordinality as item(value,ordinality)
  )
  select coalesce(jsonb_agg(projected.value || jsonb_build_object(
    'measurements',coalesce(projected.value->'measurements','{}'::jsonb) || jsonb_build_object(
      'officeCleaningAssessment',jsonb_build_object(
        'fieldWalkthrough',walkthrough.measurements->'officeCleaningAssessment'->'fieldWalkthrough'
      )
    )
  ) order by projected.ordinality),'[]'::jsonb)
  from projected
  join public.walkthroughs walkthrough on walkthrough.id=(projected.value->>'id')::uuid;
$function$;

alter function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean)
  rename to submit_assigned_field_walkthrough_common_areas_phase_20260928;
revoke all on function public.submit_assigned_field_walkthrough_common_areas_phase_20260928(uuid,jsonb,boolean)
from public, anon, authenticated;

create function public.submit_assigned_field_walkthrough(p_id uuid,p_measurements jsonb,p_complete boolean default false)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  walkthrough public.walkthroughs; employee uuid:=public.current_employee_id(); normalized jsonb:=p_measurements;
  incoming jsonb; field_data jsonb; answers jsonb; existing jsonb; key_name text; value_json jsonb; required_key text; obs_index integer;
begin
  if jsonb_typeof(normalized#>'{officeCleaningAssessment,fieldWalkthrough}')='null' then normalized:=normalized-'officeCleaningAssessment'; end if;
  if not normalized?'officeCleaningAssessment' then
    perform public.submit_assigned_field_walkthrough_common_areas_phase_20260928(p_id,normalized,p_complete); return;
  end if;
  if (select auth.uid()) is null or employee is null or not public.has_any_role(array['Crew Lead','Scrub Technician']) then raise exception 'Field access denied' using errcode='42501'; end if;
  select * into walkthrough from public.walkthroughs where id=p_id for update;
  if not found or walkthrough.status<>'Scheduled' or walkthrough.archived_at is not null
    or walkthrough.assigned_employee_id is distinct from employee
    or walkthrough.walkthrough_date is null or walkthrough.walkthrough_time is null then raise exception 'Scheduled assignment no longer available'; end if;
  if coalesce(walkthrough.measurements->>'serviceType','')<>'Office Cleaning' then raise exception 'Office observations require COM-OFFICE'; end if;

  incoming:=normalized->'officeCleaningAssessment'; field_data:=incoming->'fieldWalkthrough'; answers:=field_data->'answers';
  if jsonb_typeof(incoming)<>'object' or exists(select 1 from jsonb_object_keys(incoming) key where key<>'fieldWalkthrough')
    or jsonb_typeof(field_data)<>'object' or exists(select 1 from jsonb_object_keys(field_data) key where key<>'answers')
    or jsonb_typeof(answers)<>'object' then raise exception 'Invalid Office Cleaning field walkthrough'; end if;
  for key_name,value_json in select * from jsonb_each(answers) loop
    if not key_name=any(array[
      'officeLayout','officeLayoutOther','occupancy','occupancyLimits','occupancyNotes','overallCondition',
      'workstationCondition','workstationObservation1','workstationObservation2','workstationObservation3','workstationObservation4',
      'conferenceCondition','conferenceObservation1','conferenceObservation2','conferenceObservation3','conferenceObservation4','conferenceObservation5','conferenceObservation6',
      'receptionCondition','receptionObservation1','receptionObservation2','receptionObservation3','receptionObservation4','receptionObservation5',
      'breakroomCondition','breakroomObservation1','breakroomObservation2','breakroomObservation3','breakroomObservation4','breakroomObservation5','breakroomObservation6',
      'restroomCondition','restroomMineral','restroomToilet','restroomFixture','restroomFloor','restroomOdor','mildewLikeBuildup',
      'flooring','floorBuildup','floorStaining','floorSticky','floorPrecautions','floorNotes',
      'entryGlass','officeGlass','conferenceGlass','glassPartitions','mirrors','glassBuildup','glassAccess','glassNotes',
      'trashCondition','deskBins','centralTrash','recyclingStations','secureDisposal','largeReceptacles','highTouchAreas',
      'sensitiveAreas','sensitiveAreaTypes','sensitiveNotes','extraAttention','frequencyObservation','frequencyNotes','serviceSuitable','recommendedServices','serviceNotes',
      'laborLevel','recommendedCrew','serviceDuration','materialException','exceptionNotes','technicianConfirmation'
    ]) then raise exception 'Invalid Office Cleaning answer: %',key_name; end if;
    if jsonb_typeof(value_json)='string' and length(value_json#>>'{}')>5000 then raise exception 'Office Cleaning answer is too long: %',key_name; end if;
    if jsonb_typeof(value_json)='array' and (jsonb_array_length(value_json)>20 or exists(select 1 from jsonb_array_elements(value_json) item where jsonb_typeof(item)<>'string' or length(item#>>'{}')>200)) then raise exception 'Invalid Office Cleaning selection: %',key_name; end if;
    if jsonb_typeof(value_json) not in ('string','array','boolean','null') then raise exception 'Invalid Office Cleaning answer type: %',key_name; end if;
  end loop;

  if p_complete then
    foreach required_key in array array[
      'officeLayout','occupancy','overallCondition','workstationCondition','conferenceCondition','receptionCondition','breakroomCondition',
      'restroomCondition','restroomMineral','restroomToilet','restroomFixture','restroomFloor','restroomOdor','mildewLikeBuildup',
      'flooring','floorBuildup','floorStaining','floorSticky','floorPrecautions','entryGlass','officeGlass','conferenceGlass','glassPartitions','mirrors','glassBuildup','glassAccess',
      'trashCondition','deskBins','centralTrash','recyclingStations','secureDisposal','largeReceptacles','highTouchAreas','sensitiveAreas','extraAttention',
      'frequencyObservation','serviceSuitable','laborLevel','recommendedCrew','serviceDuration','materialException'
    ] loop if not answers?required_key or answers->required_key in ('null'::jsonb,'""'::jsonb,'[]'::jsonb) then raise exception 'Required Office Cleaning answer is missing: %',required_key; end if; end loop;
    foreach key_name in array array['workstation','conference','reception','breakroom'] loop
      if answers->>(key_name||'Condition')<>'Not applicable' then
        for obs_index in 1..case when key_name in ('conference','breakroom') then 6 when key_name='reception' then 5 else 4 end loop
          if nullif(btrim(answers->>(key_name||'Observation'||obs_index)),'') is null then raise exception 'Required % observation is missing',key_name; end if;
        end loop;
      end if;
    end loop;
    if answers->'officeLayout'?'Other' and nullif(btrim(answers->>'officeLayoutOther'),'') is null then raise exception 'Other office-layout notes are required'; end if;
    if answers->>'occupancy'<>'Vacant after hours' and nullif(btrim(answers->>'occupancyLimits'),'') is null then raise exception 'Occupancy limitation answer is required'; end if;
    if answers->>'occupancyLimits'='Yes' and nullif(btrim(answers->>'occupancyNotes'),'') is null then raise exception 'Occupancy limitation notes are required'; end if;
    if (answers->'flooring'?'Other' or answers->>'floorBuildup'='Yes' or answers->>'floorStaining'='Yes' or answers->>'floorSticky'='Yes' or answers->>'floorPrecautions'='Yes') and nullif(btrim(answers->>'floorNotes'),'') is null then raise exception 'Flooring notes are required'; end if;
    if answers->>'glassAccess'='Yes' and nullif(btrim(answers->>'glassNotes'),'') is null then raise exception 'Glass access notes are required'; end if;
    if answers->>'sensitiveAreas'='Yes' and (answers->'sensitiveAreaTypes' is null or answers->'sensitiveAreaTypes'='[]'::jsonb or nullif(btrim(answers->>'sensitiveNotes'),'') is null) then raise exception 'Sensitive-area selections and notes are required'; end if;
    if answers->>'frequencyObservation'<>'Scheduled frequency appears appropriate' and nullif(btrim(answers->>'frequencyNotes'),'') is null then raise exception 'Frequency notes are required'; end if;
    if answers->>'serviceSuitable'='Additional service may be required' and (answers->'recommendedServices' is null or answers->'recommendedServices'='[]'::jsonb) then raise exception 'Recommended service selection is required'; end if;
    if answers->>'serviceSuitable'<>'Yes — Office Cleaning appears appropriate' and nullif(btrim(answers->>'serviceNotes'),'') is null then raise exception 'Service suitability notes are required'; end if;
    if answers->>'materialException'='Yes' and nullif(btrim(answers->>'exceptionNotes'),'') is null then raise exception 'Walkthrough exception notes are required'; end if;
    if answers->'technicianConfirmation' is distinct from 'true'::jsonb then raise exception 'Final technician confirmation is required'; end if;
  end if;

  perform public.submit_assigned_field_walkthrough_common_areas_phase_20260928(p_id,normalized-'officeCleaningAssessment',p_complete);
  existing:=coalesce(walkthrough.measurements->'officeCleaningAssessment','{}'::jsonb);
  update public.walkthroughs set measurements=jsonb_set(measurements,'{officeCleaningAssessment}',jsonb_set(existing,'{fieldWalkthrough}',field_data,true),true) where id=p_id;
end;
$function$;

revoke all on function public.get_assigned_field_walkthroughs() from public,anon,authenticated;
revoke all on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.get_assigned_field_walkthroughs() to authenticated;
grant execute on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
