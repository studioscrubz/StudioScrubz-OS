begin;

-- Return the existing technician-safe projection. Master Admin may use the
-- same read-only UI to review every scheduled, assigned walkthrough.
create or replace function public.get_assigned_field_walkthroughs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  employee uuid := public.current_employee_id();
  master_admin boolean := public.is_master_admin();
begin
  if (select auth.uid()) is null or (
    not master_admin and (
      employee is null
      or not public.has_any_role(array['Crew Lead', 'Scrub Technician'])
    )
  ) then
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
      'customerProperty', concat_ws(' - ', coalesce(c.company_name, nullif(concat_ws(' ', c.first_name, c.last_name), '')), concat_ws(', ', p.property_name, p.address, p.city, p.state, p.zip)),
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
  where w.assigned_employee_id is not null
    and (master_admin or w.assigned_employee_id = employee)
    and w.status = 'Scheduled'
    and w.archived_at is null
    and w.walkthrough_date is not null
    and w.walkthrough_time is not null;

  return result;
end;
$function$;

-- Preserve the existing authorization, row lock, assignment check, field
-- whitelist, completion validation, and update behavior behind a narrow
-- normalizing wrapper. The projection represents an unused questionnaire as
-- {"fieldWalkthrough": null}; remove only that placeholder before validation.
alter function public.submit_assigned_field_walkthrough(uuid, jsonb, boolean)
  rename to submit_assigned_field_walkthrough_assignment_guarded_20260928;

revoke all on function public.submit_assigned_field_walkthrough_assignment_guarded_20260928(uuid, jsonb, boolean)
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
  normalized jsonb := p_measurements;
begin
  if jsonb_typeof(normalized #> '{postConstructionAssessment,fieldWalkthrough}') = 'null' then
    normalized := normalized - 'postConstructionAssessment';
  end if;
  if jsonb_typeof(normalized #> '{standardResidentialAssessment,fieldWalkthrough}') = 'null' then
    normalized := normalized - 'standardResidentialAssessment';
  end if;

  perform public.submit_assigned_field_walkthrough_assignment_guarded_20260928(
    p_id,
    normalized,
    p_complete
  );
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
