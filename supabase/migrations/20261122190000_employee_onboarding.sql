-- Employee onboarding: status metadata only. Do not store I-9, W-4, bank details or reports here.
create table if not exists public.employee_onboarding_cases (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null unique references public.employees(id) on delete restrict,
 application_id uuid unique references public.job_applications(id) on delete set null,
 candidate_email text not null,
 position text not null check (position in ('Scrub Technician','Crew Lead')),
 hourly_rate numeric(10,2) not null check (hourly_rate in (25,27)),
 employment_type text not null default 'Part-Time' check (employment_type='Part-Time'),
 minimum_shift_hours numeric not null default 2 check (minimum_shift_hours=2),
 status text not null default 'draft' check (status in ('draft','invited','in_progress','ready_for_review','completed','canceled')),
 start_date date,
 invite_token_hash text unique,
 invite_expires_at timestamptz,
 invite_sent_at timestamptz,
 candidate_ack_at timestamptz,
 approved_at timestamptz,
 approved_by uuid references public.user_profiles(id),
 created_by uuid not null references public.user_profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint completed_is_approved check (status<>'completed' or (approved_at is not null and approved_by is not null))
);
create index if not exists employee_onboarding_case_status_idx on public.employee_onboarding_cases(status,created_at desc);
create table if not exists public.employee_onboarding_steps (
 case_id uuid not null references public.employee_onboarding_cases(id) on delete cascade,
 code text not null check (code in (
  'offer_accepted','w4_verified','de4_verified','i9_section1_verified','i9_section2_verified',
  'wage_notice_provided','workers_comp_notice_provided','pay_method_verified',
  'handbook_ack_verified','attendance_policy_verified','uniform_policy_verified',
  'client_privacy_verified','incident_policy_verified','safety_policy_verified',
  'chemical_safety_training','ppe_training','cleaning_checklists_training',
  'gps_photo_training','time_clock_training','paid_training_recorded','supervisor_assigned'
 )),
 completed_at timestamptz,
 completed_by uuid references public.user_profiles(id),
 evidence_reference text check (length(coalesce(evidence_reference,''))<=200),
 primary key(case_id,code),
 constraint verified_with_actor check ((completed_at is null and completed_by is null) or (completed_at is not null and completed_by is not null))
);
create table if not exists public.employee_onboarding_events (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references public.employee_onboarding_cases(id) on delete cascade,
 event_type text not null check (event_type in ('created','invited','candidate_acknowledged','step_verified','step_reset','approved','canceled')),
 actor_id uuid references public.user_profiles(id),
 created_at timestamptz not null default now()
);
create index if not exists employee_onboarding_events_idx on public.employee_onboarding_events(case_id,created_at desc);
alter table public.employee_onboarding_cases enable row level security;
alter table public.employee_onboarding_steps enable row level security;
alter table public.employee_onboarding_events enable row level security;
revoke all on public.employee_onboarding_cases from anon,authenticated;
revoke all on public.employee_onboarding_steps from anon,authenticated;
revoke all on public.employee_onboarding_events from anon,authenticated;
-- All candidate access is through expiring random token and strict server handlers.
-- All manager access is via authenticated, role-checked server routes.

-- Extend the existing new-W-2 assignment safeguard. Legacy personnel remain exempt.
create or replace function public.check_employee_screening_clearance(p_employee_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare employee_row record; allowed boolean;
begin
 select employment_type into employee_row from public.employees where id=p_employee_id;
 if not found then raise exception 'Employee not found'; end if;
 if employee_row.employment_type='1099' then return; end if;
 if exists(select 1 from public.employee_screening_legacy_exemptions where employee_id=p_employee_id) then return; end if;
 select exists(select 1 from public.employee_background_screenings
   where employee_id=p_employee_id and status='cleared' and reviewed_by is not null and cleared_at is not null)
 into allowed;
 if not allowed then raise exception 'New W-2 employee requires background-screening clearance before assignment'; end if;
 select exists(select 1 from public.employee_onboarding_cases
   where employee_id=p_employee_id and status='completed' and approved_by is not null and approved_at is not null)
 into allowed;
 if not allowed then raise exception 'New W-2 employee requires completed onboarding before assignment'; end if;
end;
$$;
revoke all on function public.check_employee_screening_clearance(uuid) from public,anon,authenticated;

-- One database transaction for final approval and activation.
create or replace function public.complete_employee_onboarding(p_case_id uuid,p_actor_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare case_row public.employee_onboarding_cases%rowtype;
declare actor_role text;
declare actor_active boolean;
declare verified_count integer;
begin
 select role,is_active into actor_role,actor_active from public.user_profiles where id=p_actor_id;
 if actor_active is distinct from true or not (
    actor_role in ('Master Admin','Administrator') or
    (actor_role='Manager' and exists(
      select 1 from public.employee_screening_authorized_reviewers where user_id=p_actor_id
    ))
  ) then raise exception 'Not authorized for onboarding approval'; end if;
 select * into case_row from public.employee_onboarding_cases where id=p_case_id for update;
 if not found or case_row.status in ('completed','canceled') then raise exception 'Onboarding case unavailable'; end if;
 if case_row.candidate_ack_at is null then raise exception 'Candidate orientation acknowledgment is missing'; end if;
 select count(*) into verified_count from public.employee_onboarding_steps
 where case_id=p_case_id and completed_at is not null and completed_by is not null;
 if verified_count<>21 then raise exception 'All onboarding requirements must be verified before approval'; end if;
 if not exists(select 1 from public.employee_background_screenings where employee_id=case_row.employee_id and status='cleared' and reviewed_by is not null and cleared_at is not null)
 then raise exception 'Background screening clearance is required'; end if;
 if not exists(select 1 from public.employees where id=case_row.employee_id and employment_type<>'1099' and archived_at is null)
 then raise exception 'Employee is not eligible'; end if;
 update public.employee_onboarding_cases
 set status='completed',approved_at=now(),approved_by=p_actor_id,
     invite_token_hash=null,invite_expires_at=null,updated_at=now()
 where id=p_case_id;
 update public.employees set employment_status='Active',job_title=case_row.position,
 hourly_rate=case_row.hourly_rate,employment_type='Part-Time'
 where id=case_row.employee_id;
 insert into public.employee_onboarding_events(case_id,event_type,actor_id) values(p_case_id,'approved',p_actor_id);
end;
$$;
revoke all on function public.complete_employee_onboarding(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_employee_onboarding(uuid,uuid) to service_role;
