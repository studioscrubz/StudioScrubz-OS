begin;

alter function public.get_assigned_field_walkthroughs()
  rename to get_assigned_field_walkthroughs_deep_phase_20260928;
revoke all on function public.get_assigned_field_walkthroughs_deep_phase_20260928()
from public, anon, authenticated;

create function public.get_assigned_field_walkthroughs()
returns jsonb language sql stable security definer set search_path = '' as $function$
  with projected as (
    select item.value, item.ordinality
    from jsonb_array_elements(public.get_assigned_field_walkthroughs_deep_phase_20260928())
      with ordinality as item(value, ordinality)
  )
  select coalesce(jsonb_agg(
    projected.value || jsonb_build_object(
      'measurements', coalesce(projected.value->'measurements', '{}'::jsonb)
        || jsonb_build_object('moveInOutAssessment', jsonb_build_object(
          'fieldWalkthrough', walkthrough.measurements->'moveInOutAssessment'->'fieldWalkthrough'
        ))
    ) order by projected.ordinality
  ), '[]'::jsonb)
  from projected
  join public.walkthroughs walkthrough on walkthrough.id = (projected.value->>'id')::uuid;
$function$;

alter function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
  rename to submit_assigned_field_walkthrough_deep_phase_20260928;
revoke all on function public.submit_assigned_field_walkthrough_deep_phase_20260928(uuid, jsonb, boolean)
from public, anon, authenticated;

create function public.submit_assigned_field_walkthrough(
  p_id uuid, p_measurements jsonb, p_complete boolean default false
)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  walkthrough public.walkthroughs;
  employee uuid := public.current_employee_id();
  normalized jsonb := p_measurements;
  incoming_move jsonb; move_field jsonb; move_answers jsonb; existing_move jsonb;
  key_name text; value_json jsonb; required_key text;
