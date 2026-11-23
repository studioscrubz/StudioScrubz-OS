-- Keep crew-specific Google Calendar invitations aligned with edited job rosters.
-- Avoid touching completed/archived historical jobs.
create or replace function public.queue_job_calendar_sync_after_roster_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
 job_id uuid;
 job_row record;
 connection_row public.google_calendar_connections%rowtype;
begin
 job_id := case when tg_op='DELETE' then old.job_id else new.job_id end;
 select status,scheduled_date,start_time into job_row from public.jobs where id=job_id;
 if not found or job_row.scheduled_date is null or job_row.start_time is null
   or job_row.scheduled_date < (now() at time zone 'America/Los_Angeles')::date
   or job_row.status in ('Completed','Cancelled','Archived')
 then return null; end if;
 select * into connection_row from public.google_calendar_connections limit 1;
 if not found or connection_row.encrypted_refresh_token is null
   or connection_row.calendar_id is null or not connection_row.sync_job_changes
 then return null; end if;
 insert into public.job_calendar_syncs(job_id,connection_id,sync_status,last_sync_error,updated_at)
 values(job_id,connection_row.id,'Pending',null,now())
 on conflict(job_id) do update set
   connection_id=excluded.connection_id,
   sync_status='Pending',last_sync_error=null,updated_at=now();
 return null;
end;
$$;
revoke all on function public.queue_job_calendar_sync_after_roster_change() from public,anon,authenticated;
drop trigger if exists job_crew_technicians_queue_calendar_sync on public.job_crew_technicians;
create trigger job_crew_technicians_queue_calendar_sync
after insert or delete or update of employee_id,crew_id on public.job_crew_technicians
for each row execute function public.queue_job_calendar_sync_after_roster_change();
