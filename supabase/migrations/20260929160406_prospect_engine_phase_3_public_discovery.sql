begin;

create table public.prospect_discovery_runs (
  id uuid primary key default gen_random_uuid(), request_id uuid not null,
  location_query text not null, latitude double precision, longitude double precision,
  radius_meters integer not null check(radius_meters between 500 and 25000),
  category text not null, keyword text, assigned_user_id uuid references public.user_profiles(id),
  search_key text not null, status text not null default 'Pending' check(status in('Pending','Completed','Failed')),
  provider text not null default 'OpenStreetMap / Overpass', result_count integer not null default 0,
  error_message text, created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(), completed_at timestamptz,
  unique(created_by,request_id)
);

create table public.prospect_discovery_locations (
  location_key text primary key,
  location_query text not null,
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  provider text not null default 'Nominatim',
  resolved_at timestamptz not null default now(),
  resolved_by uuid not null references public.user_profiles(id)
);

create table public.prospect_discovery_entities (
  id uuid primary key default gen_random_uuid(), source_name text not null,
  provider_identifier text not null, source_url text, retrieved_at timestamptz not null,
  license_attribution text not null, category text not null, category_inferred boolean not null default true,
  business_name text not null, address text, city text, state text, zip text,
  business_phone text, business_email text, website text,
  latitude double precision not null, longitude double precision not null,
  confidence_score integer not null check(confidence_score between 0 and 100),
  normalized_source_data jsonb not null,
  unique(source_name,provider_identifier)
);

create table public.prospect_discovery_run_results (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.prospect_discovery_runs(id) on delete restrict,
  entity_id uuid not null references public.prospect_discovery_entities(id) on delete restrict,
  distance_meters integer, selected boolean not null default false,
  duplicate_classification text check(duplicate_classification in('New','Exact duplicate','Possible duplicate')),
  duplicate_decision text check(duplicate_decision in('Skip','Import Separately','Merge')),
  matched_prospect_id uuid references public.prospects(id) on delete restrict,
  imported_prospect_id uuid references public.prospects(id) on delete restrict,
  imported_at timestamptz, imported_by uuid references public.user_profiles(id),
  unique(run_id,entity_id)
);

alter table public.prospect_discovery_runs enable row level security;
alter table public.prospect_discovery_locations enable row level security;
alter table public.prospect_discovery_entities enable row level security;
alter table public.prospect_discovery_run_results enable row level security;
create index prospect_discovery_runs_cache_idx on public.prospect_discovery_runs(search_key,created_at desc) where status='Completed';
create index prospect_discovery_runs_actor_rate_idx on public.prospect_discovery_runs(created_by,created_at desc);
create index prospect_discovery_results_run_idx on public.prospect_discovery_run_results(run_id);

create function public.prospect_discovery_location_key(p_location text)
returns text language sql immutable set search_path='' as $$
  select regexp_replace(
    regexp_replace(lower(btrim(p_location)), '\s*,\s*', ',', 'g'),
    '\s+', ' ', 'g'
  )
$$;

