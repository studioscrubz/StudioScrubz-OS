-- StudioScrubz internal messaging: schema, RLS, and authoritative mutations.
begin;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('Direct', 'Announcement')),
  title text,
  created_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  direct_participant_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint conversations_kind_shape check (
    (kind = 'Direct' and direct_participant_key is not null)
    or (kind = 'Announcement' and direct_participant_key is null)
  )
);

create unique index conversations_direct_participant_key_idx
  on public.conversations(direct_participant_key)
  where kind = 'Direct' and archived_at is null;
create index conversations_last_message_idx
  on public.conversations(last_message_at desc)
  where archived_at is null;

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (conversation_id, user_id),
  constraint conversation_members_left_after_joined check (left_at is null or left_at >= joined_at)
);

create index conversation_members_user_conversation_idx
  on public.conversation_members(user_id, conversation_id)
  where left_at is null;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_user_id uuid not null references public.user_profiles(id) on delete restrict,
  body text not null,
  priority text not null default 'Normal'
    check (priority in ('Normal', 'Important', 'Requires Acknowledgment')),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  archived_at timestamptz,
  constraint messages_body_length check (
    char_length(btrim(body)) between 1 and 10000
  ),
  constraint messages_edited_after_created check (edited_at is null or edited_at >= created_at)
);

create index messages_conversation_created_idx
  on public.messages(conversation_id, created_at desc)
  where archived_at is null;

create table public.message_read_states (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index message_read_states_user_read_idx
  on public.message_read_states(user_id, read_at desc);

create table public.announcement_acknowledgments (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index announcement_acknowledgments_user_idx
  on public.announcement_acknowledgments(user_id, acknowledged_at desc);

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_current_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.conversation_members member
    join public.user_profiles profile on profile.id = member.user_id
    where member.conversation_id = p_conversation_id
      and member.user_id = (select auth.uid())
      and member.left_at is null
      and profile.is_active
  )
$$;

revoke all on function private.is_current_conversation_member(uuid) from public, anon, authenticated;
grant execute on function private.is_current_conversation_member(uuid) to authenticated;

create or replace function private.set_messaging_updated_at()
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

revoke all on function private.set_messaging_updated_at() from public, anon, authenticated;
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function private.set_messaging_updated_at();

create or replace function private.touch_conversation_from_message()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.conversations
  set last_message_at = greatest(last_message_at, new.created_at)
  where id = new.conversation_id;
  return new;
end;
$$;

revoke all on function private.touch_conversation_from_message() from public, anon, authenticated;
create trigger messages_touch_conversation
after insert on public.messages
for each row execute function private.touch_conversation_from_message();

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_read_states enable row level security;
alter table public.announcement_acknowledgments enable row level security;

revoke all on public.conversations, public.conversation_members, public.messages,
  public.message_read_states, public.announcement_acknowledgments
from public, anon, authenticated;
grant select on public.conversations, public.conversation_members, public.messages,
  public.message_read_states, public.announcement_acknowledgments
to authenticated;
grant insert, update on public.message_read_states to authenticated;

create policy "Members read conversations"
on public.conversations for select to authenticated
using (private.is_current_conversation_member(id));

create policy "Members read conversation membership"
on public.conversation_members for select to authenticated
using (private.is_current_conversation_member(conversation_id));

create policy "Members read messages"
on public.messages for select to authenticated
using (private.is_current_conversation_member(conversation_id));

create policy "Users read own message read state"
on public.message_read_states for select to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.messages message
    where message.id = message_id
      and private.is_current_conversation_member(message.conversation_id)
  )
);

create policy "Users create own message read state"
on public.message_read_states for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.messages message
    where message.id = message_id
      and private.is_current_conversation_member(message.conversation_id)
  )
);

create policy "Users update own message read state"
on public.message_read_states for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.messages message
    where message.id = message_id
      and private.is_current_conversation_member(message.conversation_id)
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.messages message
    where message.id = message_id
      and private.is_current_conversation_member(message.conversation_id)
  )
);

create policy "Users read own announcement acknowledgments"
on public.announcement_acknowledgments for select to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.messages message
    join public.conversations conversation on conversation.id = message.conversation_id
    where message.id = message_id
      and conversation.kind = 'Announcement'
      and private.is_current_conversation_member(conversation.id)
  )
);

