-- Store browser push subscriptions owned by authenticated StudioScrubz users.
-- Sending is intentionally outside this migration and remains unimplemented.
begin;

create table if not exists public.browser_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint browser_push_subscriptions_endpoint_key unique (endpoint),
  constraint browser_push_subscriptions_endpoint_check check (nullif(btrim(endpoint), '') is not null),
  constraint browser_push_subscriptions_p256dh_check check (nullif(btrim(p256dh), '') is not null),
  constraint browser_push_subscriptions_auth_check check (nullif(btrim(auth), '') is not null)
);

create index if not exists browser_push_subscriptions_user_active_idx
  on public.browser_push_subscriptions(user_id)
  where revoked_at is null;

create or replace function public.set_browser_push_subscription_updated_at()
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

revoke all on function public.set_browser_push_subscription_updated_at() from public;
drop trigger if exists browser_push_subscriptions_set_updated_at on public.browser_push_subscriptions;
create trigger browser_push_subscriptions_set_updated_at
before update on public.browser_push_subscriptions
for each row execute function public.set_browser_push_subscription_updated_at();

alter table public.browser_push_subscriptions enable row level security;
revoke all on table public.browser_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.browser_push_subscriptions to authenticated;

drop policy if exists "Users read own browser push subscriptions" on public.browser_push_subscriptions;
create policy "Users read own browser push subscriptions"
on public.browser_push_subscriptions for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users create own browser push subscriptions" on public.browser_push_subscriptions;
create policy "Users create own browser push subscriptions"
on public.browser_push_subscriptions for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own browser push subscriptions" on public.browser_push_subscriptions;
create policy "Users update own browser push subscriptions"
on public.browser_push_subscriptions for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own browser push subscriptions" on public.browser_push_subscriptions;
create policy "Users delete own browser push subscriptions"
on public.browser_push_subscriptions for delete to authenticated
using ((select auth.uid()) = user_id);

commit;
