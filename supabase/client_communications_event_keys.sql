-- StudioScrubz OS Phase 20C: communication idempotency and lifecycle events.
-- REVIEW ONLY. Do not execute automatically. Run after client_communications.sql.

alter table public.client_communications add column if not exists event_key text;
create unique index if not exists client_communications_event_key_key
  on public.client_communications(event_key) where event_key is not null;

create or replace function public.preserve_client_communication_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.communication_number = old.communication_number;
  new.sent_by_user_id = old.sent_by_user_id;
  new.sent_by_name = old.sent_by_name;
  new.created_at = old.created_at;
  new.event_key = old.event_key;
  return new;
end;
$$;
revoke all on function public.preserve_client_communication_identity() from public, anon, authenticated;

create or replace function public.record_proposal_accepted_communication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'Accepted' and old.status is distinct from 'Accepted' then
    insert into public.client_communications (
      communication_number, client_id, property_id, proposal_id,
      communication_type, channel, direction, subject, message_body,
      sent_at, status, sent_by_user_id, sent_by_name, metadata, event_key
    ) values (
      'COMM-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      new.client_id, new.property_id, new.id,
      'Proposal', 'In App', 'System', 'Proposal Accepted',
      'Proposal ' || new.proposal_number || ' was accepted on ' || to_char(coalesce(new.accepted_at, now()), 'FMMonth DD, YYYY') || '.',
      coalesce(new.accepted_at, now()), 'Sent', (select auth.uid()), null,
      jsonb_build_object('proposal_number', new.proposal_number, 'accepted_by_name', new.accepted_by_name, 'accepted_at', coalesce(new.accepted_at, now())),
      'proposal:' || new.id::text || ':accepted'
    ) on conflict (event_key) where event_key is not null do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.record_proposal_accepted_communication() from public, anon, authenticated;
drop trigger if exists record_proposal_accepted_communication on public.proposals;
create trigger record_proposal_accepted_communication
after update on public.proposals for each row execute function public.record_proposal_accepted_communication();

create or replace function public.record_agreement_accepted_communication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_signed_at is not null and old.client_signed_at is null and new.status = 'Accepted' then
    insert into public.client_communications (
      communication_number, client_id, property_id, agreement_id,
      communication_type, channel, direction, subject, message_body,
      sent_at, status, sent_by_user_id, sent_by_name, metadata, event_key
    ) values (
      'COMM-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      new.client_id, new.property_id, new.id,
      'Service Agreement', 'In App', 'System', 'Service Agreement Accepted',
      'Service Agreement ' || new.agreement_number || ' was signed by ' || coalesce(new.client_signed_name, 'Client') || ' on ' || to_char(new.client_signed_at, 'FMMonth DD, YYYY') || '.',
      new.client_signed_at, 'Sent', null, coalesce(new.client_signed_name, 'Client'),
      jsonb_build_object('agreement_number', new.agreement_number, 'signed_name', new.client_signed_name, 'signed_at', new.client_signed_at),
      'agreement:' || new.id::text || ':accepted'
    ) on conflict (event_key) where event_key is not null do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.record_agreement_accepted_communication() from public, anon, authenticated;
drop trigger if exists record_agreement_accepted_communication on public.service_agreements;
create trigger record_agreement_accepted_communication
after update on public.service_agreements for each row execute function public.record_agreement_accepted_communication();

-- These trigger functions are not callable APIs. They add no anon table grants and
-- store only client-facing snapshots; signing tokens and signing URLs are excluded.
