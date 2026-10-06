begin;

create table public.job_quality_inspections (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete restrict,
  inspector_employee_id uuid not null references public.employees(id), inspection_status text not null default 'Draft' check (inspection_status in ('Draft','Finalized')),
  inspected_at timestamptz, overall_notes text, created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(), finalized_at timestamptz, finalized_by uuid references public.user_profiles(id)
);
create table public.job_quality_inspection_items (
  id uuid primary key default gen_random_uuid(), inspection_id uuid not null references public.job_quality_inspections(id) on delete restrict,
  category text not null check (category in ('Scope Completion','Surface Cleanliness','Floors','Bathrooms','Kitchen / Break Area','Dust / Detail Work','Trash / Debris Removal','Final Presentation','Other')),
  result text not null check (result in ('Pass','Needs Attention','Fail','Not Applicable')),
  severity text check (severity in ('Minor','Moderate','Major')),
  notes text, created_at timestamptz not null default now(),
  check ((result in ('Needs Attention','Fail') and severity is not null) or (result in ('Pass','Not Applicable') and severity is null)), unique(inspection_id,category)
);
create table public.job_quality_callbacks (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete restrict,
  source text not null check (source in ('Customer','Management Inspection','Internal Quality Review','Other')),
  severity text not null check (severity in ('Minor','Moderate','Major')), category text not null, notes text,
  status text not null default 'Open' check (status in ('Open','Resolved','Invalid / Not Attributable')),
  attribution text not null default 'Unreviewed' check (attribution in ('Unreviewed','Job Quality Attributable','Not Employee Attributable')),
  reported_at timestamptz not null default now(), resolved_at timestamptz, created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now()
);
create table public.job_quality_callback_events (
  id uuid primary key default gen_random_uuid(), callback_id uuid not null references public.job_quality_callbacks(id) on delete restrict,
  event_type text not null check (event_type in ('Created','Status Changed','Attribution Changed','Note Added')),
  previous_status text, new_status text, previous_attribution text, new_attribution text, reason text not null,
  actor_user_id uuid not null references public.user_profiles(id), occurred_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.job_scope_completion_records (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete restrict,
  scope_snapshot_id uuid references public.scope_snapshots(id) on delete restrict,
  result text not null check (result in ('Complete','Partially Complete','Not Complete','Not Applicable')),
  attribution text not null check (attribution in ('Not Applicable','Job Execution','Approved / External Circumstance')),
  explanation text, finalized_by uuid not null references public.user_profiles(id), finalized_at timestamptz not null default now(), created_at timestamptz not null default now(),
  check ((result in ('Partially Complete','Not Complete') and nullif(btrim(explanation),'') is not null) or result in ('Complete','Not Applicable'))
);
create table public.job_customer_feedback (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete restrict,
  rating integer not null check (rating between 1 and 5), feedback text,
  source text not null check (source in ('Direct Customer','Follow-Up','Survey','Public Review','Other')),
  received_at timestamptz not null, recorded_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now()
);
create table public.job_quality_evidence_links (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete restrict,
  evidence_type text not null check (evidence_type in ('Inspection','Callback','Scope Completion','Customer Feedback')),
  evidence_record_id uuid not null, job_evidence_id uuid not null references public.job_evidence(id) on delete restrict,
  created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(), unique(evidence_type,evidence_record_id,job_evidence_id)
);

create index job_quality_inspections_job_idx on public.job_quality_inspections(job_id,created_at desc);
create index job_quality_callbacks_job_idx on public.job_quality_callbacks(job_id,reported_at desc);
create index job_scope_completion_job_idx on public.job_scope_completion_records(job_id,finalized_at desc);
create index job_customer_feedback_job_idx on public.job_customer_feedback(job_id,received_at desc);

alter table public.job_quality_inspections enable row level security; alter table public.job_quality_inspection_items enable row level security;
alter table public.job_quality_callbacks enable row level security; alter table public.job_quality_callback_events enable row level security;
alter table public.job_scope_completion_records enable row level security; alter table public.job_customer_feedback enable row level security; alter table public.job_quality_evidence_links enable row level security;
revoke all on public.job_quality_inspections,public.job_quality_inspection_items,public.job_quality_callbacks,public.job_quality_callback_events,public.job_scope_completion_records,public.job_customer_feedback,public.job_quality_evidence_links from public,anon,authenticated;
grant select on public.job_quality_inspections,public.job_quality_inspection_items,public.job_quality_callbacks,public.job_quality_callback_events,public.job_scope_completion_records,public.job_customer_feedback,public.job_quality_evidence_links to authenticated,service_role;

create function public.can_read_job_quality(p_job_id uuid,p_finalized_only boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.jobs j where j.id=p_job_id and j.archived_at is null and public.can_access_job_assignment(j.assigned_employee_id,j.assigned_crew_id))
$$;
create function public.can_manage_job_quality(p_job_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.has_any_role(array['Master Admin','Administrator','Manager']) and exists(select 1 from public.jobs j where j.id=p_job_id and j.archived_at is null)
$$;
revoke all on function public.can_read_job_quality(uuid,boolean),public.can_manage_job_quality(uuid) from public,anon,authenticated;

create policy "Authorized users read inspections" on public.job_quality_inspections for select to authenticated using(public.can_read_job_quality(job_id) and (inspection_status='Finalized' or public.can_manage_job_quality(job_id)));
create policy "Authorized users read inspection items" on public.job_quality_inspection_items for select to authenticated using(exists(select 1 from public.job_quality_inspections i where i.id=inspection_id and public.can_read_job_quality(i.job_id) and (i.inspection_status='Finalized' or public.can_manage_job_quality(i.job_id))));
create policy "Authorized users read callbacks" on public.job_quality_callbacks for select to authenticated using(public.can_read_job_quality(job_id));
create policy "Authorized users read callback history" on public.job_quality_callback_events for select to authenticated using(exists(select 1 from public.job_quality_callbacks c where c.id=callback_id and public.can_read_job_quality(c.job_id)));
create policy "Authorized users read scope completion" on public.job_scope_completion_records for select to authenticated using(public.can_read_job_quality(job_id));
create policy "Authorized users read customer feedback" on public.job_customer_feedback for select to authenticated using(public.can_read_job_quality(job_id));
create policy "Authorized users read quality evidence links" on public.job_quality_evidence_links for select to authenticated using(public.can_read_job_quality(job_id));

create function public.get_job_quality_evidence(p_job_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_read_job_quality(p_job_id) then raise exception 'Quality evidence access denied.' using errcode='42501'; end if;
 return jsonb_build_object(
  'inspections',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.job_quality_inspection_items x where x.inspection_id=i.id),'[]'::jsonb)) order by i.created_at desc) from public.job_quality_inspections i where i.job_id=p_job_id and (i.inspection_status='Finalized' or public.can_manage_job_quality(p_job_id))),'[]'::jsonb),
  'callbacks',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at,e.id) from public.job_quality_callback_events e where e.callback_id=c.id),'[]'::jsonb)) order by c.reported_at desc) from public.job_quality_callbacks c where c.job_id=p_job_id),'[]'::jsonb),
  'scopeCompletion',coalesce((select jsonb_agg(to_jsonb(s) order by s.finalized_at desc) from public.job_scope_completion_records s where s.job_id=p_job_id),'[]'::jsonb),
  'customerFeedback',coalesce((select jsonb_agg(to_jsonb(f) order by f.received_at desc) from public.job_customer_feedback f where f.job_id=p_job_id),'[]'::jsonb),
  'evidenceLinks',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.job_quality_evidence_links l where l.job_id=p_job_id),'[]'::jsonb)
 );
