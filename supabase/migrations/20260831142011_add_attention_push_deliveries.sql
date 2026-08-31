-- Internal, durable per-user/per-device deduplication for Attention Web Push.
begin;

alter table public.browser_push_subscriptions
  add constraint browser_push_subscriptions_id_user_key unique (id, user_id);

create table public.attention_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attention_key text not null,
  browser_push_subscription_id uuid not null,
  delivery_status text not null default 'Pending'
    check (delivery_status in ('Pending','Sent','Failed','Suppressed')),
  attempt_count integer not null default 1 check (attempt_count between 1 and 3),
  last_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attention_push_deliveries_attention_key_check check (nullif(btrim(attention_key), '') is not null),
  constraint attention_push_deliveries_subscription_owner_fkey
    foreign key (browser_push_subscription_id, user_id)
    references public.browser_push_subscriptions(id, user_id) on delete cascade,
  constraint attention_push_deliveries_user_item_device_key unique (user_id, attention_key, browser_push_subscription_id)
);

create index attention_push_deliveries_retry_idx
  on public.attention_push_deliveries(delivery_status, last_attempt_at)
  where delivery_status <> 'Sent';

create or replace function public.set_attention_push_delivery_updated_at()
returns trigger language plpgsql security invoker set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;
revoke all on function public.set_attention_push_delivery_updated_at() from public;
create trigger attention_push_deliveries_set_updated_at before update on public.attention_push_deliveries
for each row execute function public.set_attention_push_delivery_updated_at();

alter table public.attention_push_deliveries enable row level security;
revoke all on table public.attention_push_deliveries from public, anon, authenticated;
-- No client policies or grants: delivery history is server infrastructure only.
grant select, insert, update on table public.attention_push_deliveries to service_role;

create table public.attention_push_checkpoints (
  browser_push_subscription_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  initialized_at timestamptz not null default now(),
  constraint attention_push_checkpoints_subscription_owner_fkey
    foreign key (browser_push_subscription_id, user_id)
    references public.browser_push_subscriptions(id, user_id) on delete cascade
);
alter table public.attention_push_checkpoints enable row level security;
revoke all on table public.attention_push_checkpoints from public, anon, authenticated;
grant select, insert on table public.attention_push_checkpoints to service_role;

commit;
