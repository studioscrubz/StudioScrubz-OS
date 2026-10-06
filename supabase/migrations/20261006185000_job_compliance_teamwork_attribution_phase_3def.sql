begin;

create table public.job_compliance_records (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  employee_id uuid references public.employees(id) on delete restrict,
  category text not null check (category in ('Required Photos / Evidence','Checklist / Required Workflow','PPE / Safety Procedure','Equipment / Supply Procedure','Arrival / Departure Procedure','Customer / Property Procedure','Documentation','Other')),
  result text not null check (result in ('Compliant','Non-Compliant','Excused','Not Applicable')),
  ownership text not null check (ownership in ('Employee','Crew / Shared','Management / Administrative','External / Customer','Not Attributable')),
  operational_notes text not null check (length(btrim(operational_notes)) between 3 and 1000),
  recorded_by uuid not null references public.user_profiles(id), recorded_at timestamptz not null default now(),
  status text not null default 'Finalized' check (status='Finalized'), created_at timestamptz not null default now(),
  check ((ownership='Employee' and employee_id is not null) or (ownership<>'Employee' and employee_id is null))
);
create table public.employee_teamwork_events (
  id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  event_type text not null check (event_type in ('Assisted Teammate','Leadership / Initiative','Communication','Problem Solving','Customer / Property Support','Communication Issue','Team Cooperation Issue','Procedure Support Issue','Other')),
  direction text not null check (direction in ('Positive','Concern')),
  operational_notes text not null check (length(btrim(operational_notes)) between 3 and 1000),
  recorded_by uuid not null references public.user_profiles(id), occurred_at timestamptz not null,
  acknowledgement_state text not null default 'Pending' check (acknowledgement_state in ('Pending','Acknowledged','Disputed')),
  acknowledgement_note text, acknowledged_at timestamptz, created_at timestamptz not null default now(),
  check ((event_type in ('Assisted Teammate','Leadership / Initiative','Communication','Problem Solving','Customer / Property Support') and direction='Positive') or (event_type in ('Communication Issue','Team Cooperation Issue','Procedure Support Issue') and direction='Concern') or event_type='Other')
);
create table public.employee_teamwork_acknowledgement_events (
  id uuid primary key default gen_random_uuid(), teamwork_event_id uuid not null references public.employee_teamwork_events(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  acknowledgement_state text not null check (acknowledgement_state in ('Acknowledged','Disputed')),
  employee_note text, actor_user_id uuid not null references public.user_profiles(id), occurred_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.job_quality_employee_attributions (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete restrict,
  quality_evidence_type text not null check (quality_evidence_type in ('Inspection','Callback','Scope Completion','Customer Feedback')),
  quality_evidence_id uuid not null,
  attribution_target text not null check (attribution_target in ('Employee','Crew / Shared','Not Employee Attributable')),
  employee_id uuid references public.employees(id) on delete restrict, crew_id uuid references public.crews(id) on delete restrict,
  operational_reason text not null check (length(btrim(operational_reason)) between 3 and 1000),
  evidence_job_evidence_id uuid references public.job_evidence(id) on delete restrict,
  recorded_by uuid not null references public.user_profiles(id), recorded_at timestamptz not null default now(), active boolean not null default true,
  check ((attribution_target='Employee' and employee_id is not null and crew_id is null) or (attribution_target='Crew / Shared' and employee_id is null) or (attribution_target='Not Employee Attributable' and employee_id is null and crew_id is null))
);
create table public.job_quality_employee_attribution_events (
  id uuid primary key default gen_random_uuid(), attribution_id uuid not null references public.job_quality_employee_attributions(id) on delete restrict,
  event_type text not null check (event_type in ('Created','Replaced','Withdrawn')),
  operational_reason text not null, actor_user_id uuid not null references public.user_profiles(id), occurred_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.job_performance_evidence_links (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete restrict,
  evidence_type text not null check (evidence_type in ('Compliance','Teamwork')),
  evidence_record_id uuid not null, job_evidence_id uuid not null references public.job_evidence(id) on delete restrict,
  created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(), unique(evidence_type,evidence_record_id,job_evidence_id)
);
create index job_compliance_records_job_idx on public.job_compliance_records(job_id,recorded_at desc);
create index employee_teamwork_events_employee_idx on public.employee_teamwork_events(employee_id,occurred_at desc);
create index job_quality_attributions_job_idx on public.job_quality_employee_attributions(job_id,recorded_at desc);

alter table public.job_compliance_records enable row level security; alter table public.employee_teamwork_events enable row level security;
alter table public.employee_teamwork_acknowledgement_events enable row level security; alter table public.job_quality_employee_attributions enable row level security;
alter table public.job_quality_employee_attribution_events enable row level security; alter table public.job_performance_evidence_links enable row level security;
revoke all on public.job_compliance_records,public.employee_teamwork_events,public.employee_teamwork_acknowledgement_events,public.job_quality_employee_attributions,public.job_quality_employee_attribution_events,public.job_performance_evidence_links from public,anon,authenticated;
grant select on public.job_compliance_records,public.employee_teamwork_events,public.employee_teamwork_acknowledgement_events,public.job_quality_employee_attributions,public.job_quality_employee_attribution_events,public.job_performance_evidence_links to authenticated,service_role;

create policy "Authorized users read compliance" on public.job_compliance_records for select to authenticated using(public.can_manage_job_quality(job_id) or (status='Finalized' and public.can_read_job_quality(job_id)));
create policy "Managers or subject read teamwork" on public.employee_teamwork_events for select to authenticated using(public.has_any_role(array['Master Admin','Administrator','Manager']) or employee_id=public.current_employee_id() or (job_id is not null and public.can_read_job_quality(job_id)));
create policy "Managers or subject read teamwork acknowledgements" on public.employee_teamwork_acknowledgement_events for select to authenticated using(public.has_any_role(array['Master Admin','Administrator','Manager']) or employee_id=public.current_employee_id());
create policy "Authorized users read quality attributions" on public.job_quality_employee_attributions for select to authenticated using(public.can_manage_job_quality(job_id) or (public.can_read_job_quality(job_id) and (attribution_target<>'Employee' or employee_id=public.current_employee_id())));
create policy "Authorized users read attribution history" on public.job_quality_employee_attribution_events for select to authenticated using(exists(select 1 from public.job_quality_employee_attributions a where a.id=attribution_id and (public.can_manage_job_quality(a.job_id) or a.employee_id=public.current_employee_id())));
create policy "Authorized users read performance evidence links" on public.job_performance_evidence_links for select to authenticated using(public.can_read_job_quality(job_id));

create function public.assert_quality_evidence_belongs_to_job(p_job_id uuid,p_type text,p_id uuid) returns void language plpgsql stable security definer set search_path='' as $$
declare valid boolean; begin valid:=case p_type when 'Inspection' then exists(select 1 from public.job_quality_inspections where id=p_id and job_id=p_job_id and inspection_status='Finalized') when 'Callback' then exists(select 1 from public.job_quality_callbacks where id=p_id and job_id=p_job_id) when 'Scope Completion' then exists(select 1 from public.job_scope_completion_records where id=p_id and job_id=p_job_id) when 'Customer Feedback' then exists(select 1 from public.job_customer_feedback where id=p_id and job_id=p_job_id) else false end; if not valid then raise exception 'Finalized quality evidence was not found for this Job.'; end if; end $$;
revoke all on function public.assert_quality_evidence_belongs_to_job(uuid,text,uuid) from public,anon,authenticated;

create function public.get_job_employee_participation(p_job_id uuid)
returns table(employee_id uuid,employee_name text,job_role text,assigned boolean,presence_state text,arrival_at timestamptz,departure_at timestamptz,production_labor_hours numeric,approved_exception_hours numeric,participation_percentage numeric)
language plpgsql stable security definer set search_path='' as $$
declare j public.jobs; begin
 select * into j from public.jobs where id=p_job_id;
 if not found or not public.can_read_job_quality(p_job_id) then raise exception 'Job participation access denied.' using errcode='42501'; end if;
 return query with participants as (
  select j.assigned_employee_id id where j.assigned_employee_id is not null
  union select cm.employee_id from public.crew_members cm where cm.crew_id=j.assigned_crew_id
  union select c.crew_lead_id from public.crews c where c.id=j.assigned_crew_id and c.crew_lead_id is not null
  union select p.employee_id from public.job_crew_presence p where p.job_id=j.id
  union select t.employee_id from public.time_entries t where t.job_id=j.id and t.employee_id is not null and t.archived_at is null
 ), labor as (
  select t.employee_id,
   coalesce(sum(t.total_hours) filter(where t.status in ('Completed','Approved') and t.labor_classification='Production'),0) production,
   coalesce(sum(t.total_hours) filter(where t.status in ('Completed','Approved') and t.labor_classification='Approved Exception'),0) exception_hours,
   min(t.clock_in) filter(where t.entry_type='Job') first_in,max(t.clock_out) filter(where t.entry_type='Job' and t.clock_out is not null) last_out
  from public.time_entries t where t.job_id=j.id and t.entry_type='Job' and t.archived_at is null group by t.employee_id
 ) select e.id,coalesce(nullif(btrim(e.preferred_name),''),nullif(btrim(concat_ws(' ',e.first_name,e.last_name)),''),e.employee_number),
  case when c.crew_lead_id=e.id then 'Crew Lead' when up.role='Manager' then 'Manager' else 'Technician' end,
  (j.assigned_employee_id=e.id or cm.employee_id is not null or c.crew_lead_id=e.id),p.current_status,
  coalesce(p.physical_arrival_at,p.payroll_joined_at,l.first_in),coalesce(p.physical_departure_at,l.last_out),l.production,l.exception_hours,
  case when j.operational_started_at is not null and j.operational_ended_at>j.operational_started_at and l.first_in is not null and l.last_out is not null then round(least(100,greatest(0,extract(epoch from (least(l.last_out,j.operational_ended_at)-greatest(l.first_in,j.operational_started_at)))/extract(epoch from (j.operational_ended_at-j.operational_started_at))*100))::numeric,2) else null end
 from participants x join public.employees e on e.id=x.id left join public.job_crew_presence p on p.job_id=j.id and p.employee_id=e.id left join labor l on l.employee_id=e.id left join public.crews c on c.id=j.assigned_crew_id left join public.crew_members cm on cm.crew_id=j.assigned_crew_id and cm.employee_id=e.id left join public.user_profiles up on up.employee_id=e.id and up.is_active order by employee_name;
end $$;

create function public.get_job_performance_evidence(p_job_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if not public.can_read_job_quality(p_job_id) then raise exception 'Performance evidence access denied.' using errcode='42501'; end if;
 return jsonb_build_object('compliance',coalesce((select jsonb_agg(to_jsonb(c) order by c.recorded_at desc) from public.job_compliance_records c where c.job_id=p_job_id),'[]'::jsonb),'teamwork',coalesce((select jsonb_agg(to_jsonb(t) order by t.occurred_at desc) from public.employee_teamwork_events t where t.job_id=p_job_id),'[]'::jsonb),'attributions',coalesce((select jsonb_agg(to_jsonb(a) order by a.recorded_at desc) from public.job_quality_employee_attributions a where a.job_id=p_job_id and a.active),'[]'::jsonb)); end $$;

create function public.record_job_compliance(p_job_id uuid,p_employee_id uuid,p_category text,p_result text,p_ownership text,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; begin if not public.can_manage_job_quality(p_job_id) then raise exception 'Compliance management denied.' using errcode='42501'; end if;
 if p_employee_id is not null and not exists(select 1 from public.get_job_employee_participation(p_job_id) p where p.employee_id=p_employee_id) then raise exception 'Employee did not participate in this Job.'; end if;
 insert into public.job_compliance_records(job_id,employee_id,category,result,ownership,operational_notes,recorded_by) values(p_job_id,p_employee_id,p_category,p_result,p_ownership,btrim(p_notes),auth.uid()) returning id into rid; return rid; end $$;

create function public.record_employee_teamwork_event(p_job_id uuid,p_employee_id uuid,p_event_type text,p_direction text,p_notes text,p_occurred_at timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; begin if p_job_id is null or not public.can_manage_job_quality(p_job_id) then raise exception 'Teamwork evidence management denied.' using errcode='42501'; end if;
 if not exists(select 1 from public.get_job_employee_participation(p_job_id) p where p.employee_id=p_employee_id) then raise exception 'Employee did not participate in this Job.'; end if;
 insert into public.employee_teamwork_events(job_id,employee_id,event_type,direction,operational_notes,recorded_by,occurred_at) values(p_job_id,p_employee_id,p_event_type,p_direction,btrim(p_notes),auth.uid(),p_occurred_at) returning id into rid; return rid; end $$;

create function public.acknowledge_employee_teamwork_event(p_event_id uuid,p_state text,p_note text default null) returns void language plpgsql security definer set search_path='' as $$
declare t public.employee_teamwork_events; employee uuid:=public.current_employee_id(); begin if auth.uid() is null or employee is null or p_state not in ('Acknowledged','Disputed') then raise exception 'Teamwork acknowledgement denied.' using errcode='42501'; end if;
 select * into t from public.employee_teamwork_events where id=p_event_id for update; if not found or t.employee_id<>employee then raise exception 'You may respond only to your own teamwork event.' using errcode='42501'; end if;
 if t.acknowledgement_state<>'Pending' then raise exception 'This teamwork event already has a response.'; end if; if p_state='Disputed' and nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'A dispute requires an operational note.'; end if;
 insert into public.employee_teamwork_acknowledgement_events(teamwork_event_id,employee_id,acknowledgement_state,employee_note,actor_user_id) values(t.id,employee,p_state,nullif(btrim(coalesce(p_note,'')),''),auth.uid()); update public.employee_teamwork_events set acknowledgement_state=p_state,acknowledgement_note=nullif(btrim(coalesce(p_note,'')),''),acknowledged_at=now() where id=t.id; end $$;

create function public.record_job_quality_employee_attribution(p_job_id uuid,p_quality_type text,p_quality_id uuid,p_target text,p_employee_id uuid,p_crew_id uuid,p_reason text,p_job_evidence_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; begin if not public.can_manage_job_quality(p_job_id) then raise exception 'Quality attribution management denied.' using errcode='42501'; end if; perform public.assert_quality_evidence_belongs_to_job(p_job_id,p_quality_type,p_quality_id);
 if p_target='Employee' and not exists(select 1 from public.get_job_employee_participation(p_job_id) p where p.employee_id=p_employee_id) then raise exception 'Employee did not participate in this Job.'; end if;
 if p_job_evidence_id is not null and not exists(select 1 from public.job_evidence e where e.id=p_job_evidence_id and e.job_id=p_job_id) then raise exception 'Evidence does not belong to this Job.'; end if;
 insert into public.job_quality_employee_attributions(job_id,quality_evidence_type,quality_evidence_id,attribution_target,employee_id,crew_id,operational_reason,evidence_job_evidence_id,recorded_by) values(p_job_id,p_quality_type,p_quality_id,p_target,p_employee_id,p_crew_id,btrim(p_reason),p_job_evidence_id,auth.uid()) returning id into rid;
 insert into public.job_quality_employee_attribution_events(attribution_id,event_type,operational_reason,actor_user_id) values(rid,'Created',btrim(p_reason),auth.uid()); return rid; end $$;

create function public.withdraw_job_quality_employee_attribution(p_attribution_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare a public.job_quality_employee_attributions; begin select * into a from public.job_quality_employee_attributions where id=p_attribution_id for update; if not found or not public.can_manage_job_quality(a.job_id) then raise exception 'Quality attribution management denied.' using errcode='42501'; end if; if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A withdrawal reason is required.'; end if; update public.job_quality_employee_attributions set active=false where id=a.id; insert into public.job_quality_employee_attribution_events(attribution_id,event_type,operational_reason,actor_user_id) values(a.id,'Withdrawn',btrim(p_reason),auth.uid()); end $$;

create function public.link_job_performance_evidence(p_job_id uuid,p_type text,p_record_id uuid,p_job_evidence_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; valid boolean; begin if not public.can_manage_job_quality(p_job_id) then raise exception 'Performance evidence management denied.' using errcode='42501'; end if;
 if not exists(select 1 from public.job_evidence e where e.id=p_job_evidence_id and e.job_id=p_job_id) then raise exception 'Job evidence does not belong to this Job.'; end if;
 valid:=case p_type when 'Compliance' then exists(select 1 from public.job_compliance_records where id=p_record_id and job_id=p_job_id) when 'Teamwork' then exists(select 1 from public.employee_teamwork_events where id=p_record_id and job_id=p_job_id) else false end; if not valid then raise exception 'Performance evidence record does not belong to this Job.'; end if;
 insert into public.job_performance_evidence_links(job_id,evidence_type,evidence_record_id,job_evidence_id,created_by) values(p_job_id,p_type,p_record_id,p_job_evidence_id,auth.uid()) returning id into rid; return rid; end $$;

revoke all on function public.get_job_employee_participation(uuid),public.get_job_performance_evidence(uuid),public.record_job_compliance(uuid,uuid,text,text,text,text),public.record_employee_teamwork_event(uuid,uuid,text,text,text,timestamptz),public.acknowledge_employee_teamwork_event(uuid,text,text),public.record_job_quality_employee_attribution(uuid,text,uuid,text,uuid,uuid,text,uuid),public.withdraw_job_quality_employee_attribution(uuid,text),public.link_job_performance_evidence(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_job_employee_participation(uuid),public.get_job_performance_evidence(uuid),public.record_job_compliance(uuid,uuid,text,text,text,text),public.record_employee_teamwork_event(uuid,uuid,text,text,text,timestamptz),public.acknowledge_employee_teamwork_event(uuid,text,text),public.record_job_quality_employee_attribution(uuid,text,uuid,text,uuid,uuid,text,uuid),public.withdraw_job_quality_employee_attribution(uuid,text),public.link_job_performance_evidence(uuid,text,uuid,uuid) to authenticated;

notify pgrst,'reload schema'; commit;
