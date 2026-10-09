begin;

-- Durable, cross-instance throttling for the public proposal activity routes.
-- Only SHA-256 fingerprints are retained; raw access tokens and IP addresses
-- never enter this table. The service role is the sole caller.
create table public.proposal_public_rate_limits (
  action text not null check (action in ('view', 'decline')),
  scope text not null check (scope in ('client', 'token')),
  fingerprint text not null check (char_length(fingerprint) = 64),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  primary key (action, scope, fingerprint)
);

create index proposal_public_rate_limits_window_idx
  on public.proposal_public_rate_limits(window_started_at);

alter table public.proposal_public_rate_limits enable row level security;
revoke all on table public.proposal_public_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.proposal_public_rate_limits to service_role;

create function public.consume_proposal_public_rate_limit(
  p_action text,
  p_client_hash text,
  p_token_hash text
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  rate_window constant interval := interval '15 minutes';
  client_limit integer;
  token_limit integer;
  current_time timestamptz := clock_timestamp();
  client_count integer;
  token_count integer;
  client_window timestamptz;
  token_window timestamptz;
begin
  if p_action = 'view' then
    client_limit := 120;
    token_limit := 30;
  elsif p_action = 'decline' then
    client_limit := 20;
    token_limit := 5;
  else
    raise exception 'Unsupported proposal activity.' using errcode = '22023';
  end if;

  if p_client_hash !~ '^[0-9a-f]{64}$' or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid proposal activity fingerprint.' using errcode = '22023';
  end if;

  insert into public.proposal_public_rate_limits as rate_limit(
    action, scope, fingerprint, window_started_at, request_count
  ) values (
    p_action, 'client', p_client_hash, current_time, 1
  )
  on conflict (action, scope, fingerprint) do update
  set window_started_at = case
        when rate_limit.window_started_at <= current_time - rate_window then current_time
        else rate_limit.window_started_at
      end,
      request_count = case
        when rate_limit.window_started_at <= current_time - rate_window then 1
        else rate_limit.request_count + 1
      end
  returning request_count, window_started_at into client_count, client_window;

  insert into public.proposal_public_rate_limits as rate_limit(
    action, scope, fingerprint, window_started_at, request_count
  ) values (
    p_action, 'token', p_token_hash, current_time, 1
  )
  on conflict (action, scope, fingerprint) do update
  set window_started_at = case
        when rate_limit.window_started_at <= current_time - rate_window then current_time
        else rate_limit.window_started_at
      end,
      request_count = case
        when rate_limit.window_started_at <= current_time - rate_window then 1
        else rate_limit.request_count + 1
      end
  returning request_count, window_started_at into token_count, token_window;

  delete from public.proposal_public_rate_limits
  where window_started_at < current_time - interval '2 days';

  allowed := client_count <= client_limit and token_count <= token_limit;
  retry_after_seconds := greatest(
    1,
    ceil(extract(epoch from greatest(client_window, token_window) + rate_window - current_time))::integer
  );
  return next;
end;
$$;

revoke all on function public.consume_proposal_public_rate_limit(text, text, text)
from public, anon, authenticated;
grant execute on function public.consume_proposal_public_rate_limit(text, text, text)
to service_role;

-- Keep the public payload limited to the immutable delivery snapshot plus the
-- existing lifecycle fields. Declined proposals remain readable through their
-- valid token but are never actionable.
create or replace function public.get_proposal_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This proposal link is invalid, expired, or no longer available.';
  end if;

  select p.client_delivery_snapshot || jsonb_build_object(
    'status', p.status,
    'revision_number', p.revision_number,
    'is_current_revision', p.is_current_revision,
    'superseded', not p.is_current_revision,
    'accepted_at', p.accepted_at,
    'accepted_by_name', p.accepted_by_name,
    'client_acceptance_consent', p.client_acceptance_consent,
    'declined_at', p.declined_at,
    'business_name', coalesce(bs.business_name, 'StudioScrubz'),
    'tagline', bs.tagline,
    'business_email', bs.business_email,
    'business_phone', bs.business_phone,
    'website', bs.website,
    'address', bs.address,
    'city', bs.city,
    'state', bs.state,
    'zip', bs.zip,
    'deposit_instructions', case
      when p.status = 'Accepted' and dr.id is not null then jsonb_build_object(
        'status', dr.status,
        'payment_method', dr.payment_method,
        'recipient_name', dr.recipient_name,
        'recipient_phone', dr.recipient_phone,
        'required_amount', dr.required_amount,
        'remaining_balance', dr.remaining_balance,
        'currency', dr.currency,
        'rendered_memo', dr.rendered_memo,
        'instruction_version', dr.instruction_version
      ) else null
    end
  ) into v_result
  from public.proposals p
  left join public.business_settings bs on true
  left join public.proposal_deposit_requirements dr on dr.proposal_id = p.id
  where p.client_access_token = p_token
    and p.archived_at is null
    and p.status in ('Sent', 'Viewed', 'Accepted', 'Declined')
    and p.client_delivery_snapshot is not null
    and (p.status in ('Accepted', 'Declined') or p.expiration_date >= current_date)
    and (p.client_access_token_expires_at is null or p.client_access_token_expires_at > now())
  limit 1;

  if v_result is null then
    raise exception 'This proposal link is invalid, expired, or no longer available.';
  end if;
  return v_result;
end;
$$;

revoke all on function public.get_proposal_by_token(text) from public, anon, authenticated;
grant execute on function public.get_proposal_by_token(text) to anon, authenticated;

-- The row lock and Sent-only transition make repeated refreshes idempotent.
create or replace function public.record_proposal_view_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal_row public.proposals;
  viewed_time timestamptz := now();
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This proposal link is invalid, expired, or no longer available.';
  end if;

  select * into proposal_row
  from public.proposals p
  where p.client_access_token = p_token
    and p.archived_at is null
    and p.status in ('Sent', 'Viewed', 'Accepted', 'Declined')
    and p.client_delivery_snapshot is not null
    and (p.status in ('Accepted', 'Declined') or p.expiration_date >= current_date)
    and (p.client_access_token_expires_at is null or p.client_access_token_expires_at > now())
  limit 1
  for update;

  if not found then
    raise exception 'This proposal link is invalid, expired, or no longer available.';
  end if;

  if proposal_row.status = 'Sent' and proposal_row.is_current_revision then
    update public.proposals
    set status = 'Viewed',
        viewed_at = coalesce(viewed_at, viewed_time)
    where id = proposal_row.id
      and status = 'Sent';

    if found then
      insert into public.proposal_history(
        proposal_id, event_type, previous_status, new_status,
        description, metadata, performed_by
      ) values (
        proposal_row.id, 'Viewed', 'Sent', 'Viewed',
        'Proposal opened through the secure client review page.',
        jsonb_build_object('revision_number', proposal_row.revision_number),
        'Client'
      );
    end if;
  end if;

  return public.get_proposal_by_token(p_token);
end;
$$;

revoke all on function public.record_proposal_view_by_token(text) from public, anon, authenticated;
grant execute on function public.record_proposal_view_by_token(text) to service_role;

create or replace function public.decline_proposal_by_token(p_token text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal_id uuid;
  revision_group uuid;
  previous_status text;
  current_revision boolean;
  v_decline_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  declined_time timestamptz := now();
  updated_count integer;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This proposal link is invalid, expired, or no longer available.';
  end if;
  if length(coalesce(v_decline_reason, '')) > 1000 then
    raise exception 'Decline feedback must be 1000 characters or fewer.';
  end if;

  select p.id, p.revision_group_id into proposal_id, revision_group
  from public.proposals p
  where p.client_access_token = p_token
  limit 1;

  if proposal_id is null then
    raise exception 'This Proposal cannot be declined because it is invalid, expired, archived, or unavailable.';
  end if;

  perform 1
  from public.proposals p
  where p.revision_group_id = revision_group
  for update;

  select p.status, p.is_current_revision into previous_status, current_revision
  from public.proposals p
  where p.id = proposal_id
    and p.archived_at is null
    and p.status in ('Sent', 'Viewed', 'Declined')
    and p.approval_status = 'Approved'
    and p.expiration_date >= current_date
    and (p.client_access_token_expires_at is null or p.client_access_token_expires_at > now());

  if previous_status is null then
    raise exception 'This Proposal cannot be declined because it is invalid, expired, archived, or unavailable.';
  end if;
  if not current_revision then
    raise exception 'This Proposal has been revised and can no longer be declined. Please review the current Proposal.';
  end if;
  if previous_status = 'Declined' then
    return public.get_proposal_by_token(p_token);
  end if;

  update public.proposals
  set status = 'Declined',
      accepted = false,
      declined_at = declined_time,
      decline_reason = v_decline_reason
  where id = proposal_id
    and status in ('Sent', 'Viewed')
    and accepted = false
    and is_current_revision = true;

  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'This Proposal changed before the decline could be completed. Refresh and try again.';
  end if;

  insert into public.proposal_history(
    proposal_id, event_type, previous_status, new_status,
    description, metadata, performed_by
  ) values (
    proposal_id, 'Declined', previous_status, 'Declined',
    'Proposal declined through the secure client review page.',
    jsonb_build_object('reason_provided', v_decline_reason is not null, 'declined_at', declined_time),
    'Client'
  );

  return public.get_proposal_by_token(p_token);
end;
$$;

revoke all on function public.decline_proposal_by_token(text, text) from public, anon, authenticated;
grant execute on function public.decline_proposal_by_token(text, text) to service_role;

notify pgrst, 'reload schema';

commit;
