create table public.mileage_stops (
  id uuid primary key default gen_random_uuid(),
  mileage_entry_id uuid not null references public.mileage_entries(id) on delete cascade,
  stop_order integer not null check (stop_order >= 0),
  job_id uuid null references public.jobs(id) on delete set null,
  property_id uuid null references public.properties(id) on delete set null,
  address text not null check (btrim(address) <> ''),
  label text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mileage_entry_id, stop_order)
);

create index mileage_stops_entry_order_idx on public.mileage_stops(mileage_entry_id, stop_order);
create index mileage_stops_job_id_idx on public.mileage_stops(job_id) where job_id is not null;
create index mileage_stops_property_id_idx on public.mileage_stops(property_id) where property_id is not null;

create trigger set_mileage_stops_updated_at
before update on public.mileage_stops
for each row execute function public.set_updated_at();

alter table public.mileage_stops enable row level security;
revoke all on public.mileage_stops from anon;
grant select, insert, update, delete on public.mileage_stops to authenticated;

create policy "Mileage stops follow mileage entry read access"
on public.mileage_stops for select to authenticated
using (public.has_role('Master Admin'));

create policy "Mileage stops follow mileage entry insert access"
on public.mileage_stops for insert to authenticated
with check (public.has_role('Master Admin'));

create policy "Mileage stops follow mileage entry update access"
on public.mileage_stops for update to authenticated
using (public.has_role('Master Admin'))
with check (public.has_role('Master Admin'));

create policy "Mileage stops follow mileage entry delete access"
on public.mileage_stops for delete to authenticated
using (public.has_role('Master Admin'));

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
begin
  if not public.has_role('Master Admin') then
    raise exception 'Mileage management denied';
  end if;

  if jsonb_typeof(p_stops) <> 'array' then
    raise exception 'Mileage stops must be an array.';
  end if;

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
      nullif(p_entry->>'end_odometer', '')::numeric, (p_entry->>'miles')::numeric,
      coalesce((p_entry->>'round_trip')::boolean, false),
      coalesce((p_entry->>'business_use')::boolean, true),
      nullif(p_entry->>'mileage_rate', '')::numeric,
      (p_entry->>'deductible_amount')::numeric, nullif(p_entry->>'notes', '')
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
      miles = (p_entry->>'miles')::numeric,
      round_trip = coalesce((p_entry->>'round_trip')::boolean, false),
      business_use = coalesce((p_entry->>'business_use')::boolean, true),
      mileage_rate = nullif(p_entry->>'mileage_rate', '')::numeric,
      deductible_amount = (p_entry->>'deductible_amount')::numeric,
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
    v_job_id := nullif(v_stop->>'job_id', '')::uuid;
    v_property_id := nullif(v_stop->>'property_id', '')::uuid;
    insert into public.mileage_stops (mileage_entry_id, stop_order, job_id, property_id, address, label)
    values (v_entry.id, v_order, v_job_id, v_property_id, btrim(v_stop->>'address'), nullif(btrim(v_stop->>'label'), ''));
    v_order := v_order + 1;
  end loop;

  return v_entry;
end;
$$;

revoke all on function public.save_mileage_entry_with_stops(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_mileage_entry_with_stops(uuid, jsonb, jsonb) to authenticated;
