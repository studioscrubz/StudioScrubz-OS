begin;

alter table public.prospects
  add column contact_name text,
  add column name_address_normalized text,
  add column merged_into_prospect_id uuid references public.prospects(id) on delete restrict,
  add column merged_at timestamptz,
  add column merged_by uuid references public.user_profiles(id);

drop index public.prospects_domain_normalized_key;
drop index public.prospects_email_normalized_key;
drop index public.prospects_phone_normalized_key;
create index prospects_domain_normalized_idx on public.prospects(domain_normalized) where domain_normalized is not null and merged_into_prospect_id is null;
create index prospects_email_normalized_idx on public.prospects(email_normalized) where email_normalized is not null and merged_into_prospect_id is null;
create index prospects_phone_normalized_idx on public.prospects(phone_normalized) where phone_normalized is not null and merged_into_prospect_id is null;
create index prospects_name_address_normalized_idx on public.prospects(name_address_normalized) where name_address_normalized is not null and merged_into_prospect_id is null;

alter table public.prospect_events drop constraint prospect_events_event_type_check;
alter table public.prospect_events add constraint prospect_events_event_type_check check (event_type in ('Created','Assignment Changed','Status Changed','Verification Changed','Notes Changed','Imported','Merged'));

create table public.prospect_import_batches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  original_filename text not null check (length(btrim(original_filename)) between 1 and 255),
  assigned_user_id uuid references public.user_profiles(id),
  total_rows integer not null check (total_rows between 1 and 2000),
  imported_rows integer not null default 0,
  skipped_rows integer not null default 0,
  failed_rows integer not null default 0,
  status text not null default 'Processing' check (status in ('Processing','Completed','Completed with errors')),
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(created_by, request_id)
);

create table public.prospect_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.prospect_import_batches(id) on delete restrict,
  row_number integer not null check (row_number > 0),
  row_fingerprint text not null,
  disposition text not null check (disposition in ('Imported','Skipped','Failed','Merged')),
  duplicate_classification text not null check (duplicate_classification in ('New','Exact duplicate','Possible duplicate','Invalid')),
  decision text not null check (decision in ('Skip','Import Separately','Merge')),
  prospect_id uuid references public.prospects(id) on delete restrict,
  matched_prospect_id uuid references public.prospects(id) on delete restrict,
  error_message text,
  normalized_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(batch_id, row_number)
);

create table public.prospect_merges (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  survivor_prospect_id uuid not null references public.prospects(id) on delete restrict,
  removed_prospect_id uuid not null references public.prospects(id) on delete restrict,
  field_decisions jsonb not null default '{}'::jsonb,
  survivor_snapshot jsonb not null,
  removed_snapshot jsonb not null,
  merged_by uuid not null references public.user_profiles(id),
  merged_at timestamptz not null default now(),
  unique(merged_by, request_id),
  unique(removed_prospect_id)
);

alter table public.prospect_import_batches enable row level security;
alter table public.prospect_import_rows enable row level security;
alter table public.prospect_merges enable row level security;

create or replace function public.prospect_text_normalized(value text)
returns text language sql immutable set search_path='' as $$
  select nullif(regexp_replace(lower(btrim(coalesce(value,''))), '\s+', ' ', 'g'),'')
$$;

