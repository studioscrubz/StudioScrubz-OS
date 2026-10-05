-- Provider-backed Communications Email lifecycle boundary.
-- Forward-only: preserves legacy mailto Email and manual device SMS records.

alter table public.client_communications
  add constraint client_communications_resend_sent_has_provider_id
  check (
    not (channel = 'Email' and direction = 'Outbound' and lower(coalesce(provider, '')) = 'resend' and status = 'Sent')
    or nullif(btrim(coalesce(provider_message_id, '')), '') is not null
  ) not valid;

alter table public.client_communications
  validate constraint client_communications_resend_sent_has_provider_id;

create or replace function public.protect_communications_resend_delivery()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and new.channel = 'Email'
     and new.direction = 'Outbound'
     and lower(coalesce(new.provider, '')) = 'resend' then
    if tg_op = 'INSERT' and (new.status <> 'Prepared' or new.provider_message_id is not null or new.sent_at is not null or new.failure_reason is not null) then
      raise exception 'Provider-backed Communications Email delivery state is server-managed.';
    end if;
    if tg_op = 'UPDATE' and (
      new.status is distinct from old.status
      or new.provider_message_id is distinct from old.provider_message_id
      or new.sent_at is distinct from old.sent_at
      or new.failure_reason is distinct from old.failure_reason
    ) then
      raise exception 'Provider-backed Communications Email delivery state is server-managed.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_communications_resend_delivery() from public, anon, authenticated;
drop trigger if exists client_communications_protect_resend_delivery on public.client_communications;
create trigger client_communications_protect_resend_delivery
before insert or update on public.client_communications
for each row execute function public.protect_communications_resend_delivery();

create or replace function public.finalize_communications_resend_email(
  p_communication_id uuid,
  p_provider_message_id text default null,
  p_failure_reason text default null
)
returns public.client_communications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.client_communications%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required.';
  end if;
  if (nullif(btrim(coalesce(p_provider_message_id, '')), '') is null)
     = (nullif(btrim(coalesce(p_failure_reason, '')), '') is null) then
    raise exception 'Provide exactly one delivery result.';
  end if;

  select * into v_record from public.client_communications where id = p_communication_id for update;
  if not found then raise exception 'Communication record not found.'; end if;
  if v_record.channel <> 'Email' or v_record.direction <> 'Outbound' or lower(coalesce(v_record.provider, '')) <> 'resend' then
    raise exception 'Communication is not a provider-backed outbound Email.';
  end if;
  if v_record.status = 'Sent' and nullif(btrim(coalesce(v_record.provider_message_id, '')), '') is not null then
    return v_record;
  end if;

  update public.client_communications
  set status = case when nullif(btrim(coalesce(p_provider_message_id, '')), '') is not null then 'Sent' else 'Failed' end,
      provider_message_id = case when nullif(btrim(coalesce(p_provider_message_id, '')), '') is not null then btrim(p_provider_message_id) else provider_message_id end,
      sent_at = case when nullif(btrim(coalesce(p_provider_message_id, '')), '') is not null then now() else null end,
      failure_reason = case when nullif(btrim(coalesce(p_provider_message_id, '')), '') is not null then null else left(btrim(p_failure_reason), 500) end
  where id = p_communication_id
  returning * into v_record;
  return v_record;
end;
$$;

revoke all on function public.finalize_communications_resend_email(uuid, text, text) from public, anon, authenticated;
grant execute on function public.finalize_communications_resend_email(uuid, text, text) to service_role;
