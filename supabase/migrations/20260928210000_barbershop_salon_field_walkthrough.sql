begin;
alter function public.get_assigned_field_walkthroughs() rename to get_assigned_field_walkthroughs_office_phase_20260928;
revoke all on function public.get_assigned_field_walkthroughs_office_phase_20260928() from public,anon,authenticated;
create function public.get_assigned_field_walkthroughs() returns jsonb language sql stable security definer set search_path='' as $function$
with projected as(select item.value,item.ordinality from jsonb_array_elements(public.get_assigned_field_walkthroughs_office_phase_20260928()) with ordinality as item(value,ordinality))
select coalesce(jsonb_agg(projected.value||jsonb_build_object('measurements',coalesce(projected.value->'measurements','{}'::jsonb)||jsonb_build_object('barbershopSalonAssessment',jsonb_build_object('fieldWalkthrough',w.measurements->'barbershopSalonAssessment'->'fieldWalkthrough'))) order by projected.ordinality),'[]'::jsonb)
from projected join public.walkthroughs w on w.id=(projected.value->>'id')::uuid;
$function$;

alter function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) rename to submit_assigned_field_walkthrough_office_phase_20260928;
revoke all on function public.submit_assigned_field_walkthrough_office_phase_20260928(uuid,jsonb,boolean) from public,anon,authenticated;
create function public.submit_assigned_field_walkthrough(p_id uuid,p_measurements jsonb,p_complete boolean default false) returns void language plpgsql security definer set search_path='' as $function$
declare w public.walkthroughs; employee uuid:=public.current_employee_id(); normalized jsonb:=p_measurements; incoming jsonb; field_data jsonb; answers jsonb; existing jsonb; k text; v jsonb; required_key text; obs integer;
begin
 if jsonb_typeof(normalized#>'{barbershopSalonAssessment,fieldWalkthrough}')='null' then normalized:=normalized-'barbershopSalonAssessment'; end if;
 if not normalized?'barbershopSalonAssessment' then perform public.submit_assigned_field_walkthrough_office_phase_20260928(p_id,normalized,p_complete);return;end if;
 if (select auth.uid()) is null or employee is null or not public.has_any_role(array['Crew Lead','Scrub Technician']) then raise exception 'Field access denied' using errcode='42501';end if;
 select * into w from public.walkthroughs where id=p_id for update;
 if not found or w.status<>'Scheduled' or w.archived_at is not null or w.assigned_employee_id is distinct from employee or w.walkthrough_date is null or w.walkthrough_time is null then raise exception 'Scheduled assignment no longer available';end if;
 if coalesce(w.measurements->>'serviceType','')<>'Barbershop / Salon Cleaning' then raise exception 'Barbershop/Salon observations require COM-BARBER';end if;
 incoming:=normalized->'barbershopSalonAssessment';field_data:=incoming->'fieldWalkthrough';answers:=field_data->'answers';
 if jsonb_typeof(incoming)<>'object' or exists(select 1 from jsonb_object_keys(incoming) x where x<>'fieldWalkthrough') or jsonb_typeof(field_data)<>'object' or exists(select 1 from jsonb_object_keys(field_data) x where x<>'answers') or jsonb_typeof(answers)<>'object' then raise exception 'Invalid Barbershop/Salon field walkthrough';end if;
 for k,v in select * from jsonb_each(answers) loop
  if not k=any(array['facilityType','facilityTypeOther','operatingStatus','occupancyLimits','occupancyNotes','overallCondition','stationCount','stationCondition','stationHair','stationProduct','stationSurface','stationChair','stationClutter','stationTools','floorTypes','floorCondition','floorHair','floorStationHair','floorResidue','floorStaining','floorPrecautions','floorNotes','stationMirrors','entryGlass','interiorGlass','glassResidue','glassSmudging','glassAccess','glassNotes','shampooCondition','shampooObservation1','shampooObservation2','shampooObservation3','shampooObservation4','shampooObservation5','shampooObservation6','retailCondition','retailObservation1','retailObservation2','retailObservation3','retailObservation4','receptionCondition','receptionObservation1','receptionObservation2','receptionObservation3','receptionObservation4','receptionObservation5','receptionObservation6','restroomCondition','restroomObservation1','restroomObservation2','restroomObservation3','restroomObservation4','restroomObservation5','restroomObservation6','breakroomCondition','breakroomObservation1','breakroomObservation2','breakroomObservation3','breakroomObservation4','breakroomObservation5','breakroomObservation6','laundryCondition','laundryObservation1','laundryObservation2','laundryObservation3','laundryObservation4','laundryObservation5','wasteCondition','hairWaste','multipleReceptacles','productContainers','sharpWaste','restrictedWaste','wasteNotes','highTouchAreas','specialPrecautions','precautionTypes','precautionNotes','extraAttention','frequencyObservation','frequencyNotes','serviceSuitable','recommendedServices','serviceNotes','laborLevel','recommendedCrew','serviceDuration','materialException','exceptionNotes','technicianConfirmation']) then raise exception 'Invalid Barbershop/Salon answer: %',k;end if;
  if jsonb_typeof(v)='string' and length(v#>>'{}')>5000 then raise exception 'Barbershop/Salon answer is too long: %',k;end if;
  if jsonb_typeof(v)='array' and (jsonb_array_length(v)>20 or exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>200)) then raise exception 'Invalid Barbershop/Salon selection: %',k;end if;
  if jsonb_typeof(v)='number' and (k<>'stationCount' or (v#>>'{}')::numeric<0) then raise exception 'Invalid station count';end if;
  if jsonb_typeof(v) not in('string','array','number','boolean','null') then raise exception 'Invalid Barbershop/Salon answer type: %',k;end if;
 end loop;
 if p_complete then
  foreach required_key in array array['facilityType','operatingStatus','overallCondition','stationCount','stationCondition','stationHair','stationProduct','stationSurface','stationChair','stationClutter','stationTools','floorTypes','floorCondition','floorHair','floorStationHair','floorResidue','floorStaining','floorPrecautions','stationMirrors','entryGlass','interiorGlass','glassResidue','glassSmudging','glassAccess','shampooCondition','retailCondition','receptionCondition','restroomCondition','breakroomCondition','laundryCondition','wasteCondition','hairWaste','multipleReceptacles','productContainers','sharpWaste','restrictedWaste','highTouchAreas','specialPrecautions','extraAttention','frequencyObservation','serviceSuitable','laborLevel','recommendedCrew','serviceDuration','materialException'] loop if not answers?required_key or answers->required_key in('null'::jsonb,'""'::jsonb,'[]'::jsonb) then raise exception 'Required Barbershop/Salon answer is missing: %',required_key;end if;end loop;
  foreach k in array array['shampoo','retail','reception','restroom','breakroom','laundry'] loop if answers->>(k||'Condition')<>'Not applicable' then for obs in 1..case when k='retail' then 4 when k='laundry' then 5 else 6 end loop if nullif(btrim(answers->>(k||'Observation'||obs)),'') is null then raise exception 'Required % observation is missing',k;end if;end loop;end if;end loop;
  if answers->>'facilityType'='Other' and nullif(btrim(answers->>'facilityTypeOther'),'') is null then raise exception 'Other facility notes are required';end if;
  if answers->>'operatingStatus'<>'Closed/vacant' and nullif(btrim(answers->>'occupancyLimits'),'') is null then raise exception 'Occupancy limitation answer is required';end if;
  if answers->>'occupancyLimits'='Yes' and nullif(btrim(answers->>'occupancyNotes'),'') is null then raise exception 'Occupancy limitation notes are required';end if;
  if (answers->'floorTypes'?'Other' or answers->>'floorHair'='Yes' or answers->>'floorStationHair'='Yes' or answers->>'floorResidue'='Yes' or answers->>'floorStaining'='Yes' or answers->>'floorPrecautions'='Yes') and nullif(btrim(answers->>'floorNotes'),'') is null then raise exception 'Floor notes are required';end if;
  if answers->>'glassAccess'='Yes' and nullif(btrim(answers->>'glassNotes'),'') is null then raise exception 'Glass access notes are required';end if;
  if (answers->>'sharpWaste'='Yes' or answers->>'restrictedWaste'='Yes') and nullif(btrim(answers->>'wasteNotes'),'') is null then raise exception 'Restricted waste notes are required';end if;
  if answers->>'specialPrecautions'='Yes' and (answers->'precautionTypes' is null or answers->'precautionTypes'='[]'::jsonb or nullif(btrim(answers->>'precautionNotes'),'') is null) then raise exception 'Precaution selections and notes are required';end if;
  if answers->>'frequencyObservation'<>'Scheduled frequency appears appropriate' and nullif(btrim(answers->>'frequencyNotes'),'') is null then raise exception 'Frequency notes are required';end if;
  if answers->>'serviceSuitable'='Additional service may be required' and (answers->'recommendedServices' is null or answers->'recommendedServices'='[]'::jsonb) then raise exception 'Recommended services are required';end if;
  if answers->>'serviceSuitable'<>'Yes — Barbershop/Salon Cleaning appears appropriate' and nullif(btrim(answers->>'serviceNotes'),'') is null then raise exception 'Service notes are required';end if;
  if answers->>'materialException'='Yes' and nullif(btrim(answers->>'exceptionNotes'),'') is null then raise exception 'Exception notes are required';end if;
  if answers->'technicianConfirmation' is distinct from 'true'::jsonb then raise exception 'Final technician confirmation is required';end if;
 end if;
 perform public.submit_assigned_field_walkthrough_office_phase_20260928(p_id,normalized-'barbershopSalonAssessment',p_complete);
 existing:=coalesce(w.measurements->'barbershopSalonAssessment','{}'::jsonb);
 update public.walkthroughs set measurements=jsonb_set(measurements,'{barbershopSalonAssessment}',jsonb_set(existing,'{fieldWalkthrough}',field_data,true),true) where id=p_id;
end;$function$;
revoke all on function public.get_assigned_field_walkthroughs() from public,anon,authenticated;
revoke all on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.get_assigned_field_walkthroughs() to authenticated;
grant execute on function public.submit_assigned_field_walkthrough(uuid,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';commit;
