-- Reserve one contractor request per local start minute across all companies.
create unique index contractor_opportunities_held_start_idx
 on public.contractor_opportunities(requested_date,(extract(hour from requested_time)*60+extract(minute from requested_time)))
 where requested_time is not null and status not in ('Declined','Cancelled');