end $$;

create function public.save_job_quality_inspection(p_job_id uuid,p_inspection_id uuid,p_overall_notes text,p_items jsonb,p_finalize boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.job_quality_inspections; item jsonb; employee uuid:=public.current_employee_id();
begin
 if not public.can_manage_job_quality(p_job_id) or employee is null then raise exception 'Inspection management denied.' using errcode='42501'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one inspection item is required.'; end if;
 if p_inspection_id is null then insert into public.job_quality_inspections(job_id,inspector_employee_id,overall_notes,created_by) values(p_job_id,employee,nullif(btrim(coalesce(p_overall_notes,'')),''),auth.uid()) returning * into i;
 else select * into i from public.job_quality_inspections where id=p_inspection_id and job_id=p_job_id for update; if not found or i.inspection_status<>'Draft' then raise exception 'Only a Draft inspection may be edited.'; end if; update public.job_quality_inspections set overall_notes=nullif(btrim(coalesce(p_overall_notes,'')),'') where id=i.id; delete from public.job_quality_inspection_items where inspection_id=i.id; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  insert into public.job_quality_inspection_items(inspection_id,category,result,severity,notes) values(i.id,item->>'category',item->>'result',nullif(item->>'severity',''),nullif(btrim(coalesce(item->>'notes','')),''));
 end loop;
 if p_finalize then update public.job_quality_inspections set inspection_status='Finalized',inspected_at=now(),finalized_at=now(),finalized_by=auth.uid() where id=i.id; end if;
 return i.id;
end $$;

create function public.create_job_quality_callback(p_job_id uuid,p_source text,p_severity text,p_category text,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.job_quality_callbacks;
begin if not public.can_manage_job_quality(p_job_id) then raise exception 'Callback management denied.' using errcode='42501'; end if;
 insert into public.job_quality_callbacks(job_id,source,severity,category,notes,created_by) values(p_job_id,p_source,p_severity,btrim(p_category),nullif(btrim(coalesce(p_notes,'')),''),auth.uid()) returning * into c;
 insert into public.job_quality_callback_events(callback_id,event_type,new_status,new_attribution,reason,actor_user_id) values(c.id,'Created',c.status,c.attribution,'Callback recorded.',auth.uid()); return c.id; end $$;

create function public.update_job_quality_callback(p_callback_id uuid,p_status text,p_attribution text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare c public.job_quality_callbacks;
begin select * into c from public.job_quality_callbacks where id=p_callback_id for update; if not found or not public.can_manage_job_quality(c.job_id) then raise exception 'Callback management denied.' using errcode='42501'; end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'An operational reason is required.'; end if;
 if p_status not in ('Open','Resolved','Invalid / Not Attributable') or p_attribution not in ('Unreviewed','Job Quality Attributable','Not Employee Attributable') then raise exception 'Invalid callback decision.'; end if;
 insert into public.job_quality_callback_events(callback_id,event_type,previous_status,new_status,previous_attribution,new_attribution,reason,actor_user_id) values(c.id,case when c.status is distinct from p_status then 'Status Changed' else 'Attribution Changed' end,c.status,p_status,c.attribution,p_attribution,btrim(p_reason),auth.uid());
 update public.job_quality_callbacks set status=p_status,attribution=p_attribution,resolved_at=case when p_status='Open' then null else coalesce(resolved_at,now()) end where id=c.id; end $$;

create function public.finalize_job_scope_completion(p_job_id uuid,p_result text,p_attribution text,p_explanation text) returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid; rid uuid; begin if not public.can_manage_job_quality(p_job_id) then raise exception 'Scope completion management denied.' using errcode='42501'; end if;
 select id into sid from public.scope_snapshots where job_id=p_job_id order by version desc limit 1;
 insert into public.job_scope_completion_records(job_id,scope_snapshot_id,result,attribution,explanation,finalized_by) values(p_job_id,sid,p_result,p_attribution,nullif(btrim(coalesce(p_explanation,'')),''),auth.uid()) returning id into rid; return rid; end $$;

create function public.record_job_customer_feedback(p_job_id uuid,p_rating integer,p_feedback text,p_source text,p_received_at timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; begin if not public.can_manage_job_quality(p_job_id) then raise exception 'Customer feedback management denied.' using errcode='42501'; end if;
 insert into public.job_customer_feedback(job_id,rating,feedback,source,received_at,recorded_by) values(p_job_id,p_rating,nullif(btrim(coalesce(p_feedback,'')),''),p_source,p_received_at,auth.uid()) returning id into rid; return rid; end $$;

create function public.link_job_quality_evidence(p_job_id uuid,p_evidence_type text,p_evidence_record_id uuid,p_job_evidence_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; valid boolean; begin if not public.can_manage_job_quality(p_job_id) then raise exception 'Quality evidence management denied.' using errcode='42501'; end if;
 if not exists(select 1 from public.job_evidence e where e.id=p_job_evidence_id and e.job_id=p_job_id) then raise exception 'Job evidence does not belong to this Job.'; end if;
 valid:=case p_evidence_type when 'Inspection' then exists(select 1 from public.job_quality_inspections where id=p_evidence_record_id and job_id=p_job_id) when 'Callback' then exists(select 1 from public.job_quality_callbacks where id=p_evidence_record_id and job_id=p_job_id) when 'Scope Completion' then exists(select 1 from public.job_scope_completion_records where id=p_evidence_record_id and job_id=p_job_id) when 'Customer Feedback' then exists(select 1 from public.job_customer_feedback where id=p_evidence_record_id and job_id=p_job_id) else false end;
 if not valid then raise exception 'Quality record does not belong to this Job.'; end if;
 insert into public.job_quality_evidence_links(job_id,evidence_type,evidence_record_id,job_evidence_id,created_by) values(p_job_id,p_evidence_type,p_evidence_record_id,p_job_evidence_id,auth.uid()) returning id into rid; return rid; end $$;

revoke all on function public.get_job_quality_evidence(uuid),public.save_job_quality_inspection(uuid,uuid,text,jsonb,boolean),public.create_job_quality_callback(uuid,text,text,text,text),public.update_job_quality_callback(uuid,text,text,text),public.finalize_job_scope_completion(uuid,text,text,text),public.record_job_customer_feedback(uuid,integer,text,text,timestamptz),public.link_job_quality_evidence(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_job_quality_evidence(uuid),public.save_job_quality_inspection(uuid,uuid,text,jsonb,boolean),public.create_job_quality_callback(uuid,text,text,text,text),public.update_job_quality_callback(uuid,text,text,text),public.finalize_job_scope_completion(uuid,text,text,text),public.record_job_customer_feedback(uuid,integer,text,text,timestamptz),public.link_job_quality_evidence(uuid,text,uuid,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