create function public.begin_prospect_discovery(p_request_id uuid,p_location text,p_radius_meters integer,p_category text,p_keyword text,p_assigned_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); management boolean:=public.has_any_role(array['Master Admin','Administrator','Manager']); key text; cached uuid; created uuid;
begin
  if actor is null or not(management or public.has_any_role(array['Sales'])) then raise exception 'Prospect discovery denied.' using errcode='42501'; end if;
  if p_radius_meters not between 500 and 25000 or length(btrim(p_location)) not between 2 and 120 or length(coalesce(p_keyword,''))>80 then raise exception 'Invalid discovery search.'; end if;
  if p_category not in('Property Management / Multifamily','Commercial Offices','Post-Construction / Contractors','Airbnb / Short-Term Rentals','Restaurants / Hospitality','Salons / Barbershops','Gyms / Spas','Recording / Production Facilities','Luxury Property Care','Pressure Washing Opportunities','Other Commercial') then raise exception 'Unsupported discovery category.'; end if;
  if management then
    if p_assigned_user_id is not null and not exists(select 1 from public.user_profiles p where p.id=p_assigned_user_id and p.is_active and p.role='Sales') then raise exception 'Invalid Sales assignee.'; end if;
  elsif p_assigned_user_id is distinct from actor then raise exception 'Sales discoveries must be self-assigned.' using errcode='42501'; end if;
  if (select count(*) from public.prospect_discovery_runs where created_by=actor and created_at>now()-interval '15 minutes')>=5 then raise exception 'Discovery rate limit reached. Try again later.' using errcode='P0001'; end if;
  key:=encode(sha256(convert_to(lower(btrim(p_location))||'|'||p_radius_meters||'|'||p_category||'|'||lower(btrim(coalesce(p_keyword,''))),'UTF8')),'hex');
  select id into cached from public.prospect_discovery_runs where search_key=key and created_by=actor and assigned_user_id is not distinct from p_assigned_user_id and status='Completed' and created_at>now()-interval '15 minutes' order by created_at desc limit 1;
  if cached is not null then return jsonb_build_object('runId',cached,'cached',true); end if;
  perform pg_advisory_xact_lock(867530903);
  if exists(select 1 from public.prospect_discovery_runs where created_at>clock_timestamp()-interval '2 seconds') then raise exception 'Discovery provider is busy. Try again shortly.' using errcode='P0001'; end if;
  insert into public.prospect_discovery_runs(request_id,location_query,radius_meters,category,keyword,assigned_user_id,search_key,created_by) values(p_request_id,btrim(p_location),p_radius_meters,p_category,nullif(btrim(p_keyword),''),p_assigned_user_id,key,actor) on conflict(created_by,request_id) do update set request_id=excluded.request_id returning id into created;
  return jsonb_build_object('runId',created,'cached',false);
end $$;

create function public.get_prospect_discovery_location(p_location text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); cached public.prospect_discovery_locations;
begin
  if actor is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then raise exception 'Prospect discovery denied.' using errcode='42501'; end if;
  if length(btrim(p_location)) not between 2 and 120 then raise exception 'Invalid discovery location.'; end if;
  select * into cached from public.prospect_discovery_locations where location_key=public.prospect_discovery_location_key(p_location);
  if not found then return null; end if;
  return jsonb_build_object('latitude',cached.latitude,'longitude',cached.longitude,'resolvedAt',cached.resolved_at,'provider',cached.provider);
end $$;

create function public.cache_prospect_discovery_location(p_location text,p_latitude double precision,p_longitude double precision)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); normalized text:=public.prospect_discovery_location_key(p_location);
begin
  if actor is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then raise exception 'Prospect discovery denied.' using errcode='42501'; end if;
  if length(normalized) not between 2 and 120 or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'Invalid discovery location result.'; end if;
  insert into public.prospect_discovery_locations(location_key,location_query,latitude,longitude,resolved_by)
  values(normalized,btrim(p_location),p_latitude,p_longitude,actor)
  on conflict(location_key) do nothing;
end $$;

