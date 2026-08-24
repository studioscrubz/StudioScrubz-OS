-- StudioScrubz OS: read-only diagnostic for currently derived Urgent Attention items.
-- REVIEW ONLY. This file contains SELECT statements only. Do not execute automatically.

with urgent_candidates as (
  select
    'job:' || j.id::text || ':invoice' as attention_key,
    'Completed Job Needs Invoice'::text as attention_type,
    'jobs'::text as source_table,
    j.id as source_record_id,
    j.job_number as source_label,
    j.status as source_status,
    j.archived_at,
    null::uuid as downstream_record_id,
    'Job is Completed; authoritative Job price is greater than zero; no active usable Invoice, linked Payment history, or fully-paid Invoice snapshot resolves it; and it is not an occurrence Job billed by a non-Per Visit Agreement.'::text as evaluated_condition
  from public.jobs j
  where j.status = 'Completed'
    and j.archived_at is null
    and j.price > 0
    and not exists (
      select 1
      from public.invoices i
      where i.job_id = j.id
        and (
          (i.archived_at is null and i.status not in ('Cancelled', 'Archived'))
          or exists (
            select 1 from public.payments payment
            where payment.invoice_id = i.id
          )
          or (i.amount_paid > 0 and i.balance_due <= 0)
        )
    )
    and not exists (
      select 1
      from public.service_occurrences o
      join public.service_agreements a on a.id = o.agreement_id
      where o.id = j.service_occurrence_id
        and a.billing_type <> 'Per Visit'
    )

  union all

  select
    'proposal:' || p.id::text || ':route',
    'Accepted Proposal Needs Routing',
    'proposals',
    p.id,
    p.proposal_number,
    p.status,
    p.archived_at,
    null::uuid,
    case
      when p.frequency = 'One-Time'
        then 'Proposal is Accepted/accepted=true and no non-archived Job references it.'
      else 'Proposal is Accepted/accepted=true and no active, non-archived Service Agreement references it.'
    end
  from public.proposals p
  where p.status = 'Accepted'
    and p.accepted = true
    and p.archived_at is null
    and (
      (
        p.frequency = 'One-Time'
        and not exists (
          select 1 from public.jobs j
          where j.proposal_id = p.id
            and j.archived_at is null
        )
      )
      or
      (
        p.frequency <> 'One-Time'
        and not exists (
          select 1 from public.service_agreements a
          where a.proposal_id = p.id
            and a.archived_at is null
            and a.status not in ('Cancelled', 'Archived')
        )
      )
    )

  union all

  select
    'invoice:' || i.id::text || ':overdue',
    'Overdue Invoice',
    'invoices',
    i.id,
    i.invoice_number,
    i.status,
    i.archived_at,
    coalesce(i.job_id, i.service_agreement_id),
    'Invoice is not archived/Paid/Cancelled/Archived, has balance_due > 0, and due_date is earlier than the current business date.'
  from public.invoices i
  cross join lateral (
    select (now() at time zone coalesce(
      (select timezone from public.business_settings limit 1),
      'UTC'
    ))::date as business_date
  ) clock
  where i.archived_at is null
    and i.balance_due > 0
    and i.status not in ('Paid', 'Cancelled', 'Archived')
    and i.due_date < clock.business_date

  union all

  select
    'communication:' || c.id::text || ':failed',
    'Failed Client Communication',
    'client_communications',
    c.id,
    c.communication_number,
    c.status,
    c.archived_at,
    null::uuid,
    'Communication status is Failed, it is not archived, and no Sent communication identifies it as retry_of_communication_id.'
  from public.client_communications c
  where c.status = 'Failed'
    and c.archived_at is null
    and not exists (
      select 1
      from public.client_communications retry
      where retry.status = 'Sent'
        and retry.metadata ->> 'retry_of_communication_id' = c.id::text
    )
), state_summary as (
  select
    s.attention_key,
    count(*) as attention_state_rows,
    jsonb_agg(jsonb_build_object(
      'user_id', s.user_id,
      'state', s.state,
      'snoozed_until', s.snoozed_until,
      'dismissed_at', s.dismissed_at
    ) order by s.updated_at desc) as attention_states
  from public.attention_item_states s
  group by s.attention_key
)
select
  c.attention_key,
  c.attention_type,
  'Urgent'::text as severity,
  c.source_table,
  c.source_record_id,
  c.source_label,
  c.source_status,
  c.archived_at,
  c.downstream_record_id,
  c.evaluated_condition,
  coalesce(s.attention_state_rows, 0) as attention_state_rows,
  s.attention_states,
  'Survives because the operational predicate above is currently true; persisted state cannot create this candidate.'::text as filtering_result
from urgent_candidates c
left join state_summary s on s.attention_key = c.attention_key
order by c.attention_type, c.source_label, c.source_record_id;

-- Duplicate-key check. Expected result: zero rows.
with urgent_keys as (
  select 'job:' || j.id::text || ':invoice' as attention_key
  from public.jobs j
  where j.status = 'Completed' and j.archived_at is null and j.price > 0
    and not exists (
      select 1 from public.invoices i
      where i.job_id = j.id
        and (
          (i.archived_at is null and i.status not in ('Cancelled','Archived'))
          or exists (select 1 from public.payments payment where payment.invoice_id = i.id)
          or (i.amount_paid > 0 and i.balance_due <= 0)
        )
    )
    and not exists (
      select 1 from public.service_occurrences o join public.service_agreements a on a.id = o.agreement_id
      where o.id = j.service_occurrence_id and a.billing_type <> 'Per Visit'
    )
  union all
  select 'proposal:' || p.id::text || ':route'
  from public.proposals p
  where p.status = 'Accepted' and p.accepted and p.archived_at is null
    and ((p.frequency = 'One-Time' and not exists (select 1 from public.jobs j where j.proposal_id = p.id and j.archived_at is null))
      or (p.frequency <> 'One-Time' and not exists (select 1 from public.service_agreements a where a.proposal_id = p.id and a.archived_at is null and a.status not in ('Cancelled','Archived'))))
  union all
  select 'invoice:' || i.id::text || ':overdue'
  from public.invoices i
  where i.archived_at is null and i.balance_due > 0 and i.status not in ('Paid','Cancelled','Archived')
    and i.due_date < (now() at time zone coalesce((select timezone from public.business_settings limit 1), 'UTC'))::date
  union all
  select 'communication:' || c.id::text || ':failed'
  from public.client_communications c
  where c.status = 'Failed' and c.archived_at is null
    and not exists (select 1 from public.client_communications retry where retry.status = 'Sent' and retry.metadata ->> 'retry_of_communication_id' = c.id::text)
)
select attention_key, count(*) as occurrences
from urgent_keys
group by attention_key
having count(*) > 1;
