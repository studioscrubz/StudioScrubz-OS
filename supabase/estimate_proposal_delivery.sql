-- StudioScrubz OS: secure public Estimate and Proposal delivery.
-- REVIEW ONLY. Do not execute automatically.

alter table public.estimates
  add column if not exists sent_at timestamptz,
  add column if not exists sent_to text,
  add column if not exists sent_by text,
  add column if not exists client_access_token text,
  add column if not exists client_access_token_expires_at timestamptz,
  add column if not exists client_delivery_snapshot jsonb;

alter table public.proposals
  add column if not exists sent_to text,
  add column if not exists sent_by text,
  add column if not exists client_access_token text,
  add column if not exists client_access_token_expires_at timestamptz,
  add column if not exists client_delivery_snapshot jsonb,
  add column if not exists client_acceptance_consent text,
  add column if not exists client_acceptance_consent_at timestamptz;

create unique index if not exists estimates_client_access_token_key on public.estimates(client_access_token) where client_access_token is not null;
create unique index if not exists proposals_client_access_token_key on public.proposals(client_access_token) where client_access_token is not null;
create index if not exists estimates_client_access_token_expires_idx on public.estimates(client_access_token_expires_at) where client_access_token is not null;
create index if not exists proposals_client_access_token_expires_idx on public.proposals(client_access_token_expires_at) where client_access_token is not null;

