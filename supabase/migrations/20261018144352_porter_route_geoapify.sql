-- Durable, server-only Geoapify evidence and credit accounting for Porter Routes.
-- Geoapify documents quota as credits accumulated per 24 hours. This ledger uses
-- UTC timestamptz instants and a conservative rolling 24-hour window, avoiding an
-- assumed provider-midnight boundary and preventing boundary double-spending.
begin;

create table public.porter_property_geocodes (
  property_id uuid primary key references public.properties(id) on delete cascade,
  address_hash text not null check (char_length(address_hash)=64),
  normalized_address text not null,
  status text not null check (status in ('Pending','Verified','Needs Review','Failed','Stale')),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  formatted_address text,
  provider_place_id text,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  match_type text,
  candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(candidates)='array'),
  failure_reason text,
  verified_at timestamptz,
  reviewed_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.porter_geo_provider_requests (
  request_key text primary key check (request_key ~ '^[0-9a-f]{64}$'),
  operation text not null check (operation in ('geocode','route')),
  status text not null check (status in ('Pending','Succeeded','Failed')),
  claim_generation bigint not null default 0 check (claim_generation > 0),
  current_claim_token uuid not null unique,
  result jsonb,
  failure_reason text,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null,
  constraint porter_geo_provider_request_result check (
    (status='Pending' and result is null and failure_reason is null and completed_at is null)
    or (status='Succeeded' and result is not null and result <> 'null'::jsonb and completed_at is not null and failure_reason is null)
    or (status='Failed' and result is null and completed_at is not null and char_length(btrim(failure_reason)) >= 5)
  )
);

-- Append-only claim attempts are the authoritative credit ledger. Pending calls
-- reserve their worst-case credits; successful calls settle to documented cost.
create table public.porter_geo_credit_claims (
  claim_token uuid primary key,
  request_key text not null references public.porter_geo_provider_requests(request_key) on delete restrict,
  claim_generation bigint not null check (claim_generation > 0),
  operation text not null check (operation in ('geocode','route')),
  reserved_credits integer not null check (reserved_credits > 0),
  -- Null means the provider charge could not be verified. Zero is allowed only
  -- when the caller has positive evidence that the provider consumed no credit.
  actual_credits integer check (actual_credits is null or actual_credits >= 0),
  status text not null default 'Pending' check (status in ('Pending','Succeeded','Failed','Superseded')),
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint porter_geo_credit_claim_unique unique(request_key,claim_generation),
  constraint porter_geo_credit_claim_result check (
    (status='Pending' and actual_credits is null and completed_at is null)
    or (status='Succeeded' and actual_credits is not null and completed_at is not null)
    or (status in ('Failed','Superseded') and completed_at is not null)
  )
);
create index porter_geo_credit_claims_window_idx on public.porter_geo_credit_claims(claimed_at desc);

alter table public.porter_property_geocodes enable row level security;
alter table public.porter_geo_provider_requests enable row level security;
alter table public.porter_geo_credit_claims enable row level security;
revoke all on table public.porter_property_geocodes, public.porter_geo_provider_requests, public.porter_geo_credit_claims from public,anon,authenticated;
grant select,insert,update on table public.porter_property_geocodes, public.porter_geo_provider_requests, public.porter_geo_credit_claims to service_role;

