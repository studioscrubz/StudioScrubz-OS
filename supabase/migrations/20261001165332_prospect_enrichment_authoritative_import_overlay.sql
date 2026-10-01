begin;

create function public.prospect_discovery_effective_values(
  p_result_id uuid,
  p_enrichment_item_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  actor uuid := (select auth.uid());
  rr public.prospect_discovery_run_results;
  discovery public.prospect_discovery_runs;
  entity public.prospect_discovery_entities;
  enrichment_item public.prospect_enrichment_items;
  enrichment_run public.prospect_enrichment_runs;
  pending_count integer := 0;
  conflict_field text;
  accepted_website text;
  accepted_email text;
  accepted_phone text;
  accepted_address text;
  accepted_city text;
  accepted_state text;
  accepted_zip text;
  accepted_evidence_ids jsonb := '[]'::jsonb;
begin
  if actor is null then
    raise exception 'Discovery import denied.' using errcode='42501';
  end if;

  select * into rr
  from public.prospect_discovery_run_results
  where id=p_result_id;
  if not found then raise exception 'Discovery result unavailable.'; end if;

  select * into discovery from public.prospect_discovery_runs where id=rr.run_id;
  if not(
    public.has_any_role(array['Master Admin','Administrator','Manager'])
    or (
      public.has_any_role(array['Sales'])
      and discovery.created_by=actor
      and discovery.assigned_user_id=actor
    )
  ) then
    raise exception 'Discovery import denied.' using errcode='42501';
  end if;

  select * into entity from public.prospect_discovery_entities where id=rr.entity_id;
  if not found then raise exception 'Discovery entity unavailable.'; end if;

  if p_enrichment_item_id is not null then
    select * into enrichment_item
    from public.prospect_enrichment_items
    where id=p_enrichment_item_id and discovery_result_id=rr.id;
    if not found then raise exception 'Enrichment review does not match this discovery result.'; end if;

    select * into enrichment_run
    from public.prospect_enrichment_runs
    where id=enrichment_item.run_id and discovery_run_id=rr.run_id;
    if not found then raise exception 'Enrichment review does not match this discovery run.'; end if;
    if not(
      public.has_any_role(array['Master Admin','Administrator','Manager'])
      or (
        public.has_any_role(array['Sales'])
        and enrichment_run.created_by=actor
        and discovery.created_by=actor
        and discovery.assigned_user_id=actor
      )
    ) then
      raise exception 'Prospect enrichment denied.' using errcode='42501';
    end if;
    if enrichment_item.status in('Pending','In Progress') then
      raise exception 'Enrichment is not complete for %.',entity.business_name;
    end if;

    select count(*) into pending_count
    from public.prospect_enrichment_fields
    where enrichment_item_id=enrichment_item.id and decision='Pending';

    select conflicts.field_name into conflict_field
    from (
      select f.field_name
      from public.prospect_enrichment_fields f
      where f.enrichment_item_id=enrichment_item.id
        and f.decision='Accepted'
        and f.field_name in('website','business_email','business_phone','address','city','state','zip')
      group by f.field_name
      having count(distinct case f.field_name
        when 'business_email' then lower(btrim(f.candidate_value))
        when 'business_phone' then public.prospect_phone_normalized(f.candidate_value)
        else coalesce(nullif(f.normalized_value,''),public.prospect_text_normalized(f.candidate_value))
      end)>1
      order by f.field_name
      limit 1
    ) conflicts;

    with accepted as (
      select f.*,
        row_number() over(
          partition by f.field_name
          order by
            case f.source_type when 'Official Website' then 0 when 'OpenStreetMap' then 1 else 2 end,
            case f.verification_status when 'published' then 0 when 'verified' then 1 when 'valid' then 2 else 3 end,
            f.confidence desc,f.retrieved_at,f.id
        ) as choice
      from public.prospect_enrichment_fields f
      where f.enrichment_item_id=enrichment_item.id
        and f.decision='Accepted'
        and f.field_name in('website','business_email','business_phone','address','city','state','zip')
    )
    select
      max(candidate_value) filter(where field_name='website' and choice=1),
      max(candidate_value) filter(where field_name='business_email' and choice=1),
      max(candidate_value) filter(where field_name='business_phone' and choice=1),
      max(candidate_value) filter(where field_name='address' and choice=1),
      max(candidate_value) filter(where field_name='city' and choice=1),
      max(candidate_value) filter(where field_name='state' and choice=1),
      max(candidate_value) filter(where field_name='zip' and choice=1)
    into accepted_website,accepted_email,accepted_phone,accepted_address,accepted_city,accepted_state,accepted_zip
    from accepted;

    select coalesce(jsonb_agg(f.id order by f.field_name,f.id),'[]'::jsonb)
    into accepted_evidence_ids
    from public.prospect_enrichment_fields f
    where f.enrichment_item_id=enrichment_item.id
      and f.decision='Accepted'
      and f.field_name in('website','business_email','business_phone','address','city','state','zip');
  end if;

  return jsonb_build_object(
    'resultId',rr.id,
    'enrichmentItemId',p_enrichment_item_id,
    'hasPending',pending_count>0,
    'conflictField',conflict_field,
    'acceptedEvidenceIds',accepted_evidence_ids,
    'businessName',entity.business_name,
    'industry',entity.category,
    'website',coalesce(accepted_website,entity.website),
    'businessEmail',coalesce(accepted_email,entity.business_email),
    'businessPhone',coalesce(accepted_phone,entity.business_phone),
    'address',coalesce(accepted_address,entity.address),
    'city',coalesce(accepted_city,entity.city),
    'state',coalesce(accepted_state,entity.state),
    'zip',coalesce(accepted_zip,entity.zip),
    'sourceUrl',entity.source_url,
    'discoveredAt',entity.retrieved_at,
    'providerIdentifier',entity.provider_identifier,
    'licenseAttribution',entity.license_attribution
  );
end
$$;

create function public.get_prospect_discovery_import_preview(
  p_run_id uuid,
  p_selections jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  actor uuid := (select auth.uid());
  run public.prospect_discovery_runs;
  item jsonb;
  effective jsonb;
  result_id uuid;
  enrichment_item_id uuid;
  normalized_email text;
  normalized_phone text;
  normalized_domain text;
  normalized_name text;
  normalized_address text;
  normalized_zip text;
  authoritative_match uuid;
  authoritative_classification text;
  output jsonb := '[]'::jsonb;
begin
  if actor is null or jsonb_typeof(p_selections)<>'array' or jsonb_array_length(p_selections)>150 then
    raise exception 'Invalid discovery import preview.';
  end if;
  select * into run from public.prospect_discovery_runs where id=p_run_id;
  if not found or not(
    public.has_any_role(array['Master Admin','Administrator','Manager'])
    or (public.has_any_role(array['Sales']) and run.created_by=actor and run.assigned_user_id=actor)
  ) then raise exception 'Discovery import denied.' using errcode='42501'; end if;

  for item in select value from jsonb_array_elements(p_selections) loop
    result_id:=(item->>'resultId')::uuid;
    enrichment_item_id:=nullif(item->>'enrichmentItemId','')::uuid;
    if not exists(select 1 from public.prospect_discovery_run_results rr where rr.id=result_id and rr.run_id=p_run_id) then
      raise exception 'Discovery result unavailable.';
    end if;
    effective:=public.prospect_discovery_effective_values(result_id,enrichment_item_id);
    if effective->>'conflictField' is not null then
      raise exception 'Multiple accepted values exist for % on %. Keep only one accepted value.',effective->>'conflictField',effective->>'businessName';
    end if;

    normalized_email:=nullif(lower(btrim(effective->>'businessEmail')),'');
    normalized_phone:=public.prospect_phone_normalized(effective->>'businessPhone');
    normalized_domain:=public.prospect_domain_normalized(coalesce(effective->>'website',split_part(normalized_email,'@',2)));
    normalized_name:=public.prospect_text_normalized(effective->>'businessName');
    normalized_address:=public.prospect_text_normalized(effective->>'address');
    normalized_zip:=nullif(btrim(effective->>'zip'),'');
    authoritative_match:=null;authoritative_classification:='New';
    select p.id,case when
      (normalized_email is not null and p.email_normalized=normalized_email)
      or (normalized_phone is not null and p.phone_normalized=normalized_phone)
      or (normalized_domain is not null and p.domain_normalized=normalized_domain)
      or (normalized_name=public.prospect_text_normalized(p.company_name) and (
        (normalized_address is not null and normalized_address=public.prospect_text_normalized(p.address))
        or (normalized_zip is not null and normalized_zip=nullif(btrim(p.zip),''))
      )) then 'Exact duplicate' else 'Possible duplicate' end
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
      )) then 0 else 1 end,p.created_at,p.id
    limit 1;
    if not found then authoritative_match:=null;authoritative_classification:='New';end if;
    output:=output||jsonb_build_array(jsonb_build_object(
      'resultId',result_id,
      'classification',authoritative_classification,
      'matchedProspectId',authoritative_match
    ));
  end loop;
  return output;
