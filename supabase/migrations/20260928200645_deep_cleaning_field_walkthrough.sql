begin;

-- Extend the established technician-safe projection without changing its
-- assignment or Master Admin oversight rules.
alter function public.get_assigned_field_walkthroughs()
  rename to get_assigned_field_walkthroughs_standard_phase_20260928;

revoke all on function public.get_assigned_field_walkthroughs_standard_phase_20260928()
from public, anon, authenticated;

create function public.get_assigned_field_walkthroughs()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with projected as (
    select item.value, item.ordinality
    from jsonb_array_elements(public.get_assigned_field_walkthroughs_standard_phase_20260928())
      with ordinality as item(value, ordinality)
  )
  select coalesce(jsonb_agg(
    projected.value || jsonb_build_object(
      'measurements', coalesce(projected.value->'measurements', '{}'::jsonb)
        || jsonb_build_object(
          'deepCleaningAssessment', jsonb_build_object(
            'fieldWalkthrough', walkthrough.measurements->'deepCleaningAssessment'->'fieldWalkthrough'
          )
        )
    ) order by projected.ordinality
  ), '[]'::jsonb)
  from projected
  join public.walkthroughs walkthrough
    on walkthrough.id = (projected.value->>'id')::uuid;
$function$;

-- Keep the Phase 1 null normalization and assignment-guarded implementation
-- intact. This wrapper validates and merges only Deep Cleaning observations.
alter function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
  rename to submit_assigned_field_walkthrough_standard_phase_20260928;

revoke all on function public.submit_assigned_field_walkthrough_standard_phase_20260928(uuid, jsonb, boolean)
from public, anon, authenticated;

