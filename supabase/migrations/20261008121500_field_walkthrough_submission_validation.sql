begin;

-- Field walkthrough submissions are complete snapshots. Keep the established
-- service-specific delegation chain authoritative, but reject malformed
-- Move-In / Move-Out array data at the public boundary before a downstream
-- jsonb_array_elements_text call can raise an implementation-level exception.
alter function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
  rename to submit_assigned_field_walkthrough_before_submission_validation_20261008;

revoke all on function public.submit_assigned_field_walkthrough_before_submission_validation_20261008(uuid, jsonb, boolean)
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
  assessment_key text;
  assessment_payload jsonb;
  field_payload jsonb;
  move_assessment jsonb;
  move_field jsonb;
  move_answers jsonb;
  storage_areas jsonb;
begin
  -- Authorization remains independently enforced by the delegated submitter,
  -- but check it before parsing caller-controlled JSON so unauthorized callers
  -- receive only the established assignment error.
  if not public.can_perform_scheduled_walkthrough(p_id) then
    raise exception 'Scheduled assignment no longer available' using errcode = '42501';
  end if;

  if p_measurements is null or jsonb_typeof(p_measurements) <> 'object' then
    raise exception 'Measurements must be an object' using errcode = '22023';
  end if;

  -- Validate container types before the legacy functions use jsonb_object_keys.
  -- PostgreSQL may reorder boolean expressions, so a preceding jsonb_typeof
  -- predicate alone is not a safe guard around a set-returning JSON function.
  foreach assessment_key in array array[
    'postConstructionAssessment',
    'standardResidentialAssessment',
    'deepCleaningAssessment',
    'moveInOutAssessment',
    'commercialJanitorialAssessment',
    'propertyManagementCommonAreasAssessment',
    'officeCleaningAssessment',
    'barbershopSalonAssessment',
    'retailCleaningAssessment',
    'eventVenueCleaningAssessment',
    'warehouseCleaningAssessment',
    'restaurantCleaningAssessment'
  ]
  loop
    if p_measurements ? assessment_key then
      assessment_payload := p_measurements->assessment_key;

      if jsonb_typeof(assessment_payload) <> 'object' then
        raise exception 'Invalid field walkthrough assessment: %', assessment_key using errcode = '22023';
      end if;

      field_payload := assessment_payload->'fieldWalkthrough';

      -- Null is the legacy projection placeholder stripped by the established
      -- normalizing delegation chain.
      if jsonb_typeof(field_payload) is distinct from 'null'
        and (
          jsonb_typeof(field_payload) <> 'object'
          or jsonb_typeof(field_payload->'answers') <> 'object'
        ) then
        raise exception 'Invalid field walkthrough assessment: %', assessment_key using errcode = '22023';
      end if;
    end if;
  end loop;

  if p_measurements ? 'moveInOutAssessment' then
    move_assessment := p_measurements->'moveInOutAssessment';

    move_field := move_assessment->'fieldWalkthrough';

    -- Null is the legacy projection placeholder. The existing delegation chain
    -- removes it before service-specific validation.
    if jsonb_typeof(move_field) is distinct from 'null' then
      move_answers := move_field->'answers';

      if move_answers ? 'storageAreas' then
        storage_areas := move_answers->'storageAreas';

        if jsonb_typeof(storage_areas) not in ('array', 'null') then
          raise exception 'Invalid Move-In / Move-Out selection: storageAreas' using errcode = '22023';
        end if;

        if jsonb_typeof(storage_areas) = 'array'
          and (
            jsonb_array_length(storage_areas) > 20
            or exists (
              select 1
              from jsonb_array_elements(storage_areas) item
              where jsonb_typeof(item) <> 'string'
                or length(item #>> '{}') > 200
            )
          ) then
          raise exception 'Invalid Move-In / Move-Out selection: storageAreas' using errcode = '22023';
        end if;
      end if;
    end if;
  end if;

  perform public.submit_assigned_field_walkthrough_before_submission_validation_20261008(
    p_id,
    p_measurements,
    p_complete
  );
end;
$function$;

revoke all on function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
from public, anon, authenticated;
grant execute on function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
to authenticated;

notify pgrst, 'reload schema';

commit;
