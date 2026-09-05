begin;

create table public.job_evidence (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  scope_snapshot_id uuid references public.scope_snapshots(id),
  change_request_id uuid references public.change_requests(id),
  field_discovery_id uuid references public.field_discoveries(id),
  evidence_type text not null,
  area text,
  description text,
  captured_by uuid references public.user_profiles(id),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint job_evidence_type_check check (evidence_type in ('Before','During','After','Completion','Issue','Other'))
);
create index job_evidence_job_captured_idx on public.job_evidence(job_id, captured_at);

create table public.job_evidence_media (
  id uuid primary key default gen_random_uuid(),
  job_evidence_id uuid not null references public.job_evidence(id) on delete restrict,
  storage_path text not null unique,
  media_type text,
  created_at timestamptz not null default now()
);
create index job_evidence_media_evidence_idx on public.job_evidence_media(job_evidence_id, created_at);

alter table public.job_evidence enable row level security;
alter table public.job_evidence_media enable row level security;
revoke all on table public.job_evidence from public,anon,authenticated;
revoke all on table public.job_evidence_media from public,anon,authenticated;
grant select on table public.job_evidence, public.job_evidence_media to authenticated;
grant select on table public.job_evidence, public.job_evidence_media to service_role;
create policy "Active users read Job evidence" on public.job_evidence for select to authenticated using (public.has_any_role(array['Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician']));
create policy "Active users read Job evidence media" on public.job_evidence_media for select to authenticated using (public.has_any_role(array['Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician']));

create view public.scope_snapshots_operational with (security_barrier = true) as
select id,job_id,version,snapshot_type,accepted_at,created_at from public.scope_snapshots
where public.has_any_role(array['Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician']);
revoke all on table public.scope_snapshots_operational from public,anon,authenticated;
grant select on table public.scope_snapshots_operational to authenticated;

create view public.change_request_approvals_operational with (security_barrier = true) as
select id,change_request_id,decision,decided_at from public.change_request_approvals
where public.has_any_role(array['Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician']);
revoke all on table public.change_request_approvals_operational from public,anon,authenticated;
grant select on table public.change_request_approvals_operational to authenticated;

