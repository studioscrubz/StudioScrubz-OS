begin;

create table public.prospect_enrichment_runs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  discovery_run_id uuid not null references public.prospect_discovery_runs(id) on delete restrict,
  status text not null default 'Pending' check (status in ('Pending','Completed','Partial','Failed')),
  total_items integer not null default 0 check (total_items between 0 and 10),
  completed_items integer not null default 0,
  partial_items integer not null default 0,
  no_data_items integer not null default 0,
  failed_items integer not null default 0,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(created_by,request_id)
);

create table public.prospect_enrichment_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.prospect_enrichment_runs(id) on delete restrict,
  discovery_result_id uuid not null references public.prospect_discovery_run_results(id) on delete restrict,
  status text not null default 'Pending' check (status in ('Pending','In Progress','Complete','Partially Enriched','No Additional Data Found','Failed')),
  input_snapshot jsonb not null default '{}'::jsonb,
  official_website_url text,
  canonical_domain text,
  cache_key text,
  attempt_count integer not null default 0 check(attempt_count between 0 and 3),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  unique(run_id,discovery_result_id)
);

create table public.prospect_enrichment_fields (
  id uuid primary key default gen_random_uuid(),
  enrichment_item_id uuid not null references public.prospect_enrichment_items(id) on delete restrict,
  field_name text not null check(field_name in ('website','business_email','business_phone','address','city','state','zip','contact_page_url','contact_name','contact_title')),
  candidate_value text not null check(length(btrim(candidate_value)) between 1 and 2000),
  normalized_value text,
  source_type text not null check(source_type in ('OpenStreetMap','Official Website')),
  source_url text not null check(source_url ~ '^https://'),
  source_page_type text not null check(source_page_type in ('OSM','Homepage','Contact','About','Team','Staff','Management','Locations','Structured Data')),
  confidence integer not null check(confidence between 0 and 100),
  retrieved_at timestamptz not null default now(),
  decision text not null default 'Pending' check(decision in ('Pending','Accepted','Rejected')),
  decided_by uuid references public.user_profiles(id),
  decided_at timestamptz,
  candidate_fingerprint text not null,
  unique(enrichment_item_id,candidate_fingerprint)
);

create table public.prospect_enrichment_cache (
  cache_key text primary key,
  canonical_url text not null check(canonical_url ~ '^https://'),
  canonical_domain text not null,
  provider_version text not null,
  status text not null check(status in ('Complete','Partially Enriched','No Additional Data Found','Failed')),
  result_snapshot jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  failure_code text
);

alter table public.prospect_enrichment_runs enable row level security;
alter table public.prospect_enrichment_items enable row level security;
alter table public.prospect_enrichment_fields enable row level security;
alter table public.prospect_enrichment_cache enable row level security;

create index prospect_enrichment_runs_actor_idx on public.prospect_enrichment_runs(created_by,created_at desc);
create index prospect_enrichment_items_run_idx on public.prospect_enrichment_items(run_id);
create index prospect_enrichment_fields_item_idx on public.prospect_enrichment_fields(enrichment_item_id);
create index prospect_enrichment_cache_expiry_idx on public.prospect_enrichment_cache(expires_at);