create or replace function public.start_direct_conversation(p_other_user_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_key text;
  v_conversation public.conversations;
begin
  if v_caller is null or not exists (
    select 1 from public.user_profiles where id = v_caller and is_active
  ) then raise exception 'An active authenticated profile is required.'; end if;
  if p_other_user_id is null or p_other_user_id = v_caller then
    raise exception 'A Direct conversation requires another user.';
  end if;
  if not exists (
    select 1 from public.user_profiles where id = p_other_user_id and is_active
  ) then raise exception 'The selected recipient is unavailable.'; end if;

  v_key := least(v_caller::text, p_other_user_id::text) || ':' ||
    greatest(v_caller::text, p_other_user_id::text);
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select * into v_conversation
  from public.conversations
  where kind = 'Direct' and direct_participant_key = v_key and archived_at is null;
  if found then return v_conversation; end if;

  insert into public.conversations(kind, created_by_user_id, direct_participant_key)
  values ('Direct', v_caller, v_key)
  returning * into v_conversation;
  insert into public.conversation_members(conversation_id, user_id)
  values (v_conversation.id, v_caller), (v_conversation.id, p_other_user_id);
  return v_conversation;
end;
$$;

create or replace function public.send_direct_message(p_conversation_id uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_message public.messages;
begin
  if v_caller is null or not exists (
    select 1 from public.user_profiles where id = v_caller and is_active
  ) then raise exception 'An active authenticated profile is required.'; end if;
  if not exists (
    select 1 from public.conversations conversation
    where conversation.id = p_conversation_id
      and conversation.kind = 'Direct'
      and conversation.archived_at is null
  ) or not private.is_current_conversation_member(p_conversation_id) then
    raise exception 'Direct conversation access denied.';
  end if;
  insert into public.messages(conversation_id, sender_user_id, body, priority)
  values (p_conversation_id, v_caller, p_body, 'Normal')
  returning * into v_message;
  return v_message;
end;
$$;

create or replace function public.send_company_announcement(
  p_title text,
  p_body text,
  p_priority text default 'Normal'
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_conversation public.conversations;
  v_message public.messages;
begin
  if v_caller is null or not exists (
    select 1 from public.user_profiles where id = v_caller and is_active
  ) or not public.has_any_role(array[
    'Master Admin', 'Administrator', 'Manager'
  ]) then raise exception 'Company Announcement permission denied.'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null or char_length(btrim(p_title)) > 200 then
    raise exception 'Announcement title must be between 1 and 200 characters.';
  end if;
  if p_priority not in ('Normal', 'Important', 'Requires Acknowledgment') then
    raise exception 'Invalid Announcement priority.';
  end if;

  insert into public.conversations(kind, title, created_by_user_id)
  values ('Announcement', btrim(p_title), v_caller)
  returning * into v_conversation;
  insert into public.conversation_members(conversation_id, user_id)
  select v_conversation.id, profile.id
  from public.user_profiles profile
  where profile.is_active;
  insert into public.messages(conversation_id, sender_user_id, body, priority)
  values (v_conversation.id, v_caller, p_body, p_priority)
  returning * into v_message;
  return v_message;
end;
$$;

create or replace function public.mark_messages_read(
  p_conversation_id uuid,
  p_message_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_count integer;
begin
  if v_caller is null or not private.is_current_conversation_member(p_conversation_id) then
    raise exception 'Conversation access denied.';
  end if;
  insert into public.message_read_states(message_id, user_id, read_at)
  select message.id, v_caller, now()
  from public.messages message
  where message.conversation_id = p_conversation_id
    and message.archived_at is null
    and (p_message_ids is null or message.id = any(p_message_ids))
  on conflict (message_id, user_id) do update set read_at = excluded.read_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.acknowledge_required_announcement(p_message_id uuid)
returns public.announcement_acknowledgments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_acknowledgment public.announcement_acknowledgments;
begin
  if v_caller is null or not exists (
    select 1
    from public.messages message
    join public.conversations conversation on conversation.id = message.conversation_id
    join public.conversation_members member
      on member.conversation_id = conversation.id
      and member.user_id = v_caller
      and member.left_at is null
    join public.user_profiles profile on profile.id = member.user_id and profile.is_active
    where message.id = p_message_id
      and message.archived_at is null
      and conversation.kind = 'Announcement'
      and conversation.archived_at is null
      and message.priority = 'Requires Acknowledgment'
  ) then raise exception 'Required Announcement acknowledgment access denied.'; end if;
  insert into public.announcement_acknowledgments(message_id, user_id)
  values (p_message_id, v_caller)
  on conflict (message_id, user_id) do update
    set acknowledged_at = public.announcement_acknowledgments.acknowledged_at
  returning * into v_acknowledgment;
  return v_acknowledgment;
end;
$$;

revoke all on function public.start_direct_conversation(uuid) from public, anon, authenticated;
revoke all on function public.send_direct_message(uuid,text) from public, anon, authenticated;
revoke all on function public.send_company_announcement(text,text,text) from public, anon, authenticated;
revoke all on function public.mark_messages_read(uuid,uuid[]) from public, anon, authenticated;
revoke all on function public.acknowledge_required_announcement(uuid) from public, anon, authenticated;
grant execute on function public.start_direct_conversation(uuid) to authenticated;
grant execute on function public.send_direct_message(uuid,text) to authenticated;
grant execute on function public.send_company_announcement(text,text,text) to authenticated;
grant execute on function public.mark_messages_read(uuid,uuid[]) to authenticated;
grant execute on function public.acknowledge_required_announcement(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
