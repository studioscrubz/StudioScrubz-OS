create table public.personal_email_settings (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  signature text not null default '' check (char_length(signature) <= 2000),
  sender_email text check (sender_email ~ '^[a-z0-9][a-z0-9._%+-]{0,63}@studioscrubz[.]com$')
);

alter table public.personal_email_settings enable row level security;
revoke all on public.personal_email_settings from public, anon, authenticated;
grant select, insert, update on public.personal_email_settings to service_role;
