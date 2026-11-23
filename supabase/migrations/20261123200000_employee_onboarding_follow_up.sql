create table public.employee_onboarding_follow_up (
  case_id uuid not null references public.employee_onboarding_cases(id) on delete cascade,
  code text not null check (code in ('new_hire_report_filed', 'workplace_rights_notice_recorded')),
  completed_at timestamptz not null default now(),
  completed_by uuid not null references public.user_profiles(id),
  primary key (case_id, code)
);

alter table public.employee_onboarding_follow_up enable row level security;
revoke all on public.employee_onboarding_follow_up from public, anon, authenticated;
grant select, insert, update, delete on public.employee_onboarding_follow_up to service_role;