create or replace function public.protect_document_delivery_snapshots()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_controlled boolean := coalesce(current_setting('studioscrubz.controlled_delivery_snapshot', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.client_delivery_snapshot is not null and not v_controlled then raise exception 'A client delivery snapshot may only be established by the controlled send operation.'; end if;
    return new;
  end if;
  if tg_table_name = 'proposals' and old.status = 'Accepted' and new.client_delivery_snapshot is distinct from old.client_delivery_snapshot then
    raise exception 'An accepted Proposal snapshot is immutable.';
  end if;
  if new.client_delivery_snapshot is distinct from old.client_delivery_snapshot and not v_controlled then
    raise exception 'A client delivery snapshot may only be changed by the controlled send operation.';
  end if;
  return new;
end; $$;
revoke all on function public.protect_document_delivery_snapshots() from public, anon, authenticated;
drop trigger if exists estimates_protect_delivery_snapshot on public.estimates;
create trigger estimates_protect_delivery_snapshot before insert or update on public.estimates for each row execute function public.protect_document_delivery_snapshots();
drop trigger if exists proposals_protect_delivery_snapshot on public.proposals;
create trigger proposals_protect_delivery_snapshot before insert or update on public.proposals for each row execute function public.protect_document_delivery_snapshots();

create or replace function public.mark_estimate_sent_for_delivery(p_estimate_id uuid,p_recipient text,p_sender text,p_token text,p_token_expires_at timestamptz,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_record public.estimates%rowtype;
begin
  if (select auth.uid()) is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then raise exception 'You do not have permission to send Estimates.'; end if;
  if length(btrim(coalesce(p_recipient,''))) < 3 then raise exception 'A client email address is required.'; end if;
  if p_token is null or length(p_token) < 32 then raise exception 'A secure Estimate token is required.'; end if;
  if p_token_expires_at <= now() then raise exception 'The Estimate token expiration must be in the future.'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'A client-facing Estimate snapshot is required.'; end if;
  perform set_config('studioscrubz.controlled_delivery_snapshot','on',true);
  update public.estimates set sent_at=now(),sent_to=btrim(p_recipient),sent_by=nullif(btrim(coalesce(p_sender,'')),''),client_access_token=p_token,client_access_token_expires_at=p_token_expires_at,client_delivery_snapshot=p_snapshot
  where id=p_estimate_id and archived_at is null and status='Open' returning * into v_record;
  if v_record.id is null then raise exception 'This Estimate is unavailable for delivery.'; end if;
  return jsonb_build_object('sent_at', v_record.sent_at);
end; $$;

create or replace function public.mark_proposal_sent_for_delivery(p_proposal_id uuid,p_via text,p_recipient text,p_sender text,p_token text,p_token_expires_at timestamptz,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_record public.proposals%rowtype; v_previous text;
begin
  if (select auth.uid()) is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then raise exception 'You do not have permission to send Proposals.'; end if;
  if p_via not in ('Email','Text') then raise exception 'Proposal delivery must use Email or Text.'; end if;
  if length(btrim(coalesce(p_recipient,''))) < 3 then raise exception 'A client recipient is required.'; end if;
  if p_token is null or length(p_token) < 32 then raise exception 'A secure Proposal token is required.'; end if;
  if p_token_expires_at <= now() then raise exception 'The Proposal token expiration must be in the future.'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'A client-facing Proposal snapshot is required.'; end if;
  select status into v_previous from public.proposals where id=p_proposal_id for update;
  if v_previous not in ('Approved','Sent','Viewed') then raise exception 'This Proposal is unavailable for delivery.'; end if;
  perform set_config('studioscrubz.controlled_delivery_snapshot','on',true);
  update public.proposals set status='Sent',sent_at=now(),sent_via=p_via,sent_to=btrim(p_recipient),sent_by=nullif(btrim(coalesce(p_sender,'')),''),client_access_token=p_token,client_access_token_expires_at=p_token_expires_at,client_delivery_snapshot=p_snapshot
  where id=p_proposal_id and archived_at is null and approval_status='Approved' and accepted=false and expiration_date>=current_date returning * into v_record;
  if v_record.id is null then raise exception 'This Proposal is expired, archived, accepted, or unavailable for delivery.'; end if;
  insert into public.proposal_history(proposal_id,event_type,previous_status,new_status,description,metadata,performed_by)
  values(v_record.id,'Sent by '||p_via,v_previous,'Sent',null,'{}'::jsonb,coalesce(nullif(btrim(p_sender),''),'StudioScrubz User'));
  return jsonb_build_object('sent_at', v_record.sent_at);
end; $$;

create or replace function public.get_estimate_by_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'This estimate link is invalid, expired, or no longer available.'; end if;
  select e.client_delivery_snapshot || jsonb_build_object(
    'status', e.status, 'sent_at', e.sent_at,
    'business_name', coalesce(bs.business_name, 'StudioScrubz'), 'tagline', bs.tagline,
    'business_email', bs.business_email, 'business_phone', bs.business_phone, 'website', bs.website,
    'address', bs.address, 'city', bs.city, 'state', bs.state, 'zip', bs.zip
  ) into v_result
  from public.estimates e left join public.business_settings bs on true
  where e.client_access_token = p_token and e.archived_at is null and e.status = 'Open'
    and e.client_delivery_snapshot is not null
    and (e.client_access_token_expires_at is null or e.client_access_token_expires_at > now()) limit 1;
  if v_result is null then raise exception 'This estimate link is invalid, expired, or no longer available.'; end if;
  return v_result;
end; $$;

create or replace function public.get_proposal_by_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'This proposal link is invalid, expired, or no longer available.'; end if;
  select p.client_delivery_snapshot || jsonb_build_object(
    'status', p.status, 'accepted_at', p.accepted_at, 'accepted_by_name', p.accepted_by_name,
    'client_acceptance_consent', p.client_acceptance_consent,
    'business_name', coalesce(bs.business_name, 'StudioScrubz'), 'tagline', bs.tagline,
    'business_email', bs.business_email, 'business_phone', bs.business_phone, 'website', bs.website,
    'address', bs.address, 'city', bs.city, 'state', bs.state, 'zip', bs.zip
  ) into v_result
  from public.proposals p left join public.business_settings bs on true
  where p.client_access_token = p_token and p.archived_at is null and p.status in ('Sent','Viewed','Accepted')
    and p.client_delivery_snapshot is not null
    and (p.status = 'Accepted' or p.expiration_date >= current_date)
    and (p.client_access_token_expires_at is null or p.client_access_token_expires_at > now()) limit 1;
  if v_result is null then raise exception 'This proposal link is invalid, expired, or no longer available.'; end if;
  return v_result;
end; $$;

create or replace function public.accept_proposal_by_token(p_token text, p_accepted_by_name text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_accepted_by_name, ''));
  v_consent constant text := 'I have reviewed and accept this Proposal.';
  v_id uuid;
  v_previous_status text;
  v_accepted_at timestamptz := now();
  v_updated_count integer;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'This proposal link is invalid, expired, or no longer available.'; end if;
  if p_consent is distinct from true then raise exception 'Explicit consent is required to accept this Proposal.'; end if;
  if length(v_name) < 2 or length(v_name) > 150 then raise exception 'Enter a valid full name.'; end if;
  select p.id, p.status into v_id, v_previous_status from public.proposals p
  where p.client_access_token = p_token and p.archived_at is null and p.status in ('Sent','Viewed')
    and p.approval_status = 'Approved' and p.accepted = false
    and p.expiration_date >= current_date
    and (p.client_access_token_expires_at is null or p.client_access_token_expires_at > now())
  limit 1 for update;
  if v_id is null then raise exception 'This Proposal cannot be accepted because it is invalid, expired, archived, or already accepted.'; end if;
  perform set_config('studioscrubz.controlled_proposal_acceptance','on',true);
  update public.proposals set status='Accepted', accepted=true, accepted_at=v_accepted_at, accepted_by_name=v_name,
    acceptance_method='Signed Proposal', client_acceptance_consent=v_consent, client_acceptance_consent_at=v_accepted_at
  where id=v_id and client_access_token=p_token and archived_at is null and status in ('Sent','Viewed')
    and approval_status='Approved' and accepted=false and expiration_date>=current_date
    and (client_access_token_expires_at is null or client_access_token_expires_at>now());
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then raise exception 'This Proposal changed before acceptance could be completed. Refresh and try again.'; end if;
  insert into public.proposal_history(proposal_id,event_type,previous_status,new_status,description,metadata,performed_by)
    values(v_id,'Accepted',v_previous_status,'Accepted','Proposal accepted through the secure client review page.',jsonb_build_object('accepted_by_name',v_name,'accepted_at',v_accepted_at),'Client');
  return public.get_proposal_by_token(p_token);
end; $$;

revoke all on function public.get_estimate_by_token(text) from public, anon, authenticated;
revoke all on function public.get_proposal_by_token(text) from public, anon, authenticated;
revoke all on function public.accept_proposal_by_token(text,text,boolean) from public, anon, authenticated;
revoke all on function public.mark_estimate_sent_for_delivery(uuid,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.mark_proposal_sent_for_delivery(uuid,text,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.get_estimate_by_token(text) to anon, authenticated;
grant execute on function public.get_proposal_by_token(text) to anon, authenticated;
grant execute on function public.accept_proposal_by_token(text,text,boolean) to anon, authenticated;
grant execute on function public.mark_estimate_sent_for_delivery(uuid,text,text,text,timestamptz,jsonb) to authenticated;
grant execute on function public.mark_proposal_sent_for_delivery(uuid,text,text,text,text,timestamptz,jsonb) to authenticated;

-- No anon table privileges or RLS policies are added. Public access is limited to
-- immutable client-facing snapshots selected by high-entropy document tokens.
