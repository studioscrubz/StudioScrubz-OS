-- Tightens Company Announcement sending to Master Admin and Administrator only.
-- Managers previously could send announcements; this migration removes that grant.
-- Replaces the function body from 20260903141751_add_internal_messaging_foundation.sql
-- without modifying the already-applied migration file itself.
begin;

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
    'Master Admin', 'Administrator'
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

revoke all on function public.send_company_announcement(text,text,text) from public, anon, authenticated;
grant execute on function public.send_company_announcement(text,text,text) to authenticated;

commit;
