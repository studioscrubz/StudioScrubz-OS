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
