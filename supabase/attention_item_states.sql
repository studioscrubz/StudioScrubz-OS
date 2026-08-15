-- StudioScrubz OS Phase 21B: personal Attention Center state.
-- REVIEW ONLY. Do not execute automatically.

create table if not exists public.attention_item_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  attention_key text not null,
  state text not null check (state in ('Snoozed', 'Dismissed')),
  snoozed_until timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attention_item_states_user_key unique (user_id, attention_key),
  constraint attention_item_states_shape check (
    (state = 'Snoozed' and snoozed_until is not null and dismissed_at is null)
    or (state = 'Dismissed' and snoozed_until is null and dismissed_at is not null)
  )
);

create index if not exists attention_item_states_user_state_idx
  on public.attention_item_states(user_id, state);
create index if not exists attention_item_states_snoozed_until_idx
  on public.attention_item_states(snoozed_until)
  where state = 'Snoozed';

create or replace function public.set_attention_item_states_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_attention_item_states_updated_at() from public, anon, authenticated;
drop trigger if exists attention_item_states_set_updated_at on public.attention_item_states;
create trigger attention_item_states_set_updated_at
before update on public.attention_item_states
for each row execute function public.set_attention_item_states_updated_at();

alter table public.attention_item_states enable row level security;
revoke all on table public.attention_item_states from public, anon, authenticated;
grant select, insert, update, delete on table public.attention_item_states to authenticated;

drop policy if exists "Users read own attention state" on public.attention_item_states;
drop policy if exists "Users create own attention state" on public.attention_item_states;
drop policy if exists "Users update own attention state" on public.attention_item_states;
drop policy if exists "Users delete own attention state" on public.attention_item_states;

create policy "Users read own attention state"
on public.attention_item_states for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users create own attention state"
on public.attention_item_states for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users update own attention state"
on public.attention_item_states for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users delete own attention state"
on public.attention_item_states for delete to authenticated
using ((select auth.uid()) = user_id);