create function public.begin_prospect_enrichment(p_request_id uuid,p_discovery_run_id uuid,p_result_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); discovery public.prospect_discovery_runs; existing uuid; created uuid; rid uuid;
begin
  if actor is null or cardinality(p_result_ids) not between 1 and 10 then raise exception 'Invalid enrichment request.'; end if;
  select * into discovery from public.prospect_discovery_runs where id=p_discovery_run_id;
  if not found or not(public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and discovery.created_by=actor and discovery.assigned_user_id=actor)) then raise exception 'Prospect enrichment denied.' using errcode='42501'; end if;
  if (select count(*) from public.prospect_enrichment_runs where created_by=actor and created_at>now()-interval '15 minutes')>=3
     or (select coalesce(sum(total_items),0) from public.prospect_enrichment_runs where created_by=actor and created_at>now()-interval '15 minutes')+cardinality(p_result_ids)>30 then
    raise exception 'Enrichment rate limit reached. Try again later.' using errcode='P0001';
  end if;
  select id into existing from public.prospect_enrichment_runs where created_by=actor and request_id=p_request_id;
  if existing is not null then return jsonb_build_object('runId',existing,'cached',true); end if;
  if exists(select 1 from unnest(p_result_ids) x(id) left join public.prospect_discovery_run_results rr on rr.id=x.id and rr.run_id=p_discovery_run_id where rr.id is null or rr.imported_prospect_id is not null) then raise exception 'Enrichment result unavailable.'; end if;
  insert into public.prospect_enrichment_runs(request_id,discovery_run_id,total_items,created_by) values(p_request_id,p_discovery_run_id,cardinality(p_result_ids),actor) returning id into created;
  foreach rid in array p_result_ids loop
    insert into public.prospect_enrichment_items(run_id,discovery_result_id,input_snapshot,official_website_url,canonical_domain,cache_key)
    select created,rr.id,jsonb_build_object('businessName',e.business_name,'website',e.website,'email',e.business_email,'phone',e.business_phone,'address',e.address,'city',e.city,'state',e.state,'zip',e.zip,'sourceUrl',e.source_url),
      nullif(btrim(e.website),''),public.prospect_domain_normalized(e.website),
      case when nullif(public.prospect_domain_normalized(e.website),'') is null then null else encode(sha256(convert_to('official-site-v1|'||public.prospect_domain_normalized(e.website),'UTF8')),'hex') end
    from public.prospect_discovery_run_results rr join public.prospect_discovery_entities e on e.id=rr.entity_id where rr.id=rid;
  end loop;
  return jsonb_build_object('runId',created,'cached',false);
end $$;

create function public.get_prospect_enrichment_inputs(p_run_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('itemId',i.id,'resultId',i.discovery_result_id,'website',i.official_website_url,'canonicalDomain',i.canonical_domain,'cacheKey',i.cache_key,'input',i.input_snapshot) order by i.id),'[]'::jsonb)
 from public.prospect_enrichment_items i join public.prospect_enrichment_runs r on r.id=i.run_id
 where i.run_id=p_run_id and (select auth.uid()) is not null and (public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and r.created_by=(select auth.uid()) and exists(select 1 from public.prospect_discovery_runs d where d.id=r.discovery_run_id and d.created_by=(select auth.uid()) and d.assigned_user_id=(select auth.uid()))));
$$;

create function public.get_prospect_enrichment_cache(p_cache_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); c public.prospect_enrichment_cache;
begin
 if actor is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then raise exception 'Prospect enrichment denied.' using errcode='42501'; end if;
 select * into c from public.prospect_enrichment_cache where cache_key=p_cache_key and expires_at>now();
 if not found then return null; end if;
 return jsonb_build_object('status',c.status,'results',c.result_snapshot,'fetchedAt',c.fetched_at);
end $$;

