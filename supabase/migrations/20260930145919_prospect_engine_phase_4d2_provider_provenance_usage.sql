begin;

create table public.prospect_enrichment_provider_calls (
  id uuid primary key default gen_random_uuid(),
  enrichment_run_id uuid not null references public.prospect_enrichment_runs(id) on delete restrict,
  enrichment_item_id uuid not null references public.prospect_enrichment_items(id) on delete restrict,
  provider_key text not null check(length(provider_key) between 1 and 100),
  provider_version text not null check(length(provider_version) between 1 and 100),
  operation text not null check(length(operation) between 1 and 100),
  request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_request_id text check(provider_request_id is null or length(provider_request_id) between 1 and 500),
  status text not null default 'In Progress' check(status in('In Progress','Completed','No Data','Failed')),
  cache_hit boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  credits_used numeric(14,4) not null default 0 check(credits_used>=0),
  cost_minor_units bigint not null default 0 check(cost_minor_units>=0),
  cost_currency text check(cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  http_status integer check(http_status is null or http_status between 100 and 599),
  error_code text check(error_code is null or length(error_code)<=200),
  response_metadata jsonb not null default '{}'::jsonb
    check(jsonb_typeof(response_metadata)='object' and pg_column_size(response_metadata)<=16384),
  check(cost_minor_units=0 or cost_currency is not null),
  check((status='In Progress' and completed_at is null) or (status<>'In Progress' and completed_at is not null))
);

alter table public.prospect_enrichment_fields
  add column provider_key text,
  add column provider_version text,
  add column provider_call_id uuid references public.prospect_enrichment_provider_calls(id) on delete restrict,
  add column source_kind text,
  add column verification_status text,
  add column discovered_at timestamptz,
  add column verified_at timestamptz,
  add column provider_record_id text,
  add column provider_metadata jsonb not null default '{}'::jsonb,
  add column credits_used numeric(14,4) not null default 0,
  add column cost_minor_units bigint not null default 0,
  add column cost_currency text;

update public.prospect_enrichment_fields
set provider_key=case source_type when 'OpenStreetMap' then 'osm-metadata' when 'Generated Candidate' then 'generated-role-email' else 'official-website-contacts' end,
    provider_version='legacy',
    source_kind=source_page_type,
    verification_status=case when source_type='Generated Candidate' then 'unverified' else 'published' end,
    discovered_at=retrieved_at;

alter table public.prospect_enrichment_fields
  alter column provider_key set not null,
  alter column provider_version set not null,
  alter column source_kind set not null,
  alter column verification_status set not null,
  alter column discovered_at set not null,
  add constraint prospect_enrichment_fields_provider_key_check check(length(provider_key) between 1 and 100),
  add constraint prospect_enrichment_fields_provider_version_check check(length(provider_version) between 1 and 100),
  add constraint prospect_enrichment_fields_source_kind_check check(length(source_kind) between 1 and 100),
  add constraint prospect_enrichment_fields_verification_status_check check(verification_status in('published','verified','valid','catch_all','risky','unverified','invalid','unknown')),
  add constraint prospect_enrichment_fields_verified_at_check check(verified_at is null or verification_status in('verified','valid','catch_all','risky','invalid')),
  add constraint prospect_enrichment_fields_provider_record_id_check check(provider_record_id is null or length(provider_record_id)<=500),
  add constraint prospect_enrichment_fields_provider_metadata_check check(jsonb_typeof(provider_metadata)='object' and pg_column_size(provider_metadata)<=16384),
  add constraint prospect_enrichment_fields_credits_check check(credits_used>=0),
  add constraint prospect_enrichment_fields_cost_check check(cost_minor_units>=0),
  add constraint prospect_enrichment_fields_currency_check check(cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  add constraint prospect_enrichment_fields_cost_currency_check check(cost_minor_units=0 or cost_currency is not null);

alter table public.prospect_enrichment_provider_calls enable row level security;

create index prospect_enrichment_provider_calls_run_idx on public.prospect_enrichment_provider_calls(enrichment_run_id,started_at desc);
create index prospect_enrichment_provider_calls_item_idx on public.prospect_enrichment_provider_calls(enrichment_item_id,started_at desc);
create index prospect_enrichment_provider_calls_identity_idx on public.prospect_enrichment_provider_calls(provider_key,provider_version,operation,request_fingerprint);
create index prospect_enrichment_fields_provider_call_idx on public.prospect_enrichment_fields(provider_call_id) where provider_call_id is not null;
create index prospect_enrichment_fields_evidence_idx on public.prospect_enrichment_fields(enrichment_item_id,field_name,normalized_value,provider_key);

create policy "Authorized users read enrichment provider calls"
on public.prospect_enrichment_provider_calls for select to authenticated
using(exists(
  select 1
  from public.prospect_enrichment_runs r
  join public.prospect_discovery_runs d on d.id=r.discovery_run_id
  where r.id=enrichment_run_id
    and (
      public.has_any_role(array['Master Admin','Administrator','Manager'])
      or (
        public.has_any_role(array['Sales'])
        and r.created_by=(select auth.uid())
        and d.created_by=(select auth.uid())
        and d.assigned_user_id=(select auth.uid())
      )
    )
));

create function public.begin_prospect_enrichment_provider_call(
  p_item_id uuid,
  p_provider_key text,
  p_provider_version text,
  p_operation text,
  p_request_fingerprint text,
  p_cache_hit boolean default false
)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); item public.prospect_enrichment_items; run public.prospect_enrichment_runs; created uuid;
begin
  if actor is null
     or length(btrim(p_provider_key)) not between 1 and 100
     or length(btrim(p_provider_version)) not between 1 and 100
     or length(btrim(p_operation)) not between 1 and 100
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
  then raise exception 'Invalid provider call.'; end if;

  select * into item from public.prospect_enrichment_items where id=p_item_id;
  if not found then raise exception 'Enrichment item unavailable.'; end if;
  select * into run from public.prospect_enrichment_runs where id=item.run_id;
  if not(
    public.has_any_role(array['Master Admin','Administrator','Manager'])
    or (public.has_any_role(array['Sales']) and run.created_by=actor and exists(
      select 1 from public.prospect_discovery_runs d
      where d.id=run.discovery_run_id and d.created_by=actor and d.assigned_user_id=actor
    ))
  ) then raise exception 'Prospect enrichment denied.' using errcode='42501'; end if;

  insert into public.prospect_enrichment_provider_calls(
    enrichment_run_id,enrichment_item_id,provider_key,provider_version,operation,request_fingerprint,cache_hit
  ) values(
    run.id,item.id,btrim(p_provider_key),btrim(p_provider_version),btrim(p_operation),p_request_fingerprint,coalesce(p_cache_hit,false)
  ) returning id into created;
  return created;
end $$;

create function public.complete_prospect_enrichment_provider_call(
  p_provider_call_id uuid,
  p_status text,
  p_cache_hit boolean default false,
  p_provider_request_id text default null,
  p_credits_used numeric default 0,
  p_cost_minor_units bigint default 0,
  p_cost_currency text default null,
  p_http_status integer default null,
  p_error_code text default null,
  p_response_metadata jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); call public.prospect_enrichment_provider_calls; run public.prospect_enrichment_runs;
begin
  if actor is null or p_status not in('Completed','No Data','Failed')
     or coalesce(p_credits_used,-1)<0 or coalesce(p_cost_minor_units,-1)<0
     or (p_cost_currency is not null and p_cost_currency !~ '^[A-Z]{3}$')
     or (p_http_status is not null and p_http_status not between 100 and 599)
     or jsonb_typeof(coalesce(p_response_metadata,'{}'::jsonb))<>'object'
     or pg_column_size(coalesce(p_response_metadata,'{}'::jsonb))>16384
     or coalesce(p_response_metadata,'{}'::jsonb)::text ~* '"(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|cookie|raw[-_]?response|html)"\s*:'
  then raise exception 'Invalid provider call completion.'; end if;

  select * into call from public.prospect_enrichment_provider_calls where id=p_provider_call_id for update;
  if not found then raise exception 'Provider call unavailable.'; end if;
  if call.status<>'In Progress' then raise exception 'Provider call already completed.'; end if;
  select * into run from public.prospect_enrichment_runs where id=call.enrichment_run_id;
  if not(
    public.has_any_role(array['Master Admin','Administrator','Manager'])
    or (public.has_any_role(array['Sales']) and run.created_by=actor and exists(
      select 1 from public.prospect_discovery_runs d
      where d.id=run.discovery_run_id and d.created_by=actor and d.assigned_user_id=actor
    ))
  ) then raise exception 'Prospect enrichment denied.' using errcode='42501'; end if;

  update public.prospect_enrichment_provider_calls set
    status=p_status,cache_hit=coalesce(p_cache_hit,false),completed_at=now(),
    provider_request_id=nullif(left(btrim(p_provider_request_id),500),''),
    credits_used=p_credits_used,cost_minor_units=p_cost_minor_units,cost_currency=p_cost_currency,
    http_status=p_http_status,error_code=nullif(left(btrim(p_error_code),200),''),
    response_metadata=coalesce(p_response_metadata,'{}'::jsonb)
  where id=call.id;
end $$;

create or replace function public.stage_prospect_enrichment_result(
  p_item_id uuid,p_status text,p_candidates jsonb,p_canonical_url text,
  p_canonical_domain text,p_cache_key text,p_error text default null
)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); item public.prospect_enrichment_items; run public.prospect_enrichment_runs; candidate jsonb; evidence jsonb; usage jsonb; fingerprint text; expiry interval; candidate_source text; call_id uuid; metadata jsonb;
begin
  if actor is null or p_status not in('Complete','Partially Enriched','No Additional Data Found','Failed') or jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates)>40 then raise exception 'Invalid enrichment result.'; end if;
  select i.* into item from public.prospect_enrichment_items i where i.id=p_item_id for update;
  if not found then raise exception 'Enrichment item unavailable.'; end if;
  select * into run from public.prospect_enrichment_runs where id=item.run_id;
  if not(public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and run.created_by=actor and exists(select 1 from public.prospect_discovery_runs d where d.id=run.discovery_run_id and d.created_by=actor and d.assigned_user_id=actor))) then raise exception 'Prospect enrichment denied.' using errcode='42501'; end if;

  delete from public.prospect_enrichment_fields where enrichment_item_id=item.id and decision='Pending';
  for candidate in select value from jsonb_array_elements(p_candidates) loop
    if candidate->>'fieldName' not in('website','business_email','business_phone','address','city','state','zip','contact_page_url','contact_name','contact_title') then continue; end if;
    evidence:=coalesce(candidate->'evidence','{}'::jsonb); usage:=coalesce(candidate->'usage','{}'::jsonb);
    candidate_source:=coalesce(nullif(candidate->>'sourceType',''),'Official Website');
    if candidate_source not in('Official Website','Generated Candidate') then candidate_source:='Official Website'; end if;
    if candidate_source='Generated Candidate' and candidate->>'fieldName'<>'business_email' then continue; end if;
    if coalesce(evidence->>'providerKey','')='' or coalesce(evidence->>'providerVersion','')='' then raise exception 'Candidate provider provenance required.'; end if;
    call_id:=nullif(evidence->>'providerCallId','')::uuid;
    if call_id is null or not exists(select 1 from public.prospect_enrichment_provider_calls c where c.id=call_id and c.enrichment_item_id=item.id and c.status<>'In Progress') then raise exception 'Candidate provider call unavailable.'; end if;
    metadata:=coalesce(evidence->'providerMetadata','{}'::jsonb);
    if jsonb_typeof(metadata)<>'object' or pg_column_size(metadata)>16384 or metadata::text ~* '"(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|cookie|raw[-_]?response|html)"\s*:' then raise exception 'Invalid candidate provider metadata.'; end if;
    fingerprint:=encode(sha256(convert_to((candidate->>'fieldName')||'|'||coalesce(candidate->>'normalizedValue',candidate->>'value')||'|'||(candidate->>'sourceUrl')||'|'||candidate_source||'|'||(evidence->>'providerKey')||'|'||(evidence->>'providerVersion'),'UTF8')),'hex');

    insert into public.prospect_enrichment_fields(
      enrichment_item_id,field_name,candidate_value,normalized_value,source_type,source_url,source_page_type,confidence,retrieved_at,candidate_fingerprint,
      provider_key,provider_version,provider_call_id,source_kind,verification_status,discovered_at,verified_at,provider_record_id,provider_metadata,credits_used,cost_minor_units,cost_currency
    ) values(
      item.id,candidate->>'fieldName',left(btrim(candidate->>'value'),2000),nullif(left(btrim(candidate->>'normalizedValue'),2000),''),candidate_source,candidate->>'sourceUrl',candidate->>'sourcePageType',
      least(case when candidate_source='Generated Candidate' then 55 else 100 end,greatest(0,(candidate->>'confidence')::integer)),coalesce((candidate->>'retrievedAt')::timestamptz,now()),fingerprint,
      left(evidence->>'providerKey',100),left(evidence->>'providerVersion',100),call_id,left(coalesce(nullif(evidence->>'sourceKind',''),candidate->>'sourcePageType'),100),
      coalesce(nullif(evidence->>'verificationStatus',''),'unknown'),coalesce((evidence->>'discoveredAt')::timestamptz,(candidate->>'retrievedAt')::timestamptz,now()),nullif(evidence->>'verifiedAt','')::timestamptz,
      nullif(left(btrim(evidence->>'providerRecordId'),500),''),metadata,coalesce((usage->>'creditsUsed')::numeric,0),coalesce((usage->>'costMinorUnits')::bigint,0),nullif(usage->>'costCurrency','')
    ) on conflict(enrichment_item_id,candidate_fingerprint) do nothing;
  end loop;

  update public.prospect_enrichment_items set status=p_status,canonical_domain=coalesce(nullif(p_canonical_domain,''),canonical_domain),attempt_count=attempt_count+1,error_message=left(p_error,1000),started_at=coalesce(started_at,now()),completed_at=now() where id=item.id;
  if p_cache_key is not null and p_canonical_url ~ '^https://' and p_canonical_domain is not null then
    expiry:=case when p_status in('Complete','Partially Enriched') then interval '7 days' when p_status='No Additional Data Found' then interval '24 hours' else interval '30 minutes' end;
    insert into public.prospect_enrichment_cache(cache_key,canonical_url,canonical_domain,provider_version,status,result_snapshot,fetched_at,expires_at,failure_code)
    values(p_cache_key,p_canonical_url,p_canonical_domain,'official-site-v2',p_status,p_candidates,now(),now()+expiry,case when p_status='Failed' then left(p_error,200) end)
    on conflict(cache_key) do update set canonical_url=excluded.canonical_url,canonical_domain=excluded.canonical_domain,provider_version=excluded.provider_version,status=excluded.status,result_snapshot=excluded.result_snapshot,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,failure_code=excluded.failure_code;
  end if;
  update public.prospect_enrichment_runs r set
    completed_items=(select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Complete'),partial_items=(select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Partially Enriched'),no_data_items=(select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='No Additional Data Found'),failed_items=(select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Failed'),
    status=case when (select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status in('Pending','In Progress'))=0 then case when (select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Failed')=r.total_items then 'Failed' when (select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Failed')>0 then 'Partial' else 'Completed' end else r.status end,
    completed_at=case when (select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status in('Pending','In Progress'))=0 then now() else r.completed_at end where r.id=run.id;
end $$;

revoke all on table public.prospect_enrichment_provider_calls from public,anon,authenticated;
grant select on table public.prospect_enrichment_provider_calls to authenticated;
revoke all on function public.begin_prospect_enrichment_provider_call(uuid,text,text,text,text,boolean),public.complete_prospect_enrichment_provider_call(uuid,text,boolean,text,numeric,bigint,text,integer,text,jsonb),public.stage_prospect_enrichment_result(uuid,text,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.begin_prospect_enrichment_provider_call(uuid,text,text,text,text,boolean),public.complete_prospect_enrichment_provider_call(uuid,text,boolean,text,numeric,bigint,text,integer,text,jsonb),public.stage_prospect_enrichment_result(uuid,text,jsonb,text,text,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
