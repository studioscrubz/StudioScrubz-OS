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
alter table public.employee_background_screenings enable row level security;
alter table public.employee_background_screening_events enable row level security;
revoke all on public.employee_background_screenings from anon, authenticated;
revoke all on public.employee_background_screening_events from anon, authenticated;
-- Never add public/client RLS policies. Access solely via role-checked server routes.

-- Apply gating only to employees created after this release. Existing workforce is unaffected.
create table if not exists public.employee_screening_rollout (
 singleton boolean primary key default true check(singleton),
 cutoff timestamptz not null default now()
);
insert into public.employee_screening_rollout(singleton) values (true) on conflict (singleton) do nothing;
alter table public.employee_screening_rollout enable row level security;
revoke all on public.employee_screening_rollout from anon,authenticated;

create or replace function public.assert_employee_screening_clearance()
returns trigger language plpgsql security definer set search_path = '' as $
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
declare employee_row record; allowed boolean; cutoff_value timestamptz;
begin
 select created_at,employment_type into employee_row from public.employees where id=p_employee_id;
 if not found then raise exception 'Employee not found'; end if;
 if employee_row.employment_type = '1099' then return; end if;
 select cutoff into cutoff_value from public.employee_screening_rollout where singleton=true;
 if employee_row.created_at < cutoff_value then return; end if;
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