create or replace function public.prepare_prospect_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid := (select auth.uid()); territory_points integer; industry_points integer; recurring_points integer; contact_points integer; value_points integer; freshness_points integer;
begin
  if actor is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  new.company_name:=regexp_replace(btrim(new.company_name),'\s+',' ','g');
  new.contact_name:=nullif(regexp_replace(btrim(new.contact_name),'\s+',' ','g'),'');
  new.business_email:=nullif(lower(btrim(new.business_email)),'');
  new.business_phone:=nullif(regexp_replace(btrim(new.business_phone),'\s+',' ','g'),'');
  new.website:=nullif(btrim(new.website),'');
  new.address:=nullif(regexp_replace(btrim(new.address),'\s+',' ','g'),'');
  new.city:=nullif(regexp_replace(btrim(new.city),'\s+',' ','g'),''); new.state:=nullif(upper(btrim(new.state)),''); new.zip:=nullif(btrim(new.zip),'');
  new.email_normalized:=new.business_email; new.phone_normalized:=public.prospect_phone_normalized(new.business_phone);
  new.domain_normalized:=public.prospect_domain_normalized(coalesce(new.website,split_part(new.email_normalized,'@',2)));
  new.name_address_normalized:=public.prospect_text_normalized(new.company_name)||'|'||coalesce(public.prospect_text_normalized(new.address),'')||'|'||coalesce(public.prospect_text_normalized(new.zip),'');
  if new.assigned_user_id is not null and not exists(select 1 from public.user_profiles p where p.id=new.assigned_user_id and p.is_active and p.role='Sales') then raise exception 'Prospects may only be assigned to an active Sales user.' using errcode='23514'; end if;
  new.score:=public.prospect_score(new.territory,new.industry,new.recurring_potential,new.verification_status,new.email_normalized,new.phone_normalized,new.estimated_value,new.discovered_at);
  territory_points:=case lower(coalesce(new.territory,'')) when 'primary' then 20 when 'core' then 20 when 'local' then 20 when 'secondary' then 10 else 0 end; industry_points:=case when lower(coalesce(new.industry,'')) in ('office','property management','medical','restaurant','retail') then 15 else 5 end; recurring_points:=case when new.recurring_potential then 20 else 0 end; contact_points:=case when new.verification_status='Verified' and (new.email_normalized is not null or new.phone_normalized is not null) then 15 else 0 end; value_points:=case when coalesce(new.estimated_value,0)>=10000 then 20 when coalesce(new.estimated_value,0)>=5000 then 15 when coalesce(new.estimated_value,0)>=1000 then 10 else 0 end; freshness_points:=case when new.discovered_at>=now()-interval '30 days' then 10 when new.discovered_at>=now()-interval '90 days' then 5 else 0 end;
  new.score_explanation:=format('Territory %s; industry %s; recurring %s; verified contact %s; value %s; freshness %s.',territory_points,industry_points,recurring_points,contact_points,value_points,freshness_points);
  new.updated_by:=actor; new.updated_at:=now(); if tg_op='INSERT' then new.created_by:=actor; end if; return new;
end $$;

create function public.create_prospect_import_batch(p_request_id uuid,p_filename text,p_total_rows integer,p_assigned_user_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); batch_id uuid; management boolean:=public.has_any_role(array['Master Admin','Administrator','Manager']);
begin
  if actor is null or not (management or public.has_any_role(array['Sales'])) then raise exception 'Prospect import denied.' using errcode='42501'; end if;
  if p_total_rows<1 or p_total_rows>2000 or lower(p_filename) not like '%.csv' then raise exception 'Invalid CSV import metadata.'; end if;
  if management then
    if p_assigned_user_id is not null and not exists(select 1 from public.user_profiles p where p.id=p_assigned_user_id and p.is_active and p.role='Sales') then raise exception 'Invalid Sales assignee.'; end if;
  elsif p_assigned_user_id is distinct from actor then raise exception 'Sales imports must be self-assigned.' using errcode='42501'; end if;
  insert into public.prospect_import_batches(request_id,original_filename,assigned_user_id,total_rows,created_by) values(p_request_id,btrim(p_filename),p_assigned_user_id,p_total_rows,actor)
  on conflict(created_by,request_id) do update set request_id=excluded.request_id returning id into batch_id;
  return batch_id;
end $$;

