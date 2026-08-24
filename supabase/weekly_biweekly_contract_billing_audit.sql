-- StudioScrubz OS V2 contract billing historical audit.
-- READ ONLY / REVIEW ONLY. Do not execute automatically.

-- Weekly and Biweekly Agreements, including inactive and historical records.
select id, agreement_number, division, frequency, billing_type, billing_amount,
       start_date, end_date, status, created_at, archived_at
from public.service_agreements
where billing_type in ('Weekly','Biweekly')
order by created_at;

-- Occurrence Jobs that carry a nonzero amount under Agreement-level billing.
select a.agreement_number, a.billing_type, o.id as occurrence_id, o.scheduled_date,
       j.id as job_id, j.job_number, j.status as job_status, j.price, j.balance
from public.service_agreements a
join public.service_occurrences o on o.agreement_id = a.id
join public.jobs j on j.service_occurrence_id = o.id
where a.billing_type in ('Weekly','Biweekly') and (j.price <> 0 or j.balance <> 0)
order by o.scheduled_date;

-- Active completed-Job invoices that may overlap Agreement-level billing intent.
select a.agreement_number, a.billing_type, o.scheduled_date, j.job_number,
       i.invoice_number, i.status, i.total, i.amount_paid, i.balance_due, i.created_at
from public.service_agreements a
join public.service_occurrences o on o.agreement_id = a.id
join public.jobs j on j.service_occurrence_id = o.id
join public.invoices i on i.job_id = j.id
where a.billing_type in ('Weekly','Biweekly')
  and i.archived_at is null and i.status not in ('Cancelled','Archived')
order by i.created_at;

-- Period-level rollup to identify possible multiple Job invoices in one anchored period.
select a.id as agreement_id, a.agreement_number, a.billing_type,
       (a.start_date + (
         floor((o.scheduled_date - a.start_date)::numeric /
           case when a.billing_type = 'Weekly' then 7 else 14 end)
         * case when a.billing_type = 'Weekly' then 7 else 14 end
       )::integer) as anchored_period_start,
       count(distinct i.id) as invoice_count, sum(i.total) as invoiced_total,
       a.billing_amount as intended_period_amount
from public.service_agreements a
join public.service_occurrences o on o.agreement_id = a.id
join public.jobs j on j.service_occurrence_id = o.id
join public.invoices i on i.job_id = j.id
where a.billing_type in ('Weekly','Biweekly')
  and i.archived_at is null and i.status not in ('Cancelled','Archived')
group by a.id, a.agreement_number, a.billing_type, anchored_period_start, a.billing_amount
having count(distinct i.id) > 1 or sum(i.total) > a.billing_amount
order by anchored_period_start;
