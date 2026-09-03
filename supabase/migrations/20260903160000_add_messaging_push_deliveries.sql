-- Durable per-recipient/per-message/per-device dedup for Direct Message Web Push.
-- Kept separate from attention_push_deliveries per messaging push architecture rules.
begin;
create table public.messaging_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  browser_push_subscription_id uuid not null,
  delivery_status text not null default 'Pending'
    check (delivery_status in ('Pending','Sent','Failed')),
  attempt_count integer not null default 1 check (attempt_count between 1 and 3),
  last_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messaging_push_deliveries_subscription_owner_fkey
    foreign key (browser_push_subscription_id, recipient_user_id)
    references public.browser_push_subscriptions(id, user_id) on delete cascade,
  constraint messaging_push_deliveries_recipient_message_device_key
    unique (recipient_user_id, message_id, browser_push_subscription_id)
);
create index messaging_push_deliveries_retry_idx
  on public.messaging_push_deliveries(delivery_status, last_attempt_at)
  where delivery_status <> 'Sent';
create or replace function public.set_messaging_push_delivery_updated_at()
returns trigger language plpgsql security invoker set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;
revoke all on function public.set_messaging_push_delivery_updated_at() from public;
create trigger messaging_push_deliveries_set_updated_at before update on public.messaging_push_deliveries
for each row execute function public.set_messaging_push_delivery_updated_at();
alter table public.messaging_push_deliveries enable row level security;
revoke all on table public.messaging_push_deliveries from public, anon, authenticated;
-- No client policies or grants: delivery history is server infrastructure only.
grant select, insert, update on table public.messaging_push_deliveries to service_role;
commit;