create function public.stage_prospect_discovery(p_run_id uuid,p_latitude double precision,p_longitude double precision,p_results jsonb,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); run public.prospect_discovery_runs; item jsonb; entity uuid;
begin
  if actor is null or jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>150 then raise exception 'Invalid discovery result batch.'; end if;
  select * into run from public.prospect_discovery_runs where id=p_run_id for update;
  if not found or not(public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and run.created_by=actor and run.assigned_user_id=actor)) then raise exception 'Discovery staging denied.' using errcode='42501'; end if;
  if p_error is not null then update public.prospect_discovery_runs set status='Failed',error_message=left(p_error,1000),completed_at=now() where id=p_run_id; return; end if;
  for item in select value from jsonb_array_elements(p_results) loop
    insert into public.prospect_discovery_entities(source_name,provider_identifier,source_url,retrieved_at,license_attribution,category,category_inferred,business_name,address,city,state,zip,business_phone,business_email,website,latitude,longitude,confidence_score,normalized_source_data)
    values('OpenStreetMap',item->>'providerIdentifier',item->>'sourceUrl',coalesce((item->>'retrievedAt')::timestamptz,now()),'© OpenStreetMap contributors · ODbL',run.category,true,item->>'businessName',item->>'address',item->>'city',item->>'state',item->>'zip',item->>'phone',item->>'email',item->>'website',(item->>'latitude')::double precision,(item->>'longitude')::double precision,(item->>'confidenceScore')::integer,item->'normalizedSourceData')
    on conflict(source_name,provider_identifier) do update set source_url=excluded.source_url,retrieved_at=excluded.retrieved_at,category=excluded.category,business_name=excluded.business_name,address=excluded.address,city=excluded.city,state=excluded.state,zip=excluded.zip,business_phone=excluded.business_phone,business_email=excluded.business_email,website=excluded.website,latitude=excluded.latitude,longitude=excluded.longitude,confidence_score=excluded.confidence_score,normalized_source_data=excluded.normalized_source_data returning id into entity;
    insert into public.prospect_discovery_run_results(run_id,entity_id,distance_meters) values(p_run_id,entity,(item->>'distanceMeters')::integer) on conflict(run_id,entity_id) do update set distance_meters=excluded.distance_meters;
  end loop;
  update public.prospect_discovery_runs set latitude=p_latitude,longitude=p_longitude,status='Completed',result_count=(select count(*) from public.prospect_discovery_run_results where run_id=p_run_id),completed_at=now() where id=p_run_id;
end $$;

create function public.get_prospect_discovery_results(p_run_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('resultId',rr.id,'sourceName',e.source_name,'providerIdentifier',e.provider_identifier,'sourceUrl',e.source_url,'retrievedAt',e.retrieved_at,'attribution',e.license_attribution,'category',e.category,'categoryInferred',e.category_inferred,'businessName',e.business_name,'address',e.address,'city',e.city,'state',e.state,'zip',e.zip,'phone',e.business_phone,'email',e.business_email,'website',e.website,'latitude',e.latitude,'longitude',e.longitude,'distanceMeters',rr.distance_meters,'confidenceScore',e.confidence_score,'normalizedSourceData',e.normalized_source_data,'importedProspectId',rr.imported_prospect_id) order by rr.distance_meters nulls last),'[]'::jsonb)
  from public.prospect_discovery_run_results rr join public.prospect_discovery_entities e on e.id=rr.entity_id join public.prospect_discovery_runs r on r.id=rr.run_id
  where rr.run_id=p_run_id and (select auth.uid()) is not null and (public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and r.created_by=(select auth.uid()) and r.assigned_user_id=(select auth.uid())))
$$;

