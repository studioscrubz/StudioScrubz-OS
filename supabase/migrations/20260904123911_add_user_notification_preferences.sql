begin;

create table public.notification_preferences (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  disabled_attention_categories text[] not null default '{}',
  direct_messages_enabled boolean not null default true,
  announcements_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_notification_preferences_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_notification_preferences_updated_at() from public, anon, authenticated;
create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function public.set_notification_preferences_updated_at();

alter table public.notification_preferences enable row level security;
revoke all on table public.notification_preferences from public, anon, authenticated;
grant select, insert, update on table public.notification_preferences to authenticated;
grant select on table public.notification_preferences to service_role;

create policy "Users read own notification preferences"
on public.notification_preferences for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users create own notification preferences"
on public.notification_preferences for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users update own notification preferences"
on public.notification_preferences for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

commit;
