-- Background screening metadata only; never store criminal records or SSNs here.
-- Applied only as part of an approved release.
create table if not exists public.employee_background_screenings (
 employee_id uuid primary key references public.employees(id) on delete cascade,
 status text not null default 'not_started'
   check (status in ('not_started','conditional_offer_issued','authorization_pending',
   'authorized','invited','in_progress','completed_review_pending','individualized_review',
   'pre_adverse_action','response_pending','cleared','final_adverse_decision','declined','canceled')),
 provider text not null default 'Checkr',
 provider_reference text,
 conditional_offer_at timestamptz,
 authorization_recorded_at timestamptz,
 authorization_reference text,
 invitation_at timestamptz,
 completed_at timestamptz,
 reviewed_by uuid references public.user_profiles(id),
 updated_by uuid not null references public.user_profiles(id),
 reviewed_at timestamptz,
 cleared_at timestamptz,
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 constraint screening_authorization_required check (
   status not in ('authorized','invited','in_progress','completed_review_pending',
   'individualized_review','pre_adverse_action','response_pending','cleared','final_adverse_decision')
   or (authorization_recorded_at is not null and nullif(btrim(authorization_reference),'') is not null)),
 constraint screening_clearance_review_required check (
   status <> 'cleared' or (reviewed_by is not null and reviewed_at is not null and cleared_at is not null))
);
create table if not exists public.employee_background_screening_events (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete cascade,
 previous_status text,
 next_status text not null,
 actor_id uuid not null references public.user_profiles(id),
 occurred_at timestamptz not null default now(),
 action_reference text,
 -- Only workflow references. Never store report details or criminal findings.
 constraint screening_event_ref_length check (length(coalesce(action_reference,'')) <= 300)
);
create index if not exists screening_events_employee_idx on public.employee_background_screening_events(employee_id,occurred_at desc);

-- Database-side audit is atomic with each status transition.
create or replace function public.audit_employee_background_screening()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' or old.status is distinct from new.status then
   insert into public.employee_background_screening_events
     (employee_id,previous_status,next_status,actor_id,action_reference)
   values (new.employee_id,case when TG_OP='INSERT' then null else old.status end,
           new.status,new.updated_by,null);
 end if;
 return new;
end;
$$;
revoke all on function public.audit_employee_background_screening() from public,anon,authenticated;
drop trigger if exists audit_employee_screening_status on public.employee_background_screenings;
create trigger audit_employee_screening_status
 after insert or update of status on public.employee_background_screenings
 for each row execute function public.audit_employee_background_screening();


-- Explicit role-based exception for an already authorized Operations Manager.
-- Seed only currently active Managers; newly added Managers do not gain automatic access.
create table if not exists public.employee_screening_authorized_reviewers (
 user_id uuid primary key references public.user_profiles(id) on delete cascade,
 authorized_at timestamptz not null default now()
);
insert into public.employee_screening_authorized_reviewers(user_id)
  select id from public.user_profiles where role='Manager' and is_active=true
  on conflict do nothing;
alter table public.employee_screening_authorized_reviewers enable row level security;
revoke all on public.employee_screening_authorized_reviewers from anon,authenticated;

alter table public.employee_background_screenings enable row level security;
alter table public.employee_background_screening_events enable row level security;
revoke all on public.employee_background_screenings from anon, authenticated;
revoke all on public.employee_background_screening_events from anon, authenticated;
-- Never add public/client RLS policies. Access solely via role-checked server routes.

-- Preserve only employees that already exist at rollout; a future employee cannot
-- evade screening by supplying an older created_at timestamp.
create table if not exists public.employee_screening_legacy_exemptions (
 employee_id uuid primary key references public.employees(id) on delete cascade
);
insert into public.employee_screening_legacy_exemptions(employee_id)
 select id from public.employees on conflict do nothing;
alter table public.employee_screening_legacy_exemptions enable row level security;
revoke all on public.employee_screening_legacy_exemptions from anon,authenticated;

create or replace function public.assert_employee_screening_clearance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare person uuid;
begin
 if TG_TABLE_NAME = 'crews' then person := new.crew_lead_id;
 elsif TG_TABLE_NAME = 'jobs' then
   if (TG_OP = 'INSERT' or new.assigned_employee_id is distinct from old.assigned_employee_id)
       and new.assigned_employee_id is not null then
     perform public.check_employee_screening_clearance(new.assigned_employee_id);
   end if;
   if (TG_OP = 'INSERT' or new.assigned_crew_lead_id is distinct from old.assigned_crew_lead_id)
       and new.assigned_crew_lead_id is not null then
     perform public.check_employee_screening_clearance(new.assigned_crew_lead_id);
   end if;
   return new;
 else person := new.employee_id;
 end if;
 if person is not null then perform public.check_employee_screening_clearance(person); end if;
 return new;
end;
$$;
-- This function runs under the calling database role. It must be able to read
-- the screening table through the backend's service role or trusted database
-- write functions. Do not silently bypass this guard.
create or replace function public.check_employee_screening_clearance(p_employee_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare employee_row record; allowed boolean;
begin
 select created_at,employment_type into employee_row from public.employees where id=p_employee_id;
 if not found then raise exception 'Employee not found'; end if;
 if employee_row.employment_type = '1099' then return; end if;
 if exists(select 1 from public.employee_screening_legacy_exemptions where employee_id=p_employee_id) then return; end if;
 select exists(select 1 from public.employee_background_screenings
     where employee_id=p_employee_id and status='cleared' and reviewed_by is not null and cleared_at is not null)
   into allowed;
 if not allowed then raise exception 'New W-2 employee requires background-screening clearance before assignment'; end if;
end;
$$;
revoke all on function public.check_employee_screening_clearance(uuid) from public,anon,authenticated;
revoke all on function public.assert_employee_screening_clearance() from public,anon,authenticated;
-- Existing team may be edited without re-triggering screening when IDs do not change.
drop trigger if exists background_screen_crews on public.crews;
create trigger background_screen_crews before insert or update of crew_lead_id on public.crews
 for each row execute function public.assert_employee_screening_clearance();
drop trigger if exists background_screen_members on public.crew_members;
create trigger background_screen_members before insert or update of employee_id on public.crew_members
 for each row execute function public.assert_employee_screening_clearance();
drop trigger if exists background_screen_job_techs on public.job_crew_technicians;
create trigger background_screen_job_techs before insert or update of employee_id on public.job_crew_technicians
 for each row execute function public.assert_employee_screening_clearance();
drop trigger if exists background_screen_jobs on public.jobs;
create trigger background_screen_jobs before insert or update of assigned_employee_id,assigned_crew_lead_id on public.jobs
 for each row execute function public.assert_employee_screening_clearance();
