-- Structured Porter pricing; review and apply separately.
begin;
alter table public.property_service_plans add column pricing_snapshot jsonb;

create or replace function public.save_property_service_plan(
  p_id uuid, p_plan jsonb, p_areas jsonb, p_expected_updated_at timestamptz default null,
  p_archive boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.property_service_plans;
  v_old public.property_service_plans;
  v_area jsonb;
  v_pricing jsonb;
  v_key text;
  v_area_id uuid;
  v_area_ids uuid[] := '{}';
  v_days smallint[];
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Property Service Plan access denied.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object' or jsonb_typeof(p_areas) is distinct from 'array' then
    raise exception 'Plan and service areas are required.';
  end if;
  if p_id is not null then
    select * into v_old from public.property_service_plans where id = p_id for update;
    if not found then raise exception 'Property Service Plan not found.'; end if;
    if p_expected_updated_at is distinct from v_old.updated_at then
      raise exception 'This plan changed. Refresh and reopen it before saving.' using errcode = '40001';
    end if;
    if v_old.archived_at is not null then raise exception 'Archived plans cannot be edited.'; end if;
  end if;
  -- Older callers preserve pricing when omitted; explicit JSON null clears it.
  v_pricing := case when p_plan ? 'pricing_snapshot' then nullif(p_plan->'pricing_snapshot','null'::jsonb) else v_old.pricing_snapshot end;
  if v_pricing is not null then
    if jsonb_typeof(v_pricing) is distinct from 'object'
      or v_pricing->'version' is distinct from '1'::jsonb
      or jsonb_typeof(v_pricing->'inputs') is distinct from 'object'
      or jsonb_typeof(v_pricing->'calculatedAt') is distinct from 'string' then
      raise exception 'Invalid version 1 Porter pricing snapshot.';
    end if;
    if not isfinite((v_pricing->>'calculatedAt')::timestamptz) then raise exception 'Invalid pricing timestamp.'; end if;
    foreach v_key in array array['laborHoursPerVisit','visitsPerWeek','porterHourlyPay','billedHourlyRate','suppliesMonthly','travelMonthly','supervisionAdminMonthly','complexityAdjustmentMonthly'] loop
      if jsonb_typeof(v_pricing->'inputs'->v_key) is distinct from 'number'
        or (v_pricing->'inputs'->>v_key)::numeric < 0 then raise exception 'Invalid pricing input: %',v_key; end if;
    end loop;
    if (v_pricing->'inputs'->>'laborHoursPerVisit')::numeric <= 0
      or (v_pricing->'inputs'->>'visitsPerWeek')::numeric <= 0
      or (v_pricing->'inputs'->>'visitsPerWeek')::numeric > 7
      or (v_pricing->'inputs'->>'visitsPerWeek')::numeric <> trunc((v_pricing->'inputs'->>'visitsPerWeek')::numeric)
      or (v_pricing->'inputs'->>'billedHourlyRate')::numeric <= 0 then raise exception 'Invalid Porter hours, frequency, or billed rate.'; end if;
    if v_pricing->'inputs' ? 'manualMonthlyPriceOverride' then
      if jsonb_typeof(v_pricing->'inputs'->'manualMonthlyPriceOverride') is distinct from 'number'
        or (v_pricing->'inputs'->>'manualMonthlyPriceOverride')::numeric <= 0 then raise exception 'Invalid monthly price override.'; end if;
    end if;
    foreach v_key in array array['monthlyHours','baseMonthlyPrice','recommendedMonthlyPrice','approvedMonthlyPrice','monthlyLaborCost','monthlyOperatingCosts','projectedGrossProfit','projectedGrossMarginPercent'] loop
      if jsonb_typeof(v_pricing->v_key) is distinct from 'number' then raise exception 'Invalid pricing result: %',v_key; end if;
    end loop;
    if (v_pricing->>'approvedMonthlyPrice')::numeric <= 0 then raise exception 'Approved monthly price must be positive.'; end if;
  end if;
  if jsonb_typeof(p_plan->'service_days') is distinct from 'array' then raise exception 'Service days are required.'; end if;
  select coalesce(array_agg(distinct value::smallint order by value::smallint), '{}'::smallint[])
    into v_days from jsonb_array_elements_text(p_plan->'service_days');
  if cardinality(v_days) <> jsonb_array_length(p_plan->'service_days') then raise exception 'Duplicate service days are not allowed.'; end if;
  if v_pricing is not null and (v_pricing->'inputs'->>'visitsPerWeek')::numeric <> cardinality(v_days) then
    raise exception 'Porter pricing visits per week must match the selected service days.';
  end if;
  if not exists (select 1 from public.properties where id = (p_plan->>'property_id')::uuid
    and client_id = (p_plan->>'client_id')::uuid) then
    raise exception 'Property must belong to the selected client.';
  end if;
  if nullif(p_plan->>'agreement_id','') is not null and not exists (
    select 1 from public.service_agreements where id = (p_plan->>'agreement_id')::uuid
      and property_id = (p_plan->>'property_id')::uuid and client_id = (p_plan->>'client_id')::uuid
  ) then raise exception 'Agreement must belong to the selected property and client.'; end if;

  if p_id is null then
    insert into public.property_service_plans(client_id,property_id,agreement_id,service_id,name,status,start_date,end_date,frequency,service_days,assigned_crew_id,notes,pricing_snapshot)
    values ((p_plan->>'client_id')::uuid,(p_plan->>'property_id')::uuid,nullif(p_plan->>'agreement_id','')::uuid,
      nullif(p_plan->>'service_id','')::uuid,btrim(p_plan->>'name'),p_plan->>'status',(p_plan->>'start_date')::date,
      nullif(p_plan->>'end_date','')::date,p_plan->>'frequency',v_days,nullif(p_plan->>'assigned_crew_id','')::uuid,nullif(btrim(p_plan->>'notes'),''),v_pricing)
    returning * into v_plan;
  else
    update public.property_service_plans set
      client_id=(p_plan->>'client_id')::uuid, property_id=(p_plan->>'property_id')::uuid,
      agreement_id=nullif(p_plan->>'agreement_id','')::uuid, service_id=nullif(p_plan->>'service_id','')::uuid,
      name=btrim(p_plan->>'name'), status=p_plan->>'status', start_date=(p_plan->>'start_date')::date,
      end_date=nullif(p_plan->>'end_date','')::date, frequency=p_plan->>'frequency', service_days=v_days,
      assigned_crew_id=nullif(p_plan->>'assigned_crew_id','')::uuid, notes=nullif(btrim(p_plan->>'notes'),''), pricing_snapshot=v_pricing, updated_at=v_now
    where id=p_id returning * into v_plan;
  end if;
  if p_archive then
    update public.property_service_plans set status='Ended', archived_at=v_now, updated_at=v_now
    where id=v_plan.id returning * into v_plan;
  end if;
  for v_area in select value from jsonb_array_elements(p_areas) loop
    v_area_id := coalesce(nullif(v_area->>'id','')::uuid,gen_random_uuid());
    if v_area_id = any(v_area_ids) then raise exception 'Duplicate service area ID.'; end if;
    v_area_ids := array_append(v_area_ids,v_area_id);
    if exists (select 1 from public.property_service_plan_areas where id=v_area_id and service_plan_id<>v_plan.id) then
      raise exception 'Service area belongs to another plan.';
    end if;
    insert into public.property_service_plan_areas(id,service_plan_id,name,description,sort_order,is_required,requires_photo,active)
    values (v_area_id,v_plan.id,btrim(v_area->>'name'),nullif(btrim(v_area->>'description'),''),(v_area->>'sort_order')::integer,
      (v_area->>'is_required')::boolean,(v_area->>'requires_photo')::boolean,(v_area->>'active')::boolean)
    on conflict (id) do update set name=excluded.name,description=excluded.description,sort_order=excluded.sort_order,
      is_required=excluded.is_required,requires_photo=excluded.requires_photo,active=excluded.active,updated_at=v_now
    where public.property_service_plan_areas.service_plan_id=v_plan.id;
    if not found then raise exception 'Service area belongs to another plan.'; end if;
  end loop;
  -- Omitted areas are retained but deactivated, preserving their durable identity.
  update public.property_service_plan_areas set active=false,updated_at=v_now
    where service_plan_id=v_plan.id and not(id=any(v_area_ids)) and active;
  return to_jsonb(v_plan) || jsonb_build_object('areas',coalesce((select jsonb_agg(to_jsonb(a) order by a.sort_order,a.id)
    from public.property_service_plan_areas a where a.service_plan_id=v_plan.id),'[]'::jsonb));
end;
$$;
revoke all on function public.save_property_service_plan(uuid,jsonb,jsonb,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.save_property_service_plan(uuid,jsonb,jsonb,timestamptz,boolean) to authenticated;
commit;