create function public.import_prospect_batch_rows(p_batch_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); batch public.prospect_import_batches; item jsonb; values_json jsonb; row_no integer; fingerprint text; action text; classification text; matched uuid; created_id uuid; existing_row public.prospect_import_rows; imported integer; skipped integer; failed integer;
begin
  if actor is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>200 then raise exception 'Invalid import batch.'; end if;
  select * into batch from public.prospect_import_batches where id=p_batch_id for update;
  if not found or not (public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and batch.created_by=actor and batch.assigned_user_id=actor)) then raise exception 'Prospect import denied.' using errcode='42501'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    row_no:=(item->>'rowNumber')::integer; fingerprint:=item->>'fingerprint'; action:=item->>'decision'; classification:=item->>'classification'; matched:=nullif(item->>'matchedProspectId','')::uuid; values_json:=coalesce(item->'values','{}'::jsonb);
    select * into existing_row from public.prospect_import_rows where batch_id=p_batch_id and row_number=row_no;
    if found then continue; end if;
    begin
      if nullif(btrim(values_json->>'company_name'),'') is null then raise exception 'Business name is required.'; end if;
      if classification='Invalid' then raise exception '%',coalesce(item->>'error','Invalid row.'); end if;
      if action='Skip' then
        insert into public.prospect_import_rows(batch_id,row_number,row_fingerprint,disposition,duplicate_classification,decision,matched_prospect_id,normalized_snapshot) values(p_batch_id,row_no,fingerprint,'Skipped',classification,action,matched,values_json);
      elsif action='Merge' then
        if matched is null then raise exception 'A merge target is required.'; end if;
        if not exists(select 1 from public.prospects p where p.id=matched and p.merged_into_prospect_id is null and (public.has_any_role(array['Master Admin','Administrator','Manager']) or p.assigned_user_id=actor)) then raise exception 'Merge target is unavailable.' using errcode='42501'; end if;
        update public.prospects p set
          contact_name=coalesce(nullif(p.contact_name,''),nullif(values_json->>'contact_name','')), business_email=coalesce(nullif(p.business_email,''),nullif(values_json->>'business_email','')), business_phone=coalesce(nullif(p.business_phone,''),nullif(values_json->>'business_phone','')), website=coalesce(nullif(p.website,''),nullif(values_json->>'website','')), address=coalesce(nullif(p.address,''),nullif(values_json->>'address','')), city=coalesce(nullif(p.city,''),nullif(values_json->>'city','')), state=coalesce(nullif(p.state,''),nullif(values_json->>'state','')), zip=coalesce(nullif(p.zip,''),nullif(values_json->>'zip','')), industry=coalesce(nullif(p.industry,''),nullif(values_json->>'industry','')), notes=coalesce(nullif(p.notes,''),nullif(values_json->>'notes',''))
        where p.id=matched;
        insert into public.prospect_events(prospect_id,event_type,actor_user_id,details) values(matched,'Imported',actor,jsonb_build_object('batchId',p_batch_id,'rowNumber',row_no,'decision','Merge'));
        insert into public.prospect_import_rows(batch_id,row_number,row_fingerprint,disposition,duplicate_classification,decision,prospect_id,matched_prospect_id,normalized_snapshot) values(p_batch_id,row_no,fingerprint,'Merged',classification,action,matched,matched,values_json);
      else
        insert into public.prospects(company_name,contact_name,business_email,business_phone,website,address,city,state,zip,industry,notes,source_type,assigned_user_id)
        values(values_json->>'company_name',values_json->>'contact_name',values_json->>'business_email',values_json->>'business_phone',values_json->>'website',values_json->>'address',values_json->>'city',values_json->>'state',values_json->>'zip',values_json->>'industry',values_json->>'notes',coalesce(nullif(values_json->>'source',''),'CSV Import'),batch.assigned_user_id) returning id into created_id;
        insert into public.prospect_events(prospect_id,event_type,actor_user_id,details) values(created_id,'Imported',actor,jsonb_build_object('batchId',p_batch_id,'rowNumber',row_no,'filename',batch.original_filename));
        insert into public.prospect_import_rows(batch_id,row_number,row_fingerprint,disposition,duplicate_classification,decision,prospect_id,matched_prospect_id,normalized_snapshot) values(p_batch_id,row_no,fingerprint,'Imported',classification,'Import Separately',created_id,matched,values_json);
      end if;
    exception when others then
      insert into public.prospect_import_rows(batch_id,row_number,row_fingerprint,disposition,duplicate_classification,decision,matched_prospect_id,error_message,normalized_snapshot) values(p_batch_id,row_no,fingerprint,'Failed',coalesce(classification,'Invalid'),coalesce(action,'Skip'),matched,sqlerrm,values_json) on conflict do nothing;
    end;
  end loop;
  select count(*) filter(where disposition in ('Imported','Merged')),count(*) filter(where disposition='Skipped'),count(*) filter(where disposition='Failed') into imported,skipped,failed from public.prospect_import_rows where batch_id=p_batch_id;
  update public.prospect_import_batches set imported_rows=imported,skipped_rows=skipped,failed_rows=failed,status=case when imported+skipped+failed>=total_rows then case when failed>0 then 'Completed with errors' else 'Completed' end else 'Processing' end,completed_at=case when imported+skipped+failed>=total_rows then now() end where id=p_batch_id;
  return jsonb_build_object('imported',imported,'skipped',skipped,'failed',failed,'processed',imported+skipped+failed);
end $$;