create function public.claim_porter_geo_provider_request(
  p_request_key text, p_operation text, p_credit_limit integer,
  p_reserved_credits integer, p_ttl interval
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  existing public.porter_geo_provider_requests;
  existing_found boolean;
  rolling_credits bigint;
  next_generation bigint;
  new_claim_token uuid := extensions.gen_random_uuid();
begin
  if p_request_key !~ '^[0-9a-f]{64}$' or p_operation not in ('geocode','route')
    or p_credit_limit < 1 or p_credit_limit > 3000
    or p_reserved_credits < 1 or p_reserved_credits > p_credit_limit
    or p_ttl <= interval '0 seconds' then
    raise exception 'Invalid geographic request claim.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('porter-geo-request:'||p_request_key,0));
  select * into existing from public.porter_geo_provider_requests where request_key=p_request_key;
  existing_found := found;
  if existing_found and existing.operation is distinct from p_operation then
    raise exception 'The geographic request key belongs to a different operation.';
  end if;
  if existing_found and existing.status='Succeeded' and existing.expires_at>clock_timestamp() then
    return jsonb_build_object('state','cached','result',existing.result);
  end if;
  if existing_found and existing.status='Pending' and existing.claimed_at>clock_timestamp()-interval '2 minutes' then
    return jsonb_build_object('state','pending');
  end if;
  if existing_found and existing.status='Failed' and existing.completed_at>clock_timestamp()-interval '30 seconds' then
    return jsonb_build_object('state','retry_later');
  end if;

  -- Serialize the shared budget after the per-key claim decision. The rolling
  -- window is based on UTC instants (timestamptz), not the database session date.
  perform pg_advisory_xact_lock(hashtextextended('porter-geo-credit-budget',0));
  select coalesce(sum(coalesce(actual_credits,reserved_credits)),0) into rolling_credits
  from public.porter_geo_credit_claims
  where claimed_at > clock_timestamp()-interval '24 hours';
  if rolling_credits + p_reserved_credits > p_credit_limit then
    return jsonb_build_object('state','budget_exhausted','credits_used',rolling_credits);
  end if;

  -- A timed-out worker retains its full reservation, but loses authority to
  -- complete after the replacement token is issued.
  if existing_found and existing.status='Pending' then
    update public.porter_geo_credit_claims
    set status='Superseded',actual_credits=null,completed_at=clock_timestamp()
    where claim_token=existing.current_claim_token and status='Pending';
  end if;

  next_generation := case when existing_found then existing.claim_generation+1 else 1 end;
  insert into public.porter_geo_provider_requests(
    request_key,operation,status,claim_generation,current_claim_token,
    result,failure_reason,claimed_at,completed_at,expires_at
  ) values (
    p_request_key,p_operation,'Pending',next_generation,new_claim_token,
    null,null,clock_timestamp(),null,clock_timestamp()+p_ttl
  ) on conflict(request_key) do update set
    operation=excluded.operation,status='Pending',claim_generation=excluded.claim_generation,
    current_claim_token=excluded.current_claim_token,result=null,failure_reason=null,
    claimed_at=excluded.claimed_at,completed_at=null,expires_at=excluded.expires_at;

  insert into public.porter_geo_credit_claims(
    claim_token,request_key,claim_generation,operation,reserved_credits,claimed_at
  ) values (
    new_claim_token,p_request_key,next_generation,p_operation,p_reserved_credits,clock_timestamp()
  );
  return jsonb_build_object('state','claimed','claim_token',new_claim_token,'reserved_credits',p_reserved_credits);
end; $$;

create function public.complete_porter_geo_provider_request(
  p_request_key text, p_claim_token uuid, p_result jsonb,
  p_failure_reason text, p_actual_credits integer
) returns void language plpgsql security definer set search_path='' as $$
declare request_row public.porter_geo_provider_requests; claim_row public.porter_geo_credit_claims;
begin
  select * into request_row from public.porter_geo_provider_requests
  where request_key=p_request_key for update;
  if not found or request_row.status<>'Pending' or request_row.current_claim_token<>p_claim_token then
    raise exception 'Geographic request claim is stale or unavailable.' using errcode='40001';
  end if;
  select * into claim_row from public.porter_geo_credit_claims
  where claim_token=p_claim_token and request_key=p_request_key and status='Pending' for update;
  if not found then raise exception 'Geographic credit claim is stale or unavailable.' using errcode='40001'; end if;
  if p_actual_credits is not null and (p_actual_credits<0 or p_actual_credits>claim_row.reserved_credits) then
    raise exception 'Actual geographic credits must fit the reserved credit claim.';
  end if;
  if p_failure_reason is null then
    if p_result is null or p_result='null'::jsonb then raise exception 'A successful geographic request requires a JSON result.'; end if;
    if p_actual_credits is null then raise exception 'A successful geographic request requires verified actual credits.'; end if;
  elsif p_result is not null or char_length(btrim(p_failure_reason))<5 then
    raise exception 'A failed geographic request requires a meaningful failure reason and no result.';
  end if;

  update public.porter_geo_provider_requests set
    status=case when p_failure_reason is null then 'Succeeded' else 'Failed' end,
    result=case when p_failure_reason is null then p_result else null end,
    failure_reason=p_failure_reason,completed_at=clock_timestamp()
  where request_key=p_request_key and current_claim_token=p_claim_token and status='Pending';
  if not found then raise exception 'Geographic request claim changed during completion.' using errcode='40001'; end if;
  update public.porter_geo_credit_claims set
    status=case when p_failure_reason is null then 'Succeeded' else 'Failed' end,
    actual_credits=p_actual_credits,completed_at=clock_timestamp()
  where claim_token=p_claim_token and status='Pending';
  if not found then raise exception 'Geographic credit claim changed during completion.' using errcode='40001'; end if;
end; $$;

create function private.stale_property_geocode_on_address_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.address,new.address_line_2,new.city,new.state,new.zip)
    is distinct from (old.address,old.address_line_2,old.city,old.state,old.zip) then
    update public.porter_property_geocodes set status='Stale',updated_at=clock_timestamp() where property_id=old.id;
  end if;
  return new;
end; $$;
create trigger stale_porter_property_geocode
after update of address,address_line_2,city,state,zip on public.properties
for each row execute function private.stale_property_geocode_on_address_change();

revoke all on function public.claim_porter_geo_provider_request(text,text,integer,integer,interval)from public,anon,authenticated;
grant execute on function public.claim_porter_geo_provider_request(text,text,integer,integer,interval) to service_role;
revoke all on function public.complete_porter_geo_provider_request(text,uuid,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.complete_porter_geo_provider_request(text,uuid,jsonb,text,integer)to service_role;
revoke all on function private.stale_property_geocode_on_address_change() from public,anon,authenticated;
commit;