create or replace function public.create_job_evidence(
  p_job_id uuid, p_evidence_type text, p_area text default null, p_description text default null,
  p_change_request_id uuid default null, p_field_discovery_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_role text; v_id uuid; v_snapshot_id uuid;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  v_role:=public.current_user_role();
  if v_role not in ('Master Admin','Administrator','Manager','Crew Lead','Scrub Technician') then raise exception 'Job evidence creation permission denied.'; end if;
  if not public.can_write_operational_photo_record('jobs',p_job_id) then raise exception 'Job not found or outside your permitted scope.'; end if;
  if p_evidence_type not in ('Before','During','After','Completion','Issue','Other') then raise exception 'Invalid evidence type.'; end if;
  if p_change_request_id is not null and not exists(select 1 from public.change_requests where id=p_change_request_id and job_id=p_job_id and status='Approved') then raise exception 'Evidence may only link an Approved Change Request belonging to this Job.'; end if;
  if p_field_discovery_id is not null and not exists(select 1 from public.field_discoveries where id=p_field_discovery_id and job_id=p_job_id) then raise exception 'Field Discovery does not belong to this Job.'; end if;
  select id into v_snapshot_id from public.scope_snapshots where job_id=p_job_id and version=1 limit 1;
  insert into public.job_evidence(job_id,scope_snapshot_id,change_request_id,field_discovery_id,evidence_type,area,description,captured_by)
  values(p_job_id,v_snapshot_id,p_change_request_id,p_field_discovery_id,p_evidence_type,nullif(btrim(coalesce(p_area,'')),''),nullif(btrim(coalesce(p_description,'')),''),auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.is_valid_job_evidence_media_path(p_job_id uuid,p_evidence_id uuid,p_name text)
returns boolean language sql immutable security invoker set search_path='' as $$
  select p_name ~ ('^jobs/'||p_job_id::text||'/evidence/'||p_evidence_id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif)$');
$$;
revoke all on function public.is_valid_job_evidence_media_path(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.add_job_evidence_media(p_job_evidence_id uuid,p_storage_path text,p_media_type text default null)
returns public.job_evidence_media language plpgsql security definer set search_path='' as $$
declare v_role text; v_evidence public.job_evidence; v_media public.job_evidence_media; v_metadata jsonb;
begin
  if auth.uid() is null then raise exception 'An active authenticated profile is required.'; end if;
  v_role:=public.current_user_role();
  if v_role not in ('Master Admin','Administrator','Manager','Crew Lead','Scrub Technician') then raise exception 'Job evidence media permission denied.'; end if;
  select * into v_evidence from public.job_evidence where id=p_job_evidence_id;
  if not found or not public.can_write_operational_photo_record('jobs',v_evidence.job_id) then raise exception 'Job evidence not found or outside your permitted scope.'; end if;
  if not public.is_valid_job_evidence_media_path(v_evidence.job_id,v_evidence.id,p_storage_path) then raise exception 'Invalid Job evidence media path.'; end if;
  select metadata into v_metadata from storage.objects where bucket_id='operational-photos' and name=p_storage_path and owner_id=auth.uid()::text;
  if not found then raise exception 'Uploaded Job evidence media was not found.'; end if;
  if lower(coalesce(v_metadata->>'mimetype',p_media_type,'')) not in ('image/jpeg','image/png','image/webp','image/heic','image/heif') then raise exception 'Unsupported Job evidence media type.'; end if;
  insert into public.job_evidence_media(job_evidence_id,storage_path,media_type) values(v_evidence.id,p_storage_path,nullif(lower(coalesce(p_media_type,v_metadata->>'mimetype','')),'')) returning * into v_media;
  return v_media;
end;
$$;

revoke all on function public.create_job_evidence(uuid,text,text,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.add_job_evidence_media(uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_job_evidence(uuid,text,text,text,uuid,uuid) to authenticated;
grant execute on function public.add_job_evidence_media(uuid,text,text) to authenticated;

create or replace function public.is_valid_operational_photo_path(p_record_type text,p_record_id uuid,p_name text)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v_parts text[]:=string_to_array(p_name,'/');v_filename text;
begin
  if p_record_type not in ('walkthroughs','jobs') or v_parts[1] is distinct from p_record_type or v_parts[2] is distinct from p_record_id::text then return false;end if;
  if p_record_type='walkthroughs' then if array_length(v_parts,1)<>3 then return false;end if;v_filename:=v_parts[3];
  elsif array_length(v_parts,1)=4 and v_parts[3] in ('before','after','damage','other') then v_filename:=v_parts[4];
  elsif array_length(v_parts,1)=5 and v_parts[3] in ('discoveries','evidence') and v_parts[4]~'^[0-9a-f-]{36}$' then v_filename:=v_parts[5];
  else return false;end if;
  return v_filename~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif)$';
end;
$$;

create or replace function public.can_read_operational_photo_path(p_name text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_parts text[]:=string_to_array(p_name,'/');v_job_id uuid;v_related_id uuid;
begin
  if array_length(v_parts,1)=5 and v_parts[1]='jobs' and v_parts[3] in ('discoveries','evidence') then
    v_job_id:=v_parts[2]::uuid;v_related_id:=v_parts[4]::uuid;
    return public.is_valid_operational_photo_path('jobs',v_job_id,p_name) and public.has_any_role(array['Master Admin','Administrator','Manager','Sales','Crew Lead','Scrub Technician']) and
      case when v_parts[3]='discoveries' then exists(select 1 from public.field_discoveries where id=v_related_id and job_id=v_job_id) else exists(select 1 from public.job_evidence where id=v_related_id and job_id=v_job_id) end;
  end if;
  if array_length(v_parts,1) not in (3,4) or v_parts[1] not in ('walkthroughs','jobs') then return false;end if;v_job_id:=v_parts[2]::uuid;
  return public.is_valid_operational_photo_path(v_parts[1],v_job_id,p_name) and public.can_read_operational_photo_record(v_parts[1],v_job_id);
exception when invalid_text_representation then return false;end;
$$;

create or replace function public.can_write_operational_photo_path(p_name text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_parts text[]:=string_to_array(p_name,'/');v_job_id uuid;v_related_id uuid;
begin
  if array_length(v_parts,1)=5 and v_parts[1]='jobs' and v_parts[3] in ('discoveries','evidence') then
    v_job_id:=v_parts[2]::uuid;v_related_id:=v_parts[4]::uuid;
    return public.is_valid_operational_photo_path('jobs',v_job_id,p_name) and public.can_write_operational_photo_record('jobs',v_job_id) and
      case when v_parts[3]='discoveries' then exists(select 1 from public.field_discoveries where id=v_related_id and job_id=v_job_id) else exists(select 1 from public.job_evidence where id=v_related_id and job_id=v_job_id) end;
  end if;
  if array_length(v_parts,1) not in (3,4) or v_parts[1] not in ('walkthroughs','jobs') then return false;end if;v_job_id:=v_parts[2]::uuid;
  return public.is_valid_operational_photo_path(v_parts[1],v_job_id,p_name) and public.can_write_operational_photo_record(v_parts[1],v_job_id);
exception when invalid_text_representation then return false;end;
$$;

revoke all on function public.is_valid_operational_photo_path(text,uuid,text) from public,anon,authenticated;
revoke all on function public.can_read_operational_photo_path(text),public.can_write_operational_photo_path(text) from public,anon,authenticated;
grant execute on function public.can_read_operational_photo_path(text),public.can_write_operational_photo_path(text) to authenticated;
notify pgrst,'reload schema';
commit;
