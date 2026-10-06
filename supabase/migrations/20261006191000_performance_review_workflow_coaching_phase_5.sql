begin;

alter table public.employee_performance_reviews
add column review_due_at timestamptz generated always as (calculated_at + interval '72 hours') stored;

create table public.employee_performance_review_responses (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references public.employee_performance_reviews(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  response text not null check (response in ('Acknowledged','Disputed')),
  employee_comment text,
  actor_user_id uuid not null references public.user_profiles(id),
  responded_at timestamptz not null default now(), created_at timestamptz not null default now(),
  check (response='Acknowledged' or nullif(btrim(employee_comment),'') is not null)
);

create table public.employee_coaching_records (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete restrict,
  related_performance_review_id uuid references public.employee_performance_reviews(id) on delete restrict,
  coaching_type text not null check (coaching_type in ('Informal Coaching','Documented Coaching','Performance Improvement Plan')),
  category text not null check (category in ('Quality','Labor Efficiency','Attendance','Compliance','Teamwork','Multiple Areas','Other')),
  summary text not null check(length(btrim(summary)) between 3 and 2000),
  expectations text not null check(length(btrim(expectations)) between 3 and 2000),
  evidence_context text not null check(length(btrim(evidence_context)) between 3 and 2000),
  start_date date not null default current_date, follow_up_date date,
  target_review_date date, status text not null default 'Active' check(status in ('Active','Completed','Cancelled')),
  created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(), completed_at timestamptz,
  check(coaching_type<>'Performance Improvement Plan' or target_review_date is not null)
);
create table public.employee_coaching_events (
  id uuid primary key default gen_random_uuid(), coaching_id uuid not null references public.employee_coaching_records(id) on delete restrict,
  event_type text not null check(event_type in ('Created','Status Changed')),
  previous_status text, new_status text, operational_reason text not null,
  actor_user_id uuid not null references public.user_profiles(id), occurred_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.employee_coaching_responses (
  id uuid primary key default gen_random_uuid(), coaching_id uuid not null unique references public.employee_coaching_records(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  response text not null check(response in ('Acknowledged','Disputed')), employee_comment text,
  actor_user_id uuid not null references public.user_profiles(id), responded_at timestamptz not null default now(), created_at timestamptz not null default now(),
  check(response='Acknowledged' or nullif(btrim(employee_comment),'') is not null)
);
create index employee_coaching_records_employee_idx on public.employee_coaching_records(employee_id,created_at desc);

alter table public.employee_performance_review_responses enable row level security;
alter table public.employee_coaching_records enable row level security;
alter table public.employee_coaching_events enable row level security;
alter table public.employee_coaching_responses enable row level security;
revoke all on public.employee_performance_review_responses,public.employee_coaching_records,public.employee_coaching_events,public.employee_coaching_responses from public,anon,authenticated;
grant select on public.employee_performance_review_responses,public.employee_coaching_records,public.employee_coaching_events,public.employee_coaching_responses to authenticated,service_role;
create policy "Managers or employee read review responses" on public.employee_performance_review_responses for select to authenticated using(public.has_any_role(array['Master Admin','Administrator','Manager']) or employee_id=public.current_employee_id());
create policy "Managers or employee read coaching" on public.employee_coaching_records for select to authenticated using(public.has_any_role(array['Master Admin','Administrator','Manager']) or employee_id=public.current_employee_id());
create policy "Managers or employee read coaching events" on public.employee_coaching_events for select to authenticated using(exists(select 1 from public.employee_coaching_records c where c.id=coaching_id and (public.has_any_role(array['Master Admin','Administrator','Manager']) or c.employee_id=public.current_employee_id())));
create policy "Managers or employee read coaching responses" on public.employee_coaching_responses for select to authenticated using(public.has_any_role(array['Master Admin','Administrator','Manager']) or employee_id=public.current_employee_id());

create function public.respond_to_employee_performance_review(p_review_id uuid,p_response text,p_comment text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.employee_performance_reviews; employee uuid:=public.current_employee_id(); rid uuid; begin
 if auth.uid() is null or employee is null or p_response not in ('Acknowledged','Disputed') then raise exception 'Review response denied.' using errcode='42501'; end if;
 select * into r from public.employee_performance_reviews where id=p_review_id and status='Finalized';
 if not found or r.employee_id<>employee then raise exception 'You may respond only to your own finalized review.' using errcode='42501'; end if;
 if p_response='Disputed' and nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'A dispute requires a concise comment.'; end if;
 insert into public.employee_performance_review_responses(review_id,employee_id,response,employee_comment,actor_user_id) values(r.id,employee,p_response,nullif(btrim(coalesce(p_comment,'')),''),auth.uid()) returning id into rid; return rid;
end $$;

create function public.create_employee_coaching_record(p_employee_id uuid,p_review_id uuid,p_type text,p_category text,p_summary text,p_expectations text,p_evidence_context text,p_start_date date,p_follow_up_date date,p_target_review_date date) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Coaching management denied.' using errcode='42501'; end if;
 if p_review_id is not null and not exists(select 1 from public.employee_performance_reviews r where r.id=p_review_id and r.employee_id=p_employee_id and r.status='Finalized') then raise exception 'A related finalized review for this employee is required.'; end if;
 insert into public.employee_coaching_records(employee_id,related_performance_review_id,coaching_type,category,summary,expectations,evidence_context,start_date,follow_up_date,target_review_date,created_by) values(p_employee_id,p_review_id,p_type,p_category,btrim(p_summary),btrim(p_expectations),btrim(p_evidence_context),coalesce(p_start_date,current_date),p_follow_up_date,p_target_review_date,auth.uid()) returning id into rid;
 insert into public.employee_coaching_events(coaching_id,event_type,new_status,operational_reason,actor_user_id) values(rid,'Created','Active','Explicit management coaching action.',auth.uid()); return rid;
end $$;

create function public.update_employee_coaching_status(p_coaching_id uuid,p_status text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare c public.employee_coaching_records; begin if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Coaching management denied.' using errcode='42501'; end if;
 select * into c from public.employee_coaching_records where id=p_coaching_id for update; if not found or p_status not in ('Active','Completed','Cancelled') or nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Valid coaching status and reason are required.'; end if;
 insert into public.employee_coaching_events(coaching_id,event_type,previous_status,new_status,operational_reason,actor_user_id) values(c.id,'Status Changed',c.status,p_status,btrim(p_reason),auth.uid()); update public.employee_coaching_records set status=p_status,completed_at=case when p_status='Completed' then now() else null end where id=c.id; end $$;

create function public.respond_to_employee_coaching(p_coaching_id uuid,p_response text,p_comment text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.employee_coaching_records; employee uuid:=public.current_employee_id(); rid uuid; begin if auth.uid() is null or employee is null or p_response not in ('Acknowledged','Disputed') then raise exception 'Coaching response denied.' using errcode='42501'; end if;
 select * into c from public.employee_coaching_records where id=p_coaching_id; if not found or c.employee_id<>employee then raise exception 'You may respond only to your own coaching record.' using errcode='42501'; end if; if p_response='Disputed' and nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'A dispute requires a concise comment.'; end if;
 insert into public.employee_coaching_responses(coaching_id,employee_id,response,employee_comment,actor_user_id) values(c.id,employee,p_response,nullif(btrim(coalesce(p_comment,'')),''),auth.uid()) returning id into rid; return rid; end $$;

create function public.get_employee_performance_workflow(p_employee_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target uuid:=coalesce(p_employee_id,public.current_employee_id()); management boolean:=public.has_any_role(array['Master Admin','Administrator','Manager']); begin
 if auth.uid() is null or target is null or (not management and target<>public.current_employee_id()) then raise exception 'Performance workflow access denied.' using errcode='42501'; end if;
 return jsonb_build_object(
  'reviews',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('workflowStatus',case when r.status='Finalized' then 'Finalized' when now()>r.review_due_at then 'Review Overdue' else 'Review Pending' end,'response',coalesce((select to_jsonb(x) from public.employee_performance_review_responses x where x.review_id=r.id),'null'::jsonb)) order by r.period_end desc,r.revision desc) from public.employee_performance_reviews r where r.employee_id=target and (management or r.status='Finalized')),'[]'::jsonb),
  'coaching',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('response',coalesce((select to_jsonb(x) from public.employee_coaching_responses x where x.coaching_id=c.id),'null'::jsonb)) order by c.created_at desc) from public.employee_coaching_records c where c.employee_id=target),'[]'::jsonb)
 );
end $$;

revoke all on function public.respond_to_employee_performance_review(uuid,text,text),public.create_employee_coaching_record(uuid,uuid,text,text,text,text,text,date,date,date),public.update_employee_coaching_status(uuid,text,text),public.respond_to_employee_coaching(uuid,text,text),public.get_employee_performance_workflow(uuid) from public,anon,authenticated;
grant execute on function public.respond_to_employee_performance_review(uuid,text,text),public.create_employee_coaching_record(uuid,uuid,text,text,text,text,text,date,date,date),public.update_employee_coaching_status(uuid,text,text),public.respond_to_employee_coaching(uuid,text,text),public.get_employee_performance_workflow(uuid) to authenticated;
notify pgrst,'reload schema'; commit;
