-- StudioScrubz OS Phase 20A: client communication history foundation.
-- REVIEW ONLY. Do not execute automatically.

create table if not exists public.client_communications (
  id uuid primary key default gen_random_uuid(),
  communication_number text not null unique,
  client_id uuid references public.clients(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  estimate_id uuid references public.estimates(id) on delete set null,
  proposal_id uuid references public.proposals(id) on delete set null,
  agreement_id uuid references public.service_agreements(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  communication_type text not null,
  channel text not null check (channel in ('Email','SMS','Phone','In App','Other')),
  direction text not null default 'Outbound' check (direction in ('Outbound','Inbound','System')),
  subject text,
  message_body text,
  recipient_email text,
  recipient_phone text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  status text not null default 'Prepared' check (status in ('Prepared','Sent','Delivered','Opened','Failed','Cancelled','Archived')),
  provider text,
  provider_message_id text,
  failure_reason text,
  sent_by_user_id uuid references public.user_profiles(id) on delete set null,
  sent_by_name text,
  metadata jsonb not null default '{}'::jsonb,
  event_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint client_communications_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists client_communications_client_idx on public.client_communications(client_id);
create index if not exists client_communications_property_idx on public.client_communications(property_id);
create index if not exists client_communications_estimate_idx on public.client_communications(estimate_id);
create index if not exists client_communications_proposal_idx on public.client_communications(proposal_id);
create index if not exists client_communications_agreement_idx on public.client_communications(agreement_id);
create index if not exists client_communications_invoice_idx on public.client_communications(invoice_id);
create index if not exists client_communications_type_idx on public.client_communications(communication_type);
create index if not exists client_communications_status_idx on public.client_communications(status);
create index if not exists client_communications_sent_idx on public.client_communications(sent_at desc);
create index if not exists client_communications_created_idx on public.client_communications(created_at desc);
create index if not exists client_communications_archived_idx on public.client_communications(archived_at);
create unique index if not exists client_communications_event_key_key on public.client_communications(event_key) where event_key is not null;

create or replace function public.set_client_communications_updated_at()
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

revoke all on function public.set_client_communications_updated_at() from public, anon, authenticated;
drop trigger if exists client_communications_set_updated_at on public.client_communications;
create trigger client_communications_set_updated_at
before update on public.client_communications
for each row execute function public.set_client_communications_updated_at();

create or replace function public.set_client_communication_sender_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text;
begin
  if (select auth.uid()) is not null then
    new.sent_by_user_id = (select auth.uid());
    select coalesce(nullif(up.display_name, ''), nullif(up.email, ''), 'StudioScrubz User')
      into v_name
      from public.user_profiles up
      where up.id = (select auth.uid()) and up.is_active = true;
    new.sent_by_name = coalesce(v_name, 'StudioScrubz User');
  end if;
  return new;
end;
$$;

revoke all on function public.set_client_communication_sender_snapshot() from public, anon, authenticated;
drop trigger if exists client_communications_sender_snapshot on public.client_communications;
create trigger client_communications_sender_snapshot
before insert on public.client_communications
for each row execute function public.set_client_communication_sender_snapshot();

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
drop trigger if exists client_communications_preserve_identity on public.client_communications;
create trigger client_communications_preserve_identity
before update on public.client_communications
for each row execute function public.preserve_client_communication_identity();

create or replace function public.mark_client_communication_delivery_status(
  p_communication_id uuid,
  p_status text,
  p_failure_reason text default null
)
returns public.client_communications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text := public.current_user_role();
  v_record public.client_communications%rowtype;
begin
  if v_user_id is null or v_role is null then
    raise exception 'Authenticated communication access is required.';
  end if;
  if v_role not in ('Master Admin','Administrator','Manager','Sales') then
    raise exception 'You do not have permission to update communication delivery status.';
  end if;
  if p_status not in ('Sent','Failed') then
    raise exception 'Only Sent or Failed delivery status may be recorded by this operation.';
  end if;
  if p_status = 'Failed' and nullif(btrim(coalesce(p_failure_reason, '')), '') is null then
    raise exception 'A failure reason is required.';
  end if;

  select * into v_record
  from public.client_communications
  where id = p_communication_id
  for update;
  if not found then
    raise exception 'Communication record not found.';
  end if;

  if v_role = 'Sales' then
    if v_record.sent_by_user_id is distinct from v_user_id then
      raise exception 'Sales may update only communication records they created.';
    end if;
    if v_record.communication_type not in ('Estimate','Proposal','Service Agreement','Service Reminder','General') then
      raise exception 'Sales may not update this communication type.';
    end if;
    if (p_status = 'Sent' and v_record.status <> 'Prepared')
      or (p_status = 'Failed' and v_record.status not in ('Prepared','Sent')) then
      raise exception 'This Sales communication status transition is not allowed.';
    end if;
  end if;

  update public.client_communications
  set status = p_status,
      sent_at = case when p_status = 'Sent' then now() else sent_at end,
      failure_reason = case when p_status = 'Failed' then btrim(p_failure_reason) else null end,
      delivered_at = case when p_status in ('Sent','Failed') then null else delivered_at end,
      opened_at = case when p_status in ('Sent','Failed') then null else opened_at end
  where id = p_communication_id
  returning * into v_record;

  return v_record;
end;
$$;

revoke all on function public.mark_client_communication_delivery_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_client_communication_delivery_status(uuid, text, text) to authenticated;

alter table public.client_communications enable row level security;

revoke all on table public.client_communications from public, anon, authenticated;
grant select, insert, update on table public.client_communications to authenticated;

drop policy if exists "Communication operations read" on public.client_communications;
drop policy if exists "Communication operations create" on public.client_communications;
drop policy if exists "Communication operations update" on public.client_communications;
drop policy if exists "Sales communication read" on public.client_communications;
drop policy if exists "Sales communication create" on public.client_communications;
drop policy if exists "Sales communication update" on public.client_communications;

create policy "Communication operations read"
on public.client_communications for select to authenticated
using (public.has_any_role(array['Master Admin','Administrator','Manager']));

create policy "Communication operations create"
on public.client_communications for insert to authenticated
with check (
  public.has_any_role(array['Master Admin','Administrator','Manager'])
  and sent_by_user_id = (select auth.uid())
);

create policy "Communication operations update"
on public.client_communications for update to authenticated
using (public.has_any_role(array['Master Admin','Administrator','Manager']))
with check (public.has_any_role(array['Master Admin','Administrator','Manager']));

create policy "Sales communication read"
on public.client_communications for select to authenticated
using (
  public.has_role('Sales')
  and communication_type in ('Estimate','Proposal','Service Agreement','Service Reminder','General')
);

create policy "Sales communication create"
on public.client_communications for insert to authenticated
with check (
  public.has_role('Sales')
  and communication_type in ('Estimate','Proposal','Service Agreement','Service Reminder','General')
  and sent_by_user_id = (select auth.uid())
);

-- DELETE is intentionally not granted. Crew Lead and Scrub Technician have no
-- matching policy and therefore fail closed. Communication types remain text so
-- future delivery categories do not require an enum migration.
-- Sales receives no direct UPDATE policy; its only delivery mutation path is the
-- ownership- and transition-checked RPC above.