create function public.stage_prospect_enrichment_result(p_item_id uuid,p_status text,p_candidates jsonb,p_canonical_url text,p_canonical_domain text,p_cache_key text,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); item public.prospect_enrichment_items; run public.prospect_enrichment_runs; candidate jsonb; fingerprint text; expiry interval;
begin
 if actor is null or p_status not in('Complete','Partially Enriched','No Additional Data Found','Failed') or jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates)>40 then raise exception 'Invalid enrichment result.'; end if;
 select i.* into item from public.prospect_enrichment_items i where i.id=p_item_id for update;
 if not found then raise exception 'Enrichment item unavailable.'; end if;
 select * into run from public.prospect_enrichment_runs where id=item.run_id;
 if not(public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and run.created_by=actor and exists(select 1 from public.prospect_discovery_runs d where d.id=run.discovery_run_id and d.created_by=actor and d.assigned_user_id=actor))) then raise exception 'Prospect enrichment denied.' using errcode='42501'; end if;
 delete from public.prospect_enrichment_fields where enrichment_item_id=item.id and decision='Pending';
 for candidate in select value from jsonb_array_elements(p_candidates) loop
   if candidate->>'fieldName' not in('website','business_email','business_phone','address','city','state','zip','contact_page_url','contact_name','contact_title') then continue; end if;
   fingerprint:=encode(sha256(convert_to((candidate->>'fieldName')||'|'||coalesce(candidate->>'normalizedValue',candidate->>'value')||'|'||(candidate->>'sourceUrl'),'UTF8')),'hex');
   insert into public.prospect_enrichment_fields(enrichment_item_id,field_name,candidate_value,normalized_value,source_type,source_url,source_page_type,confidence,retrieved_at,candidate_fingerprint)
   values(item.id,candidate->>'fieldName',left(btrim(candidate->>'value'),2000),nullif(left(btrim(candidate->>'normalizedValue'),2000),''),'Official Website',candidate->>'sourceUrl',candidate->>'sourcePageType',least(100,greatest(0,(candidate->>'confidence')::integer)),coalesce((candidate->>'retrievedAt')::timestamptz,now()),fingerprint)
   on conflict(enrichment_item_id,candidate_fingerprint) do nothing;
 end loop;
 update public.prospect_enrichment_items set status=p_status,canonical_domain=coalesce(nullif(p_canonical_domain,''),canonical_domain),attempt_count=attempt_count+1,error_message=left(p_error,1000),started_at=coalesce(started_at,now()),completed_at=now() where id=item.id;
 if p_cache_key is not null and p_canonical_url ~ '^https://' and p_canonical_domain is not null then
   expiry:=case when p_status in('Complete','Partially Enriched') then interval '7 days' when p_status='No Additional Data Found' then interval '24 hours' else interval '30 minutes' end;
   insert into public.prospect_enrichment_cache(cache_key,canonical_url,canonical_domain,provider_version,status,result_snapshot,fetched_at,expires_at,failure_code)
   values(p_cache_key,p_canonical_url,p_canonical_domain,'official-site-v1',p_status,p_candidates,now(),now()+expiry,case when p_status='Failed' then left(p_error,200) end)
   on conflict(cache_key) do update set canonical_url=excluded.canonical_url,canonical_domain=excluded.canonical_domain,status=excluded.status,result_snapshot=excluded.result_snapshot,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,failure_code=excluded.failure_code;
 end if;
 update public.prospect_enrichment_runs r set
   completed_items=(select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Complete'),
   partial_items=(select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Partially Enriched'),
   no_data_items=(select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='No Additional Data Found'),
   failed_items=(select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Failed'),
   status=case when (select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status in('Pending','In Progress'))=0 then case when (select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Failed')=r.total_items then 'Failed' when (select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Failed')>0 then 'Partial' else 'Completed' end else r.status end,
   completed_at=case when (select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status in('Pending','In Progress'))=0 then now() else r.completed_at end
 where r.id=run.id;
end $$;

create function public.get_prospect_enrichment_review(p_run_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('itemId',i.id,'resultId',i.discovery_result_id,'status',i.status,'error',i.error_message,'completedAt',i.completed_at,'candidates',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'fieldName',f.field_name,'value',f.candidate_value,'normalizedValue',f.normalized_value,'sourceType',f.source_type,'sourceUrl',f.source_url,'sourcePageType',f.source_page_type,'confidence',f.confidence,'retrievedAt',f.retrieved_at,'decision',f.decision) order by f.field_name,f.confidence desc) from public.prospect_enrichment_fields f where f.enrichment_item_id=i.id),'[]'::jsonb)) order by i.id),'[]'::jsonb)
 from public.prospect_enrichment_items i join public.prospect_enrichment_runs r on r.id=i.run_id
 where i.run_id=p_run_id and (select auth.uid()) is not null and (public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and r.created_by=(select auth.uid()) and exists(select 1 from public.prospect_discovery_runs d where d.id=r.discovery_run_id and d.created_by=(select auth.uid()) and d.assigned_user_id=(select auth.uid()))));