end
$$;

create or replace function public.import_prospect_discovery_results(
  p_run_id uuid,
  p_request_id uuid,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid := (select auth.uid());
  run public.prospect_discovery_runs;
  item jsonb;
  rr public.prospect_discovery_run_results;
  entity public.prospect_discovery_entities;
  effective jsonb;
  enrichment_item_id uuid;
  decision text;
  client_classification text;
  authoritative_classification text;
  authoritative_match uuid;
  submitted_match uuid;
  normalized_email text;
  normalized_phone text;
  normalized_domain text;
  normalized_name text;
  normalized_address text;
  normalized_zip text;
  effective_website text;
  effective_email text;
  effective_phone text;
  effective_address text;
  effective_city text;
  effective_state text;
  effective_zip text;
  prospect_id uuid;
  imported integer := 0;
  skipped integer := 0;
begin
  if actor is null or jsonb_typeof(p_selections)<>'array' or jsonb_array_length(p_selections)>150 then
    raise exception 'Invalid discovery import.';
  end if;
  select * into run from public.prospect_discovery_runs where id=p_run_id for update;
  if not found or not(
    public.has_any_role(array['Master Admin','Administrator','Manager'])
    or (public.has_any_role(array['Sales']) and run.created_by=actor and run.assigned_user_id=actor)
  ) then raise exception 'Discovery import denied.' using errcode='42501'; end if;

  for item in select value from jsonb_array_elements(p_selections) loop
    select result.* into rr
    from public.prospect_discovery_run_results result
    where result.id=(item->>'resultId')::uuid and result.run_id=p_run_id
    for update;
    if not found then raise exception 'Discovery result unavailable.'; end if;
    if rr.imported_prospect_id is not null then imported:=imported+1;continue;end if;
    select * into entity from public.prospect_discovery_entities where id=rr.entity_id;

    enrichment_item_id:=nullif(item->>'enrichmentItemId','')::uuid;
    if enrichment_item_id is not null then
      perform 1 from public.prospect_enrichment_items where id=enrichment_item_id for update;
      perform 1 from public.prospect_enrichment_fields where enrichment_item_id=enrichment_item_id for update;
    end if;
    effective:=public.prospect_discovery_effective_values(rr.id,enrichment_item_id);
    if (effective->>'hasPending')::boolean then
      raise exception 'Resolve all enrichment candidates for % before importing.',entity.business_name;
    end if;
    if effective->>'conflictField' is not null then
      raise exception 'Multiple accepted values exist for % on %. Keep only one accepted value.',effective->>'conflictField',entity.business_name;
    end if;

    effective_website:=nullif(btrim(effective->>'website'),'');
    effective_email:=nullif(btrim(effective->>'businessEmail'),'');
    effective_phone:=nullif(btrim(effective->>'businessPhone'),'');
    effective_address:=nullif(btrim(effective->>'address'),'');
    effective_city:=nullif(btrim(effective->>'city'),'');
    effective_state:=nullif(btrim(effective->>'state'),'');
    effective_zip:=nullif(btrim(effective->>'zip'),'');
    normalized_email:=nullif(lower(effective_email),'');
    normalized_phone:=public.prospect_phone_normalized(effective_phone);
    normalized_domain:=public.prospect_domain_normalized(coalesce(effective_website,split_part(normalized_email,'@',2)));
    normalized_name:=public.prospect_text_normalized(entity.business_name);
    normalized_address:=public.prospect_text_normalized(effective_address);
    normalized_zip:=effective_zip;
    authoritative_match:=null;authoritative_classification:='New';

    select p.id,case when
      (normalized_email is not null and p.email_normalized=normalized_email)
      or (normalized_phone is not null and p.phone_normalized=normalized_phone)
      or (normalized_domain is not null and p.domain_normalized=normalized_domain)
      or (normalized_name=public.prospect_text_normalized(p.company_name) and (
        (normalized_address is not null and normalized_address=public.prospect_text_normalized(p.address))
        or (normalized_zip is not null and normalized_zip=nullif(btrim(p.zip),''))
      )) then 'Exact duplicate' else 'Possible duplicate' end
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
      )) then 0 else 1 end,p.created_at,p.id
    limit 1;
    if not found then authoritative_match:=null;authoritative_classification:='New';end if;

    client_classification:=item->>'classification';
    decision:=item->>'decision';
    submitted_match:=nullif(item->>'matchedProspectId','')::uuid;
    if client_classification is distinct from authoritative_classification then
      raise exception 'Duplicate status changed for %. Review discovery results again before importing.',entity.business_name using errcode='40001';
    end if;
    if decision not in('Skip','Import Separately','Merge') then raise exception 'Explicit duplicate decision required.';end if;
    if authoritative_classification='Exact duplicate' and decision='Import Separately' then raise exception 'Exact duplicates must be skipped or merged.';end if;
    if authoritative_classification='New' and decision='Merge' then raise exception 'A current duplicate match is required to merge.';end if;
    if decision='Merge' and (authoritative_match is null or submitted_match is distinct from authoritative_match) then
      raise exception 'Duplicate match changed for %. Review discovery results again before merging.',entity.business_name using errcode='40001';
    end if;
    if decision='Skip' then
      update public.prospect_discovery_run_results set selected=true,duplicate_classification=authoritative_classification,duplicate_decision=decision,matched_prospect_id=authoritative_match,imported_by=actor where id=rr.id;
      skipped:=skipped+1;continue;
    end if;

    if decision='Merge' then
      prospect_id:=authoritative_match;
      if prospect_id is null or not exists(
        select 1 from public.prospects p where p.id=prospect_id and p.merged_into_prospect_id is null
        and (public.has_any_role(array['Master Admin','Administrator','Manager']) or p.assigned_user_id=actor)
      ) then raise exception 'Merge target unavailable.' using errcode='42501';end if;
      update public.prospects p set
        business_email=coalesce(nullif(p.business_email,''),effective_email),
        business_phone=coalesce(nullif(p.business_phone,''),effective_phone),
        website=coalesce(nullif(p.website,''),effective_website),
        address=coalesce(nullif(p.address,''),effective_address),
        city=coalesce(nullif(p.city,''),effective_city),
        state=coalesce(nullif(p.state,''),effective_state),
        zip=coalesce(nullif(p.zip,''),effective_zip),
        industry=coalesce(nullif(p.industry,''),entity.category)
      where p.id=prospect_id;
    else
      insert into public.prospects(
        company_name,industry,website,business_email,business_phone,address,city,state,zip,
        source_type,source_url,discovered_at,assigned_user_id,notes
      ) values(
        entity.business_name,entity.category,effective_website,effective_email,effective_phone,effective_address,effective_city,effective_state,effective_zip,
        'OpenStreetMap',entity.source_url,entity.retrieved_at,run.assigned_user_id,
        'Public-source discovery with reviewed enrichment overlay; category inferred from OSM tags. '||entity.license_attribution
      ) returning id into prospect_id;
    end if;

    update public.prospect_discovery_run_results set
      selected=true,duplicate_classification=authoritative_classification,duplicate_decision=decision,
      matched_prospect_id=authoritative_match,imported_prospect_id=prospect_id,imported_at=now(),imported_by=actor
    where id=rr.id;
    insert into public.prospect_events(prospect_id,event_type,actor_user_id,details)
    values(prospect_id,'Imported',actor,jsonb_build_object(
      'discoveryRunId',p_run_id,'discoveryResultId',rr.id,'source','OpenStreetMap',
      'providerIdentifier',entity.provider_identifier,'requestId',p_request_id,
      'enrichmentItemId',enrichment_item_id,'acceptedEnrichmentEvidenceIds',effective->'acceptedEvidenceIds'
    ));
    imported:=imported+1;
  end loop;
  return jsonb_build_object('imported',imported,'skipped',skipped);
end
$$;

revoke all on function public.prospect_discovery_effective_values(uuid,uuid),public.get_prospect_discovery_import_preview(uuid,jsonb),public.import_prospect_discovery_results(uuid,uuid,jsonb)
from public,anon,authenticated;

grant execute on function public.get_prospect_discovery_import_preview(uuid,jsonb),public.import_prospect_discovery_results(uuid,uuid,jsonb)
to authenticated;

notify pgrst,'reload schema';
commit;
