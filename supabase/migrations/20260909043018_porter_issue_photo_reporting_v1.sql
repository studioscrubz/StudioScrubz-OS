-- Review/apply separately after Porter Visits V1. No public URLs or client delivery.
begin;
create table public.property_service_visit_issues (
 id uuid primary key default gen_random_uuid(),
 visit_id uuid not null references public.property_service_visits(id),
 visit_area_id uuid references public.property_service_visit_areas(id),
 category text not null check(category in ('Maintenance','Safety','Damage','Cleanliness','Grounds','Trash Area','Access','Pool Area','Other')),
 severity text not null check(severity in ('Low','Medium','High','Urgent')),
 title text not null check(length(btrim(title))>0), description text,
 status text not null default 'Open' check(status in ('Open','Acknowledged','Resolved')),
 reported_by uuid references public.user_profiles(id) on delete set null,
 reporter_name text,
 reported_at timestamptz not null default now(), resolved_at timestamptz, resolution_notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.property_service_visit_photos (
 id uuid primary key default gen_random_uuid(),
 visit_id uuid not null references public.property_service_visits(id),
 visit_area_id uuid references public.property_service_visit_areas(id),
 issue_id uuid references public.property_service_visit_issues(id),
 storage_path text not null unique, file_name text, mime_type text not null,
 file_size_bytes bigint not null check(file_size_bytes>0 and file_size_bytes<=10485760),
 caption text, uploaded_by uuid references public.user_profiles(id) on delete set null,
 created_at timestamptz not null default now(), archived_at timestamptz,
 check(mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif'))
);
create index on public.property_service_visit_issues(visit_id,status);
create index on public.property_service_visit_issues(visit_area_id);
create index on public.property_service_visit_issues(reported_by);
create index on public.property_service_visit_photos(visit_id,visit_area_id) where archived_at is null;
create index on public.property_service_visit_photos(visit_area_id);
create index on public.property_service_visit_photos(issue_id);
create index on public.property_service_visit_photos(uploaded_by);
alter table public.property_service_visit_issues enable row level security;
alter table public.property_service_visit_photos enable row level security;
revoke all on public.property_service_visit_issues,public.property_service_visit_photos from public,anon,authenticated;
grant select on public.property_service_visit_issues,public.property_service_visit_photos to authenticated;
create policy "Porter issue parent read" on public.property_service_visit_issues for select to authenticated
 using(exists(select 1 from public.property_service_visits v where v.id=visit_id));
create policy "Porter photo parent read" on public.property_service_visit_photos for select to authenticated
 using(exists(select 1 from public.property_service_visits v where v.id=visit_id));

-- Existing bucket is private. Fail closed if its expected configuration differs.
do $$ begin
 if not exists(select 1 from storage.buckets where id='operational-photos' and public=false and file_size_limit between 1 and 10485760
 and allowed_mime_types is not null and cardinality(allowed_mime_types)>0
 and allowed_mime_types <@ array['image/jpeg','image/png','image/webp','image/heic','image/heif']) then
  raise exception 'A private operational-photos bucket is required.'; end if;
end $$;
create function public.can_access_porter_photo_path(p_name text,p_write boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare v public.property_service_visits; parts text[]:=string_to_array(p_name,'/');
begin
 if auth.uid() is null or p_name !~ '^porter-visits/[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|png|webp|heic|heif)$' then return false; end if;
 -- UUID casts reject malformed paths; exact canonical string check prevents aliases.
 if parts[2]<>(parts[2]::uuid)::text or split_part(parts[3],'.',1)<>(split_part(parts[3],'.',1)::uuid)::text then return false; end if;
 if p_write then select * into v from public.property_service_visits where id=parts[2]::uuid for share;
 else select * into v from public.property_service_visits where id=parts[2]::uuid; end if;
 return found and public.can_access_porter_visit(v.assigned_crew_id) and (not p_write or v.status in ('Scheduled','In Progress'));
exception when invalid_text_representation then return false;
end $$;
revoke all on function public.can_access_porter_photo_path(text,boolean) from public,anon,authenticated;
grant execute on function public.can_access_porter_photo_path(text,boolean) to authenticated;
create policy "Porter evidence read" on storage.objects for select to authenticated
 using(bucket_id='operational-photos' and public.can_access_porter_photo_path(name,false));
create policy "Porter evidence upload" on storage.objects for insert to authenticated
 with check(bucket_id='operational-photos' and owner_id=auth.uid()::text and public.can_access_porter_photo_path(name,true));
-- Serialize cleanup against metadata registration; never delete registered evidence.
create function public.can_cleanup_porter_photo(p_name text) returns boolean
language plpgsql security definer set search_path='' as $$
declare v public.property_service_visits;
begin
 if auth.uid() is null or not public.can_access_porter_photo_path(p_name,false) then return false; end if;
 select * into v from public.property_service_visits where id=split_part(p_name,'/',2)::uuid for update;
 return found and public.can_access_porter_visit(v.assigned_crew_id)
  and not exists(select 1 from public.property_service_visit_photos p where p.storage_path=p_name);
end $$;
revoke all on function public.can_cleanup_porter_photo(text) from public,anon,authenticated;
grant execute on function public.can_cleanup_porter_photo(text) to authenticated;
-- Cleanup only for uploader-owned unattached objects, even if the visit closed meanwhile.
create policy "Porter unattached upload cleanup" on storage.objects for delete to authenticated
 using(bucket_id='operational-photos' and owner_id=auth.uid()::text and public.can_cleanup_porter_photo(name));
-- Prevent overwrite/deletion of evidence through any other permissive bucket policy.
create policy "Porter evidence immutable object" on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'operational-photos' or name not like 'porter-visits/%')
 with check(bucket_id<>'operational-photos' or name not like 'porter-visits/%');
create policy "Porter evidence retained object" on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'operational-photos' or name not like 'porter-visits/%' or
 (owner_id=auth.uid()::text and public.can_cleanup_porter_photo(name)));

create function public.add_porter_visit_photo(p_visit_id uuid,p_visit_area_id uuid,p_issue_id uuid,p_storage_path text,p_file_name text,p_caption text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.property_service_visits; i public.property_service_visit_issues; metadata jsonb; photo_id uuid; stamp timestamptz;
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;
 select * into v from public.property_service_visits where id=p_visit_id for update;
 if not found or not public.can_access_porter_visit(v.assigned_crew_id) then raise exception 'Porter Visit access denied.' using errcode='42501'; end if;
 if v.status not in ('Scheduled','In Progress') then raise exception 'Historical visits cannot receive new evidence.'; end if;
 if p_visit_area_id is not null and not exists(select 1 from public.property_service_visit_areas where id=p_visit_area_id and visit_id=v.id) then raise exception 'Area does not belong to this visit.'; end if;
 if p_issue_id is not null then
  select * into i from public.property_service_visit_issues where id=p_issue_id and visit_id=v.id;
  if not found or i.visit_area_id is distinct from p_visit_area_id then raise exception 'Issue/area does not belong to this visit or evidence area.'; end if;
 end if;
 if split_part(p_storage_path,'/',2) is distinct from v.id::text or not public.can_access_porter_photo_path(p_storage_path,false) then raise exception 'Invalid Porter photo path.'; end if;
 select o.metadata into metadata from storage.objects o where o.bucket_id='operational-photos' and o.name=p_storage_path and o.owner_id=auth.uid()::text for share;
 if not found then raise exception 'Uploaded photo not found for this user.'; end if;
 if coalesce(metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp','image/heic','image/heif')
 or coalesce((metadata->>'size')::bigint,0) not between 1 and 10485760 then raise exception 'Photo must be a supported image up to 10 MB.'; end if;
 insert into public.property_service_visit_photos(visit_id,visit_area_id,issue_id,storage_path,file_name,mime_type,file_size_bytes,caption,uploaded_by)
 values(v.id,p_visit_area_id,p_issue_id,p_storage_path,left(p_file_name,255),metadata->>'mimetype',(metadata->>'size')::bigint,nullif(btrim(p_caption),''),auth.uid()) returning id into photo_id;
 stamp:=greatest(clock_timestamp(),v.updated_at+interval '1 microsecond');
 update public.property_service_visits set updated_at=stamp where id=v.id;
 return photo_id;
end $$;
revoke all on function public.add_porter_visit_photo(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.add_porter_visit_photo(uuid,uuid,uuid,text,text,text) to authenticated;

create function public.save_porter_visit_issue(p_visit_id uuid,p_issue_id uuid,p_expected_updated_at timestamptz,p_action text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.property_service_visits; i public.property_service_visit_issues; manager boolean; stamp timestamptz; area_id uuid; reporter text;
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;
 select * into v from public.property_service_visits where id=p_visit_id for update;
 if not found or not public.can_access_porter_visit(v.assigned_crew_id) then raise exception 'Porter Visit access denied.' using errcode='42501'; end if;
 manager:=public.has_any_role(array['Master Admin','Administrator','Manager']);
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid issue data.'; end if;
 if p_issue_id is not null then
  select * into i from public.property_service_visit_issues where id=p_issue_id and visit_id=v.id for update;
  if not found then raise exception 'Issue does not belong to this visit.'; end if;
  if i.updated_at is distinct from p_expected_updated_at then raise exception 'Issue changed. Refresh before saving.' using errcode='40001'; end if;
 end if;
 stamp:=greatest(clock_timestamp(),coalesce(i.updated_at,v.updated_at)+interval '1 microsecond',v.updated_at+interval '1 microsecond');
 if p_action in ('acknowledge','resolve') then
  if not manager then raise exception 'Only management may acknowledge or resolve issues.' using errcode='42501'; end if;
  if i.id is null or i.status='Resolved' then raise exception 'Issue is missing or already Resolved.'; end if;
  if p_action='acknowledge' and i.status<>'Open' then raise exception 'Only Open issues can be acknowledged.'; end if;
  update public.property_service_visit_issues set status=case when p_action='resolve' then 'Resolved' else 'Acknowledged' end,
   resolution_notes=nullif(btrim(p_data->>'resolution_notes'),''),resolved_at=case when p_action='resolve' then stamp else null end,updated_at=stamp where id=i.id;
 elsif p_action in ('report','edit') then
  if v.status<>'In Progress' then raise exception 'Issues can only be reported or edited while the visit is In Progress.'; end if;
  if p_action='report' then
   if p_issue_id is not null then raise exception 'New issues cannot replace existing issues.'; end if;
   area_id:=nullif(p_data->>'visit_area_id','')::uuid;
   if area_id is not null and not exists(select 1 from public.property_service_visit_areas where id=area_id and visit_id=v.id) then raise exception 'Area does not belong to this visit.'; end if;
   select display_name into reporter from public.user_profiles where id=auth.uid();
   insert into public.property_service_visit_issues(visit_id,visit_area_id,category,severity,title,description,reported_by,reporter_name)
   values(v.id,area_id,p_data->>'category',p_data->>'severity',btrim(p_data->>'title'),nullif(btrim(p_data->>'description'),''),auth.uid(),reporter) returning * into i;
  else
   if i.id is null or i.status='Resolved' or (not manager and i.reported_by is distinct from auth.uid()) then raise exception 'Only the reporter or management may edit an unresolved issue.' using errcode='42501'; end if;
   -- Operational edits cannot reparent an issue or change management disposition.
   update public.property_service_visit_issues set category=p_data->>'category',severity=p_data->>'severity',title=btrim(p_data->>'title'),
    description=nullif(btrim(p_data->>'description'),''),updated_at=stamp where id=i.id;
  end if;
 else raise exception 'Unsupported issue action.';
 end if;
 -- Closed visit history is untouched by the management disposition exception.
 if v.status in ('Scheduled','In Progress') then update public.property_service_visits set updated_at=stamp where id=v.id; end if;
 return i.id;
end $$;
revoke all on function public.save_porter_visit_issue(uuid,uuid,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_porter_visit_issue(uuid,uuid,timestamptz,text,jsonb) to authenticated;

create or replace function public.get_porter_visits(p_id uuid default null) returns setof jsonb
language sql stable security definer set search_path = '' as $$
 select to_jsonb(v) || jsonb_build_object('photos',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at,p.id) from public.property_service_visit_photos p where p.visit_id=v.id and p.archived_at is null),'[]'::jsonb),'issues',coalesce((select jsonb_agg(to_jsonb(i) order by i.reported_at desc,i.id) from public.property_service_visit_issues i where i.visit_id=v.id),'[]'::jsonb),'crew_name',c.crew_name,'areas',coalesce(
 (select jsonb_agg(to_jsonb(a) order by a.sort_order,a.id) from public.property_service_visit_areas a where a.visit_id=v.id),'[]'::jsonb))
 from public.property_service_visits v left join public.crews c on c.id=v.assigned_crew_id
 where (p_id is null or v.id=p_id) and public.can_access_porter_visit(v.assigned_crew_id)
 order by v.scheduled_date desc,v.created_at desc
$$;

create or replace function public.mutate_porter_visit(p_id uuid,p_expected_updated_at timestamptz,p_action text,p_data jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.property_service_visits; v_now timestamptz; v_manager boolean; v_status text; v_area uuid; v_crew uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;
 select * into v from public.property_service_visits where id=p_id for update;
 if not found or not public.can_access_porter_visit(v.assigned_crew_id) then raise exception 'Porter Visit not found or access denied.' using errcode='42501'; end if;
 if v.updated_at is distinct from p_expected_updated_at then raise exception 'Visit changed. Refresh and reopen it before saving.' using errcode='40001'; end if;
 if v.status in ('Completed','Cancelled') then raise exception 'Completed and Cancelled visits are read-only.'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid visit update.'; end if;
 v_manager:=public.has_any_role(array['Master Admin','Administrator','Manager']);
 v_now:=greatest(clock_timestamp(),v.updated_at+interval '1 microsecond');
 case p_action
 when 'edit' then
  if not v_manager or v.status<>'Scheduled' then raise exception 'Only management may edit a Scheduled visit.' using errcode='42501'; end if;
  if nullif(p_data->>'scheduled_date','') is null then raise exception 'Scheduled date is required.'; end if;
  v_crew:=nullif(p_data->>'assigned_crew_id','')::uuid;
  if v_crew is not null and not exists(select 1 from public.crews where id=v_crew and status='Active' and archived_at is null) then raise exception 'Select an active crew.'; end if;
  update public.property_service_visits set scheduled_date=(p_data->>'scheduled_date')::date,assigned_crew_id=v_crew,
   visit_notes=nullif(btrim(p_data->>'visit_notes'),'') where id=p_id;
 when 'notes' then
  update public.property_service_visits set visit_notes=nullif(btrim(p_data->>'visit_notes'),'') where id=p_id;
 when 'start' then
  if v.status<>'Scheduled' then raise exception 'Only Scheduled visits can start.'; end if;
  update public.property_service_visits set status='In Progress',started_at=coalesce(started_at,v_now) where id=p_id;
 when 'cancel' then
  if not v_manager then raise exception 'Only management may cancel visits.' using errcode='42501'; end if;
  update public.property_service_visits set status='Cancelled',cancelled_at=coalesce(cancelled_at,v_now) where id=p_id;
 when 'complete' then
  if v.status<>'In Progress' then raise exception 'Start the visit before completing it.'; end if;
  if exists(select 1 from public.property_service_visit_areas where visit_id=p_id and is_required and status='Pending') then
   raise exception 'Resolve all required Pending service areas before completing.'; end if;
  if exists(select 1 from public.property_service_visit_areas a where a.visit_id=p_id and a.is_required and a.requires_photo
    and (a.status='Pending' or not exists(select 1 from public.property_service_visit_photos p where p.visit_id=p_id and p.visit_area_id=a.id and p.archived_at is null))) then
   raise exception 'Add required photo evidence and resolve all required-photo service areas before completing this visit.'; end if;
  update public.property_service_visits set status='Completed',completed_at=coalesce(completed_at,v_now) where id=p_id;
 when 'area' then
  if v.status<>'In Progress' then raise exception 'Start the visit before updating service areas.'; end if;
  v_area:=(p_data->>'area_id')::uuid; v_status:=p_data->>'status';
  if v_status is null or v_status not in ('Pending','Completed','Unable to Complete') then raise exception 'Invalid service area status.'; end if;
  update public.property_service_visit_areas set status=v_status,notes=nullif(btrim(p_data->>'notes'),''),
   completed_at=case when v_status='Completed' then coalesce(completed_at,v_now) else null end,updated_at=v_now
   where id=v_area and visit_id=p_id;
  if not found then raise exception 'Service area does not belong to this visit.'; end if;
 else raise exception 'Unsupported Porter Visit action.';
 end case;
 update public.property_service_visits set updated_at=v_now where id=p_id;
 return p_id;
end;
$$;

-- Reuse the existing shared realtime channel. No separate notification system.
do $$ declare t text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['property_service_visits','property_service_visit_photos','property_service_visit_issues'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
    execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
  end loop;
 end if;
end $$;
commit;