$$;

create function public.save_prospect_enrichment_decisions(p_run_id uuid,p_decisions jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); run public.prospect_enrichment_runs; d jsonb; field public.prospect_enrichment_fields;
begin
 if actor is null or jsonb_typeof(p_decisions)<>'array' or jsonb_array_length(p_decisions)>100 then raise exception 'Invalid enrichment decisions.'; end if;
 select * into run from public.prospect_enrichment_runs where id=p_run_id;
 if not found or not(public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and run.created_by=actor and exists(select 1 from public.prospect_discovery_runs x where x.id=run.discovery_run_id and x.created_by=actor and x.assigned_user_id=actor))) then raise exception 'Prospect enrichment denied.' using errcode='42501'; end if;
 for d in select value from jsonb_array_elements(p_decisions) loop
   select f.* into field from public.prospect_enrichment_fields f join public.prospect_enrichment_items i on i.id=f.enrichment_item_id where f.id=(d->>'fieldId')::uuid and i.run_id=p_run_id for update;
   if not found or d->>'decision' not in('Accepted','Rejected') then raise exception 'Invalid enrichment decision.'; end if;
   update public.prospect_enrichment_fields set decision=d->>'decision',decided_by=actor,decided_at=now() where id=field.id;
 end loop;
end $$;

create policy "Authorized users read enrichment runs" on public.prospect_enrichment_runs for select to authenticated using(public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and created_by=(select auth.uid()) and exists(select 1 from public.prospect_discovery_runs d where d.id=discovery_run_id and d.created_by=(select auth.uid()) and d.assigned_user_id=(select auth.uid()))));
create policy "Authorized users read enrichment items" on public.prospect_enrichment_items for select to authenticated using(exists(select 1 from public.prospect_enrichment_runs r where r.id=run_id and (public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and r.created_by=(select auth.uid()) and exists(select 1 from public.prospect_discovery_runs d where d.id=r.discovery_run_id and d.created_by=(select auth.uid()) and d.assigned_user_id=(select auth.uid()))))));
create policy "Authorized users read enrichment fields" on public.prospect_enrichment_fields for select to authenticated using(exists(select 1 from public.prospect_enrichment_items i join public.prospect_enrichment_runs r on r.id=i.run_id where i.id=enrichment_item_id and (public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and r.created_by=(select auth.uid()) and exists(select 1 from public.prospect_discovery_runs d where d.id=r.discovery_run_id and d.created_by=(select auth.uid()) and d.assigned_user_id=(select auth.uid()))))));

revoke all on table public.prospect_enrichment_runs,public.prospect_enrichment_items,public.prospect_enrichment_fields,public.prospect_enrichment_cache from public,anon,authenticated;
grant select on table public.prospect_enrichment_runs,public.prospect_enrichment_items,public.prospect_enrichment_fields to authenticated;
revoke all on function public.begin_prospect_enrichment(uuid,uuid,uuid[]),public.get_prospect_enrichment_inputs(uuid),public.get_prospect_enrichment_cache(text),public.stage_prospect_enrichment_result(uuid,text,jsonb,text,text,text,text),public.get_prospect_enrichment_review(uuid),public.save_prospect_enrichment_decisions(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.begin_prospect_enrichment(uuid,uuid,uuid[]),public.get_prospect_enrichment_inputs(uuid),public.get_prospect_enrichment_cache(text),public.stage_prospect_enrichment_result(uuid,text,jsonb,text,text,text,text),public.get_prospect_enrichment_review(uuid),public.save_prospect_enrichment_decisions(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

