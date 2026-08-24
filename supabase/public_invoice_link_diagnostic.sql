-- StudioScrubz OS: read-only public Invoice link diagnostic.
-- REVIEW ONLY. Replace one optional parameter below, then run manually.
-- This file contains SELECT statements only and never returns the full token.

with diagnostic_input as (
  select
    null::text as invoice_number, -- Example: 'INV-20260822-5257'
    null::text as public_token    -- Optional: paste the token from /invoice/<token>
), invoice_match as (
  select i.*,
    input.public_token,
    input.invoice_number as requested_invoice_number
  from public.invoices i
  cross join diagnostic_input input
  where (input.invoice_number is not null and i.invoice_number = input.invoice_number)
     or (input.public_token is not null and i.client_access_token = input.public_token)
)
select
  i.id,
  i.invoice_number,
  i.status,
  i.total,
  i.amount_paid,
  i.balance_due,
  i.archived_at,
  i.client_access_token is not null as token_present,
  coalesce(length(i.client_access_token), 0) as token_length,
  case
    when i.public_token is null then null
    else i.client_access_token = i.public_token
  end as supplied_token_matches,
  i.client_access_token_expires_at as token_expires_at,
  i.client_access_token_expires_at is not null
    and i.client_access_token_expires_at <= now() as token_expired,
  i.job_id,
  i.service_agreement_id,
  i.created_at,
  (select count(*) from public.payments p where p.invoice_id = i.id) as payment_count,
  (select coalesce(sum(p.amount), 0) from public.payments p where p.invoice_id = i.id) as payment_principal_total,
  (select count(*) from public.square_checkout_attempts a where a.invoice_id = i.id) as square_attempt_count,
  (select a.status
     from public.square_checkout_attempts a
    where a.invoice_id = i.id
    order by a.created_at desc
    limit 1) as latest_square_attempt_status,
  case
    when i.public_token is not null and length(i.public_token) < 40 then 'Provided token is shorter than the RPC minimum.'
    when i.public_token is not null and i.client_access_token is distinct from i.public_token then 'Provided token does not match this Invoice.'
    when i.client_access_token is null then 'Invoice has no public token.'
    when length(i.client_access_token) < 40 then 'Stored token is shorter than the RPC minimum.'
    when i.client_access_token_expires_at is not null and i.client_access_token_expires_at <= now() then 'Stored token is expired.'
    else 'Current get_invoice_by_token token predicates pass.'
  end as public_rpc_token_result
from invoice_match i
order by i.created_at desc;