begin
  if jsonb_typeof(normalized #> '{moveInOutAssessment,fieldWalkthrough}') = 'null' then
    normalized := normalized - 'moveInOutAssessment';
  end if;
  if not normalized ? 'moveInOutAssessment' then
    perform public.submit_assigned_field_walkthrough_deep_phase_20260928(p_id, normalized, p_complete);
    return;
  end if;

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
  if coalesce(walkthrough.measurements->>'serviceType', '') <> 'Move-In / Move-Out Cleaning' then
    raise exception 'Move-In / Move-Out observations require a Move-In / Move-Out Cleaning walkthrough';
  end if;

  incoming_move := normalized->'moveInOutAssessment';
  if jsonb_typeof(incoming_move) <> 'object'
    or exists(select 1 from jsonb_object_keys(incoming_move) key where key <> 'fieldWalkthrough') then
    raise exception 'Only the technician Move-In / Move-Out walkthrough is writable';
  end if;
  move_field := incoming_move->'fieldWalkthrough';
  if move_field is null or jsonb_typeof(move_field) <> 'object'
    or exists(select 1 from jsonb_object_keys(move_field) key where key <> 'answers')
    or jsonb_typeof(move_field->'answers') <> 'object' then
    raise exception 'Invalid Move-In / Move-Out field walkthrough';
  end if;
  move_answers := move_field->'answers';

  for key_name, value_json in select * from jsonb_each(move_answers) loop
    if not key_name = any(array[
      'propertyReadiness','readinessNotes','overallCondition','belongingsDebrisLevel','personalBelongings','trashDebris','itemsPreventAccess','accessPreventionNotes',
      'kitchenCondition','greaseBuildup','cabinetExteriors','cabinetInteriors','drawerInteriors','backsplash','sinkFixtures','countertops','applianceExteriors',
      'bathroomCondition','soapScum','mineralBuildup','groutTileBuildup','fixtures','tubShower','toilet','vanityInteriors','mildewLikeBuildup',
      'storageAreas','storageBelongings','storageNotes','closetReadiness','closetCondition','closetNotes','flooring','flooringOther','floorHeavyBuildup','floorStaining','floorResidue','floorPrecautions','flooringNotes',
      'wallTrimCondition','baseboardBuildup','doorTrimBuildup','scuffsMarks','adhesiveResidue','unusualResidue','glassBuildup','trackSillBuildup','windowAdhesive','windowResidue','windowAccessLimits','windowAccessNotes',
      'dustDebrisLevel','highSurfaceDust','lowSurfaceDust','constructionDustDebris','constructionDebrisNotes','specialPrecautions','specialSurfaceTypes','specialSurfaceNotes',
      'extraAttention','extraAttentionOther','readinessCheck','readinessCheckNotes','serviceSuitable','serviceSuitabilityNotes','laborLevel','recommendedCrew','serviceDuration','materialException','exceptionNotes','technicianConfirmation'
    ]) then raise exception 'Invalid Move-In / Move-Out answer: %', key_name; end if;
    if jsonb_typeof(value_json) = 'string' and length(value_json#>>'{}') > 5000 then raise exception 'Move-In / Move-Out answer is too long: %', key_name; end if;
    if jsonb_typeof(value_json) = 'array' and (jsonb_array_length(value_json) > 20 or exists(select 1 from jsonb_array_elements(value_json) item where jsonb_typeof(item) <> 'string' or length(item#>>'{}') > 200)) then raise exception 'Invalid Move-In / Move-Out selection: %', key_name; end if;
    if jsonb_typeof(value_json) not in ('string','array','boolean','null') then raise exception 'Invalid Move-In / Move-Out answer type: %', key_name; end if;
  end loop;

  if p_complete then
    foreach required_key in array array[
      'propertyReadiness','overallCondition','belongingsDebrisLevel','personalBelongings','trashDebris','itemsPreventAccess',
      'kitchenCondition','greaseBuildup','cabinetExteriors','cabinetInteriors','drawerInteriors','backsplash','sinkFixtures','countertops','applianceExteriors',
      'bathroomCondition','soapScum','mineralBuildup','groutTileBuildup','fixtures','tubShower','toilet','vanityInteriors','mildewLikeBuildup',
      'storageAreas','closetReadiness','closetCondition','flooring','floorHeavyBuildup','floorStaining','floorResidue','floorPrecautions',
      'wallTrimCondition','baseboardBuildup','doorTrimBuildup','scuffsMarks','adhesiveResidue','unusualResidue',
      'glassBuildup','trackSillBuildup','windowAdhesive','windowResidue','windowAccessLimits',
      'dustDebrisLevel','highSurfaceDust','lowSurfaceDust','constructionDustDebris','specialPrecautions','extraAttention',
      'readinessCheck','serviceSuitable','laborLevel','recommendedCrew','serviceDuration','materialException'
    ] loop
      if not move_answers ? required_key or move_answers->required_key in ('null'::jsonb, '""'::jsonb, '[]'::jsonb) then
        raise exception 'Required Move-In / Move-Out answer is missing: %', required_key;
      end if;
    end loop;
    if move_answers->>'propertyReadiness' <> 'Vacant and ready' and nullif(btrim(move_answers->>'readinessNotes'),'') is null then raise exception 'Property readiness notes are required'; end if;
    if move_answers->>'itemsPreventAccess' = 'Yes' and nullif(btrim(move_answers->>'accessPreventionNotes'),'') is null then raise exception 'Prevented-access notes are required'; end if;
    if exists(select 1 from jsonb_array_elements_text(move_answers->'storageAreas') area where area <> 'None') and nullif(btrim(move_answers->>'storageBelongings'),'') is null then raise exception 'Storage belongings answer is required'; end if;
    if (move_answers->'storageAreas' ? 'Other' or move_answers->>'storageBelongings' = 'Yes') and nullif(btrim(move_answers->>'storageNotes'),'') is null then raise exception 'Storage notes are required'; end if;
    if move_answers->>'closetReadiness' in ('Belongings remain','Inaccessible') and nullif(btrim(move_answers->>'closetNotes'),'') is null then raise exception 'Closet notes are required'; end if;
    if move_answers->'flooring' ? 'Other' and nullif(btrim(move_answers->>'flooringOther'),'') is null then raise exception 'Other flooring description is required'; end if;
    if (move_answers->>'floorHeavyBuildup' = 'Yes' or move_answers->>'floorStaining' = 'Yes' or move_answers->>'floorResidue' = 'Yes' or move_answers->>'floorPrecautions' = 'Yes') and nullif(btrim(move_answers->>'flooringNotes'),'') is null then raise exception 'Flooring notes are required'; end if;
    if move_answers->>'windowAccessLimits' = 'Yes' and nullif(btrim(move_answers->>'windowAccessNotes'),'') is null then raise exception 'Window access notes are required'; end if;
    if move_answers->>'constructionDustDebris' = 'Yes' and nullif(btrim(move_answers->>'constructionDebrisNotes'),'') is null then raise exception 'Construction debris notes are required'; end if;
    if move_answers->>'specialPrecautions' = 'Yes' and (move_answers->'specialSurfaceTypes' in ('null'::jsonb,'[]'::jsonb) or nullif(btrim(move_answers->>'specialSurfaceNotes'),'') is null) then raise exception 'Special-surface selections and notes are required'; end if;
    if move_answers->'extraAttention' ? 'Other' and nullif(btrim(move_answers->>'extraAttentionOther'),'') is null then raise exception 'Other extra-attention notes are required'; end if;
    if move_answers->>'readinessCheck' <> 'Yes' and nullif(btrim(move_answers->>'readinessCheckNotes'),'') is null then raise exception 'Readiness check notes are required'; end if;
    if move_answers->>'serviceSuitable' <> 'Yes' and nullif(btrim(move_answers->>'serviceSuitabilityNotes'),'') is null then raise exception 'Service suitability notes are required'; end if;
    if move_answers->>'materialException' = 'Yes' and nullif(btrim(move_answers->>'exceptionNotes'),'') is null then raise exception 'Walkthrough exception notes are required'; end if;
    if move_answers->'technicianConfirmation' is distinct from 'true'::jsonb then raise exception 'Final technician confirmation is required'; end if;
  end if;

  perform public.submit_assigned_field_walkthrough_deep_phase_20260928(p_id, normalized - 'moveInOutAssessment', p_complete);
  existing_move := coalesce(walkthrough.measurements->'moveInOutAssessment', '{}'::jsonb);
  update public.walkthroughs set measurements = jsonb_set(
    measurements, '{moveInOutAssessment}', jsonb_set(existing_move, '{fieldWalkthrough}', move_field, true), true
  ) where id = p_id;
end;
$function$;

revoke all on function public.get_assigned_field_walkthroughs() from public, anon, authenticated;
revoke all on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.get_assigned_field_walkthroughs() to authenticated;
grant execute on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