create function public.import_prospect_discovery_results(p_run_id uuid,p_request_id uuid,p_selections jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); run public.prospect_discovery_runs; item jsonb; rr public.prospect_discovery_run_results; e public.prospect_discovery_entities; decision text; client_classification text; authoritative_classification text; authoritative_match uuid; submitted_match uuid; normalized_email text; normalized_phone text; normalized_domain text; normalized_name text; normalized_address text; normalized_zip text; prospect_id uuid; imported integer:=0; skipped integer:=0;
begin
  if actor is null or jsonb_typeof(p_selections)<>'array' or jsonb_array_length(p_selections)>150 then raise exception 'Invalid discovery import.'; end if;
  select * into run from public.prospect_discovery_runs where id=p_run_id for update;
  if not found or not(public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and run.created_by=actor and run.assigned_user_id=actor)) then raise exception 'Discovery import denied.' using errcode='42501'; end if;
  for item in select value from jsonb_array_elements(p_selections) loop
    select result.* into rr from public.prospect_discovery_run_results result where result.id=(item->>'resultId')::uuid and result.run_id=p_run_id for update;
    if not found then raise exception 'Discovery result unavailable.'; end if;
    if rr.imported_prospect_id is not null then imported:=imported+1; continue; end if;
    select * into e from public.prospect_discovery_entities where id=rr.entity_id;
    normalized_email:=nullif(lower(btrim(e.business_email)),'');
    normalized_phone:=public.prospect_phone_normalized(e.business_phone);
    normalized_domain:=public.prospect_domain_normalized(coalesce(e.website,split_part(normalized_email,'@',2)));
    normalized_name:=public.prospect_text_normalized(e.business_name);
    normalized_address:=public.prospect_text_normalized(e.address);
    normalized_zip:=nullif(btrim(e.zip),'');
    authoritative_match:=null; authoritative_classification:='New';
    select p.id,
      case when
        (normalized_email is not null and p.email_normalized=normalized_email)
        or (normalized_phone is not null and p.phone_normalized=normalized_phone)
        or (normalized_domain is not null and p.domain_normalized=normalized_domain)
        or (normalized_name=public.prospect_text_normalized(p.company_name) and (
          (normalized_address is not null and normalized_address=public.prospect_text_normalized(p.address))
          or (normalized_zip is not null and normalized_zip=nullif(btrim(p.zip),''))
        ))
      then 'Exact duplicate' else 'Possible duplicate' end
    into authoritative_match,authoritative_classification
    from public.prospects p
    where p.merged_into_prospect_id is null and (
      (normalized_email is not null and p.email_normalized=normalized_email)
      or (normalized_phone is not null and p.phone_normalized=normalized_phone)
      or (normalized_domain is not null and p.domain_normalized=normalized_domain)
      or (normalized_name=public.prospect_text_normalized(p.company_name) and (
        (normalized_address is not null and normalized_address=public.prospect_text_normalized(p.address))
        or (normalized_zip is not null and normalized_zip=nullif(btrim(p.zip),''))
      ))
      or normalized_name=public.prospect_text_normalized(p.company_name)
      or (normalized_address is not null and normalized_address=public.prospect_text_normalized(p.address))
    )
    order by case when
      (normalized_email is not null and p.email_normalized=normalized_email)
      or (normalized_phone is not null and p.phone_normalized=normalized_phone)
      or (normalized_domain is not null and p.domain_normalized=normalized_domain)
      or (normalized_name=public.prospect_text_normalized(p.company_name) and (
        (normalized_address is not null and normalized_address=public.prospect_text_normalized(p.address))
        or (normalized_zip is not null and normalized_zip=nullif(btrim(p.zip),''))
      )) then 0 else 1 end,
      p.created_at,p.id
    limit 1;
    if not found then authoritative_match:=null; authoritative_classification:='New'; end if;
    client_classification:=item->>'classification'; decision:=item->>'decision'; submitted_match:=nullif(item->>'matchedProspectId','')::uuid;
    if client_classification is distinct from authoritative_classification then raise exception 'Duplicate status changed for %. Review discovery results again before importing.',e.business_name using errcode='40001'; end if;
    if decision not in('Skip','Import Separately','Merge') then raise exception 'Explicit duplicate decision required.'; end if;
    if authoritative_classification='Exact duplicate' and decision='Import Separately' then raise exception 'Exact duplicates must be skipped or merged.'; end if;
    if authoritative_classification='New' and decision='Merge' then raise exception 'A current duplicate match is required to merge.'; end if;
    if decision='Merge' and (authoritative_match is null or submitted_match is distinct from authoritative_match) then raise exception 'Duplicate match changed for %. Review discovery results again before merging.',e.business_name using errcode='40001'; end if;
    if decision='Skip' then update public.prospect_discovery_run_results set selected=true,duplicate_classification=authoritative_classification,duplicate_decision=decision,matched_prospect_id=authoritative_match,imported_by=actor where id=rr.id; skipped:=skipped+1; continue; end if;
    if decision='Merge' then
      prospect_id:=authoritative_match;
      if prospect_id is null or not exists(select 1 from public.prospects p where p.id=prospect_id and p.merged_into_prospect_id is null and (public.has_any_role(array['Master Admin','Administrator','Manager']) or p.assigned_user_id=actor)) then raise exception 'Merge target unavailable.' using errcode='42501'; end if;
      update public.prospects p set business_email=coalesce(nullif(p.business_email,''),e.business_email),business_phone=coalesce(nullif(p.business_phone,''),e.business_phone),website=coalesce(nullif(p.website,''),e.website),address=coalesce(nullif(p.address,''),e.address),city=coalesce(nullif(p.city,''),e.city),state=coalesce(nullif(p.state,''),e.state),zip=coalesce(nullif(p.zip,''),e.zip),industry=coalesce(nullif(p.industry,''),e.category) where p.id=prospect_id;
    else
      insert into public.prospects(company_name,industry,website,business_email,business_phone,address,city,state,zip,source_type,source_url,discovered_at,assigned_user_id,notes) values(e.business_name,e.category,e.website,e.business_email,e.business_phone,e.address,e.city,e.state,e.zip,'OpenStreetMap',e.source_url,e.retrieved_at,run.assigned_user_id,'Public-source discovery; category inferred from OSM tags. '||e.license_attribution) returning id into prospect_id;
    end if;
    update public.prospect_discovery_run_results set selected=true,duplicate_classification=authoritative_classification,duplicate_decision=decision,matched_prospect_id=authoritative_match,imported_prospect_id=prospect_id,imported_at=now(),imported_by=actor where id=rr.id;
    insert into public.prospect_events(prospect_id,event_type,actor_user_id,details) values(prospect_id,'Imported',actor,jsonb_build_object('discoveryRunId',p_run_id,'discoveryResultId',rr.id,'source','OpenStreetMap','providerIdentifier',e.provider_identifier,'requestId',p_request_id)); imported:=imported+1;
  end loop;
  return jsonb_build_object('imported',imported,'skipped',skipped);