create function public.submit_assigned_field_walkthrough(
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
  employee uuid := public.current_employee_id();
  normalized jsonb := p_measurements;
  incoming_deep jsonb;
  deep_field jsonb;
  deep_answers jsonb;
  existing_deep jsonb;
  key_name text;
  value_json jsonb;
  required_key text;
begin
  if jsonb_typeof(normalized #> '{deepCleaningAssessment,fieldWalkthrough}') = 'null' then
    normalized := normalized - 'deepCleaningAssessment';
  end if;

  if not normalized ? 'deepCleaningAssessment' then
    perform public.submit_assigned_field_walkthrough_standard_phase_20260928(
      p_id, normalized, p_complete
    );
    return;
  end if;

  if (select auth.uid()) is null or employee is null
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
  if coalesce(walkthrough.measurements->>'serviceType', '') <> 'Deep Cleaning' then
    raise exception 'Deep Cleaning observations require a Deep Cleaning walkthrough';
  end if;

  incoming_deep := normalized->'deepCleaningAssessment';
  if jsonb_typeof(incoming_deep) <> 'object'
    or exists(select 1 from jsonb_object_keys(incoming_deep) key where key <> 'fieldWalkthrough') then
    raise exception 'Only the technician Deep Cleaning walkthrough is writable';
  end if;
  deep_field := incoming_deep->'fieldWalkthrough';
  if deep_field is null or jsonb_typeof(deep_field) <> 'object'
    or exists(select 1 from jsonb_object_keys(deep_field) key where key <> 'answers')
    or jsonb_typeof(deep_field->'answers') <> 'object' then
    raise exception 'Invalid Deep Cleaning field walkthrough';
  end if;
  deep_answers := deep_field->'answers';

  for key_name, value_json in select * from jsonb_each(deep_answers) loop
    if not key_name = any(array[
      'occupancy','overallCondition','buildupLevel','buildupAreas','buildupOther',
      'kitchenCondition','heavyGrease','cabinetFronts','backsplashBuildup','applianceExteriors','sinkFixtures','kitchenEdgesCorners',
      'bathroomCondition','soapScum','mineralBuildup','groutTileBuildup','fixtureDetailing','tubShowerDetailing','toiletDetailing','mildewLikeBuildup',
      'trimCondition','trimHandCleaning','trimAreaNotes','flooring','flooringOther','flooringPrecautions','flooringNotes',
      'dustCondition','ventDust','fanDust','highSurfaceDust','blindDetailing','clutterLevel','inaccessibleAreas',
      'petHairLevel','petStaining','petOdor','petsSecured','specialPrecautions','specialSurfaceTypes','specialSurfaceNotes',
      'extraAttention','extraAttentionOther','serviceAppropriate','serviceRecommendationNotes','laborLevel','recommendedCrew',
      'serviceDuration','materialException','exceptionNotes','technicianConfirmation'
    ]) then
      raise exception 'Invalid Deep Cleaning answer: %', key_name;
    end if;
    if jsonb_typeof(value_json) = 'string' and length(value_json#>>'{}') > 5000 then
      raise exception 'Deep Cleaning answer is too long: %', key_name;
    end if;
    if jsonb_typeof(value_json) = 'array' and (
      jsonb_array_length(value_json) > 20
      or exists(select 1 from jsonb_array_elements(value_json) item
        where jsonb_typeof(item) <> 'string' or length(item#>>'{}') > 200)
    ) then
      raise exception 'Invalid Deep Cleaning selection: %', key_name;
    end if;
    if jsonb_typeof(value_json) not in ('string','array','boolean','null') then
      raise exception 'Invalid Deep Cleaning answer type: %', key_name;
    end if;
  end loop;

  if p_complete then
    foreach required_key in array array[
      'occupancy','overallCondition','buildupLevel','buildupAreas','kitchenCondition','heavyGrease','cabinetFronts',
      'backsplashBuildup','applianceExteriors','sinkFixtures','kitchenEdgesCorners','bathroomCondition','soapScum',
      'mineralBuildup','groutTileBuildup','fixtureDetailing','tubShowerDetailing','toiletDetailing','mildewLikeBuildup',
      'trimCondition','trimHandCleaning','flooring','flooringPrecautions','dustCondition','ventDust','fanDust',
      'highSurfaceDust','blindDetailing','clutterLevel','specialPrecautions','extraAttention','serviceAppropriate',
      'laborLevel','recommendedCrew','serviceDuration','materialException'
    ] loop
      if not deep_answers ? required_key
        or deep_answers->required_key in ('null'::jsonb, '""'::jsonb, '[]'::jsonb) then
        raise exception 'Required Deep Cleaning answer is missing: %', required_key;
      end if;
    end loop;
    if walkthrough.measurements->>'pets' is distinct from 'No' then
      foreach required_key in array array['petHairLevel','petStaining','petOdor','petsSecured'] loop
        if nullif(btrim(deep_answers->>required_key), '') is null then
          raise exception 'Required pet-impact answer is missing: %', required_key;
        end if;
      end loop;
    end if;
    if deep_answers->'buildupAreas' ? 'Other' and nullif(btrim(deep_answers->>'buildupOther'), '') is null then raise exception 'Other buildup-area notes are required'; end if;
    if deep_answers->>'trimHandCleaning' = 'Yes' and nullif(btrim(deep_answers->>'trimAreaNotes'), '') is null then raise exception 'Affected trim-area notes are required'; end if;
    if deep_answers->'flooring' ? 'Other' and nullif(btrim(deep_answers->>'flooringOther'), '') is null then raise exception 'Other flooring description is required'; end if;
    if deep_answers->>'flooringPrecautions' = 'Yes' and nullif(btrim(deep_answers->>'flooringNotes'), '') is null then raise exception 'Flooring precaution notes are required'; end if;
    if deep_answers->>'clutterLevel' = 'Areas inaccessible due to belongings' and nullif(btrim(deep_answers->>'inaccessibleAreas'), '') is null then raise exception 'Inaccessible area notes are required'; end if;
    if deep_answers->>'specialPrecautions' = 'Yes' and (deep_answers->'specialSurfaceTypes' in ('null'::jsonb, '[]'::jsonb) or nullif(btrim(deep_answers->>'specialSurfaceNotes'), '') is null) then raise exception 'Special-surface selections and notes are required'; end if;
    if deep_answers->'extraAttention' ? 'Other' and nullif(btrim(deep_answers->>'extraAttentionOther'), '') is null then raise exception 'Other extra-attention notes are required'; end if;
    if deep_answers->>'serviceAppropriate' <> 'Yes' and nullif(btrim(deep_answers->>'serviceRecommendationNotes'), '') is null then raise exception 'Service recommendation notes are required'; end if;
    if deep_answers->>'materialException' = 'Yes' and nullif(btrim(deep_answers->>'exceptionNotes'), '') is null then raise exception 'Walkthrough exception notes are required'; end if;
    if deep_answers->'technicianConfirmation' is distinct from 'true'::jsonb then raise exception 'Final technician confirmation is required'; end if;
  end if;

  perform public.submit_assigned_field_walkthrough_standard_phase_20260928(
    p_id,
    normalized - 'deepCleaningAssessment',
    p_complete
  );

  existing_deep := coalesce(walkthrough.measurements->'deepCleaningAssessment', '{}'::jsonb);
  update public.walkthroughs
  set measurements = jsonb_set(
    measurements,
    '{deepCleaningAssessment}',
    jsonb_set(existing_deep, '{fieldWalkthrough}', deep_field, true),
    true
  )
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
