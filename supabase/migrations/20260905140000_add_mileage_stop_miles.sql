alter table public.mileage_stops
add column miles_from_previous numeric null
check (miles_from_previous >= 0);

create or replace function public.save_mileage_entry_with_stops(
  p_entry_id uuid,
  p_entry jsonb,
  p_stops jsonb
)
returns public.mileage_entries
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry public.mileage_entries;
  v_stop jsonb;
  v_order integer;
  v_job_id uuid;
  v_property_id uuid;
  v_has_allocations boolean;
  v_has_incomplete_legs boolean;
  v_total_miles numeric;
  v_deductible_amount numeric;
begin
  if not public.has_role('Master Admin') then
    raise exception 'Mileage management denied';
  end if;

  if jsonb_typeof(p_stops) <> 'array' then
    raise exception 'Mileage stops must be an array.';
  end if;

  select
    coalesce(bool_or(nullif(value->>'miles_from_previous', '') is not null) filter (where ordinality > 1), false),
    coalesce(bool_or(nullif(value->>'miles_from_previous', '') is null) filter (where ordinality > 1), false),
    coalesce(sum(nullif(value->>'miles_from_previous', '')::numeric) filter (where ordinality > 1), 0)
  into v_has_allocations, v_has_incomplete_legs, v_total_miles
  from jsonb_array_elements(p_stops) with ordinality;

  if coalesce(nullif(p_stops->0->>'miles_from_previous', '')::numeric, 0) <> 0 then
    raise exception 'The origin stop cannot have miles from a previous stop.';
  end if;
  if v_has_allocations and v_has_incomplete_legs then
    raise exception 'Enter mileage for every non-origin route leg.';
  end if;
  if v_total_miles < 0 then raise exception 'Mileage stop miles cannot be negative.'; end if;

  if not v_has_allocations then v_total_miles := (p_entry->>'miles')::numeric; end if;
  v_deductible_amount := round(v_total_miles * greatest(coalesce(nullif(p_entry->>'mileage_rate', '')::numeric, 0), 0), 2);

  if p_entry_id is null then
    insert into public.mileage_entries (
      mileage_number, trip_date, vehicle_id, employee_id, crew_id, job_id, client_id,
      property_id, trip_purpose, start_location, end_location, start_odometer,
      end_odometer, miles, round_trip, business_use, mileage_rate,
      deductible_amount, notes
    ) values (
      p_entry->>'mileage_number', (p_entry->>'trip_date')::date,
      nullif(p_entry->>'vehicle_id', '')::uuid, nullif(p_entry->>'employee_id', '')::uuid,
      nullif(p_entry->>'crew_id', '')::uuid, nullif(p_entry->>'job_id', '')::uuid,
      nullif(p_entry->>'client_id', '')::uuid, nullif(p_entry->>'property_id', '')::uuid,
      p_entry->>'trip_purpose', nullif(p_entry->>'start_location', ''),
      nullif(p_entry->>'end_location', ''), nullif(p_entry->>'start_odometer', '')::numeric,
      nullif(p_entry->>'end_odometer', '')::numeric, v_total_miles,
      coalesce((p_entry->>'round_trip')::boolean, false),
      coalesce((p_entry->>'business_use')::boolean, true),
      nullif(p_entry->>'mileage_rate', '')::numeric,
      v_deductible_amount, nullif(p_entry->>'notes', '')
    ) returning * into v_entry;
  else
    update public.mileage_entries set
      trip_date = (p_entry->>'trip_date')::date,
      vehicle_id = nullif(p_entry->>'vehicle_id', '')::uuid,
      employee_id = nullif(p_entry->>'employee_id', '')::uuid,
      crew_id = nullif(p_entry->>'crew_id', '')::uuid,
      job_id = nullif(p_entry->>'job_id', '')::uuid,
      client_id = nullif(p_entry->>'client_id', '')::uuid,
      property_id = nullif(p_entry->>'property_id', '')::uuid,
      trip_purpose = p_entry->>'trip_purpose',
      start_location = nullif(p_entry->>'start_location', ''),
      end_location = nullif(p_entry->>'end_location', ''),
      start_odometer = nullif(p_entry->>'start_odometer', '')::numeric,
      end_odometer = nullif(p_entry->>'end_odometer', '')::numeric,
      miles = v_total_miles,
      round_trip = coalesce((p_entry->>'round_trip')::boolean, false),
      business_use = coalesce((p_entry->>'business_use')::boolean, true),
      mileage_rate = nullif(p_entry->>'mileage_rate', '')::numeric,
      deductible_amount = v_deductible_amount,
      notes = nullif(p_entry->>'notes', '')
    where id = p_entry_id
    returning * into v_entry;
    if v_entry.id is null then raise exception 'Mileage entry not found or inaccessible.'; end if;
    delete from public.mileage_stops where mileage_entry_id = p_entry_id;
  end if;

  v_order := 0;
  for v_stop in select value from jsonb_array_elements(p_stops)
  loop
    if btrim(coalesce(v_stop->>'address', '')) = '' then raise exception 'Every mileage stop requires an address.'; end if;
    if nullif(v_stop->>'miles_from_previous', '')::numeric < 0 then raise exception 'Mileage stop miles cannot be negative.'; end if;
    v_job_id := nullif(v_stop->>'job_id', '')::uuid;
    v_property_id := nullif(v_stop->>'property_id', '')::uuid;
    insert into public.mileage_stops (mileage_entry_id, stop_order, job_id, property_id, address, label, miles_from_previous)
    values (v_entry.id, v_order, v_job_id, v_property_id, btrim(v_stop->>'address'), nullif(btrim(v_stop->>'label'), ''), case when v_order = 0 then null else nullif(v_stop->>'miles_from_previous', '')::numeric end);
    v_order := v_order + 1;
  end loop;

  return v_entry;
end;
$$;

revoke all on function public.save_mileage_entry_with_stops(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_mileage_entry_with_stops(uuid, jsonb, jsonb) to authenticated;