create function public.merge_prospects(p_survivor_id uuid,p_removed_id uuid,p_field_decisions jsonb,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); survivor public.prospects; removed public.prospects; merge_id uuid; management boolean:=public.has_any_role(array['Master Admin','Administrator','Manager']);
begin
  if actor is null or p_survivor_id=p_removed_id then raise exception 'Invalid prospect merge.'; end if;
  select id into merge_id from public.prospect_merges where merged_by=actor and request_id=p_request_id; if found then return merge_id; end if;
  perform 1 from public.prospects where id in(p_survivor_id,p_removed_id) order by id for update;
  select * into survivor from public.prospects where id=p_survivor_id; select * into removed from public.prospects where id=p_removed_id;
  if survivor.id is null or removed.id is null or survivor.merged_into_prospect_id is not null or removed.merged_into_prospect_id is not null then raise exception 'Prospect is missing or already merged.'; end if;
  if not (management or (public.has_any_role(array['Sales']) and survivor.assigned_user_id=actor and removed.assigned_user_id=actor)) then raise exception 'Prospect merge denied.' using errcode='42501'; end if;
  update public.prospects set
    contact_name=case when nullif(survivor.contact_name,'') is null or p_field_decisions->>'contact_name'='removed' then coalesce(nullif(removed.contact_name,''),survivor.contact_name) else survivor.contact_name end,
    business_email=case when nullif(survivor.business_email,'') is null or p_field_decisions->>'business_email'='removed' then coalesce(nullif(removed.business_email,''),survivor.business_email) else survivor.business_email end,
    business_phone=case when nullif(survivor.business_phone,'') is null or p_field_decisions->>'business_phone'='removed' then coalesce(nullif(removed.business_phone,''),survivor.business_phone) else survivor.business_phone end,
    website=case when nullif(survivor.website,'') is null or p_field_decisions->>'website'='removed' then coalesce(nullif(removed.website,''),survivor.website) else survivor.website end,
    address=case when nullif(survivor.address,'') is null or p_field_decisions->>'address'='removed' then coalesce(nullif(removed.address,''),survivor.address) else survivor.address end,
    notes=case when nullif(survivor.notes,'') is null then removed.notes when nullif(removed.notes,'') is null then survivor.notes else survivor.notes||E'\n\nMerged notes: '||removed.notes end,
    services=(select array(select distinct unnest(coalesce(survivor.services,'{}')||coalesce(removed.services,'{}'))))
  where id=p_survivor_id;
  update public.prospect_events set details=details||jsonb_build_object('originalProspectId',p_removed_id),prospect_id=p_survivor_id where prospect_id=p_removed_id;
  update public.prospect_import_rows set prospect_id=p_survivor_id where prospect_id=p_removed_id; update public.prospect_import_rows set matched_prospect_id=p_survivor_id where matched_prospect_id=p_removed_id;
  update public.prospects set merged_into_prospect_id=p_survivor_id,merged_at=now(),merged_by=actor where id=p_removed_id;
  insert into public.prospect_merges(request_id,survivor_prospect_id,removed_prospect_id,field_decisions,survivor_snapshot,removed_snapshot,merged_by) values(p_request_id,p_survivor_id,p_removed_id,coalesce(p_field_decisions,'{}'),to_jsonb(survivor),to_jsonb(removed),actor) returning id into merge_id;
  insert into public.prospect_events(prospect_id,event_type,actor_user_id,details) values(p_survivor_id,'Merged',actor,jsonb_build_object('mergeId',merge_id,'removedProspectId',p_removed_id,'fieldDecisions',coalesce(p_field_decisions,'{}')));
  return merge_id;
end $$;

create policy "Importers read batches" on public.prospect_import_batches for select to authenticated using(public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and created_by=(select auth.uid()) and assigned_user_id=(select auth.uid())));
create policy "Importers read rows" on public.prospect_import_rows for select to authenticated using(exists(select 1 from public.prospect_import_batches b where b.id=batch_id and (public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and b.created_by=(select auth.uid()) and b.assigned_user_id=(select auth.uid())))));
create policy "Authorized users read merges" on public.prospect_merges for select to authenticated using(public.has_any_role(array['Master Admin','Administrator','Manager']) or (public.has_any_role(array['Sales']) and exists(select 1 from public.prospects p where p.id=survivor_prospect_id and p.assigned_user_id=(select auth.uid()))));

revoke all on table public.prospect_import_batches,public.prospect_import_rows,public.prospect_merges from public,anon,authenticated;
grant select on table public.prospect_import_batches,public.prospect_import_rows,public.prospect_merges to authenticated;
revoke all on function public.prospect_text_normalized(text),public.create_prospect_import_batch(uuid,text,integer,uuid),public.import_prospect_batch_rows(uuid,jsonb),public.merge_prospects(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_prospect_import_batch(uuid,text,integer,uuid),public.import_prospect_batch_rows(uuid,jsonb),public.merge_prospects(uuid,uuid,jsonb,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
