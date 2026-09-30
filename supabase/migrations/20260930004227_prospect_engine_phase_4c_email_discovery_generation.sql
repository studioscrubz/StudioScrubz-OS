begin;

alter table public.prospect_enrichment_fields
  drop constraint if exists prospect_enrichment_fields_source_type_check;

alter table public.prospect_enrichment_fields
  add constraint prospect_enrichment_fields_source_type_check
  check (source_type in ('OpenStreetMap','Official Website','Generated Candidate'));

create or replace function public.stage_prospect_enrichment_result(
  p_item_id uuid,
  p_status text,
  p_candidates jsonb,
  p_canonical_url text,
  p_canonical_domain text,
  p_cache_key text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  item public.prospect_enrichment_items;
  run public.prospect_enrichment_runs;
  candidate jsonb;
  fingerprint text;
  expiry interval;
  candidate_source text;
begin
  if actor is null
     or p_status not in('Complete','Partially Enriched','No Additional Data Found','Failed')
     or jsonb_typeof(p_candidates)<>'array'
     or jsonb_array_length(p_candidates)>40
  then
    raise exception 'Invalid enrichment result.';
  end if;

  select i.* into item
  from public.prospect_enrichment_items i
  where i.id=p_item_id
  for update;

  if not found then raise exception 'Enrichment item unavailable.'; end if;

  select * into run
  from public.prospect_enrichment_runs
  where id=item.run_id;

  if not(
    public.has_any_role(array['Master Admin','Administrator','Manager'])
    or (
      public.has_any_role(array['Sales'])
      and run.created_by=actor
      and exists(
        select 1
        from public.prospect_discovery_runs d
        where d.id=run.discovery_run_id
          and d.created_by=actor
          and d.assigned_user_id=actor
      )
    )
  ) then
    raise exception 'Prospect enrichment denied.' using errcode='42501';
  end if;

  delete from public.prospect_enrichment_fields
  where enrichment_item_id=item.id
    and decision='Pending';

  for candidate in select value from jsonb_array_elements(p_candidates) loop
    if candidate->>'fieldName' not in(
      'website','business_email','business_phone','address','city','state','zip',
      'contact_page_url','contact_name','contact_title'
    ) then
      continue;
    end if;

    candidate_source:=coalesce(nullif(candidate->>'sourceType',''),'Official Website');

    if candidate_source not in('Official Website','Generated Candidate') then
      candidate_source:='Official Website';
    end if;

    if candidate_source='Generated Candidate'
       and candidate->>'fieldName'<>'business_email'
    then
      continue;
    end if;

    fingerprint:=encode(
      sha256(
        convert_to(
          (candidate->>'fieldName')||'|'||
          coalesce(candidate->>'normalizedValue',candidate->>'value')||'|'||
          (candidate->>'sourceUrl')||'|'||candidate_source,
          'UTF8'
        )
      ),
      'hex'
    );

    insert into public.prospect_enrichment_fields(
      enrichment_item_id,field_name,candidate_value,normalized_value,
      source_type,source_url,source_page_type,confidence,retrieved_at,candidate_fingerprint
    )
    values(
      item.id,
      candidate->>'fieldName',
      left(btrim(candidate->>'value'),2000),
      nullif(left(btrim(candidate->>'normalizedValue'),2000),''),
      candidate_source,
      candidate->>'sourceUrl',
      candidate->>'sourcePageType',
      least(
        case when candidate_source='Generated Candidate' then 55 else 100 end,
        greatest(0,(candidate->>'confidence')::integer)
      ),
      coalesce((candidate->>'retrievedAt')::timestamptz,now()),
      fingerprint
    )
    on conflict(enrichment_item_id,candidate_fingerprint) do nothing;
  end loop;

  update public.prospect_enrichment_items
  set status=p_status,
      canonical_domain=coalesce(nullif(p_canonical_domain,''),canonical_domain),
      attempt_count=attempt_count+1,
      error_message=left(p_error,1000),
      started_at=coalesce(started_at,now()),
      completed_at=now()
  where id=item.id;

  if p_cache_key is not null
     and p_canonical_url ~ '^https://'
     and p_canonical_domain is not null
  then
    expiry:=case
      when p_status in('Complete','Partially Enriched') then interval '7 days'
      when p_status='No Additional Data Found' then interval '24 hours'
      else interval '30 minutes'
    end;

    insert into public.prospect_enrichment_cache(
      cache_key,canonical_url,canonical_domain,provider_version,status,
      result_snapshot,fetched_at,expires_at,failure_code
    )
    values(
      p_cache_key,p_canonical_url,p_canonical_domain,'official-site-v2',
      p_status,p_candidates,now(),now()+expiry,
      case when p_status='Failed' then left(p_error,200) end
    )
    on conflict(cache_key) do update
    set canonical_url=excluded.canonical_url,
        canonical_domain=excluded.canonical_domain,
        provider_version=excluded.provider_version,
        status=excluded.status,
        result_snapshot=excluded.result_snapshot,
        fetched_at=excluded.fetched_at,
        expires_at=excluded.expires_at,
        failure_code=excluded.failure_code;
  end if;

  update public.prospect_enrichment_runs r
  set completed_items=(select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Complete'),
      partial_items=(select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Partially Enriched'),
      no_data_items=(select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='No Additional Data Found'),
      failed_items=(select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Failed'),
      status=case
        when (select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status in('Pending','In Progress'))=0
        then case
          when (select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Failed')=r.total_items then 'Failed'
          when (select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status='Failed')>0 then 'Partial'
          else 'Completed'
        end
        else r.status
      end,
      completed_at=case
        when (select count(*) from public.prospect_enrichment_items i where i.run_id=r.id and i.status in('Pending','In Progress'))=0
        then now()
        else r.completed_at
      end
  where r.id=run.id;
end $$;

revoke all on function public.stage_prospect_enrichment_result(uuid,text,jsonb,text,text,text,text)
from public,anon,authenticated;

grant execute on function public.stage_prospect_enrichment_result(uuid,text,jsonb,text,text,text,text)
to authenticated;

notify pgrst,'reload schema';
commit;