end $$;

create policy "Authorized users read discovery runs" on public.prospect_discovery_runs for select to authenticated using(public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and created_by=(select auth.uid()) and assigned_user_id=(select auth.uid())));
create policy "Authorized users read discovery entities" on public.prospect_discovery_entities for select to authenticated using(exists(select 1 from public.prospect_discovery_run_results rr join public.prospect_discovery_runs r on r.id=rr.run_id where rr.entity_id=prospect_discovery_entities.id and (public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and r.created_by=(select auth.uid()) and r.assigned_user_id=(select auth.uid())))));
create policy "Authorized users read discovery results" on public.prospect_discovery_run_results for select to authenticated using(exists(select 1 from public.prospect_discovery_runs r where r.id=run_id and (public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and r.created_by=(select auth.uid()) and r.assigned_user_id=(select auth.uid())))));

revoke all on table public.prospect_discovery_runs,public.prospect_discovery_locations,public.prospect_discovery_entities,public.prospect_discovery_run_results from public,anon,authenticated;
grant select on table public.prospect_discovery_runs,public.prospect_discovery_entities,public.prospect_discovery_run_results to authenticated;
revoke all on function public.prospect_discovery_location_key(text),public.begin_prospect_discovery(uuid,text,integer,text,text,uuid),public.get_prospect_discovery_location(text),public.cache_prospect_discovery_location(text,double precision,double precision),public.stage_prospect_discovery(uuid,double precision,double precision,jsonb,text),public.get_prospect_discovery_results(uuid),public.import_prospect_discovery_results(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.begin_prospect_discovery(uuid,text,integer,text,text,uuid),public.get_prospect_discovery_location(text),public.cache_prospect_discovery_location(text,double precision,double precision),public.stage_prospect_discovery(uuid,double precision,double precision,jsonb,text),public.get_prospect_discovery_results(uuid),public.import_prospect_discovery_results(uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
