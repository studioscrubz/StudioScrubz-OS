alter table public.jobs add column source_contractor_opportunity_id uuid
 references public.contractor_opportunities(id) on delete restrict;

create unique index jobs_contractor_schedule_visit_idx
 on public.jobs(source_contractor_opportunity_id,scheduled_date)
 where source_contractor_opportunity_id is not null;

create or replace function private.require_agreement_for_recurring_contractor_job()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.contractor_companies c where c.client_id=new.client_id) then
  return new;
 end if;
 if new.frequency is distinct from 'One-Time' and new.source_contractor_opportunity_id is null
  and not exists(
   select 1 from public.service_occurrences o join public.service_agreements a on a.id=o.agreement_id
   where o.id=new.service_occurrence_id and a.client_id=new.client_id and a.property_id=new.property_id
    and a.status='Active' and a.archived_at is null
  ) then
  raise exception 'Use the contractor opportunity or an active agreement to schedule recurring visits.';
 end if;
 if new.source_contractor_opportunity_id is not null and (
  not private.contractor_is_internal() or not exists(
   select 1 from public.contractor_opportunities o join public.contractor_companies c on c.id=o.company_id
   where o.id=new.source_contractor_opportunity_id and o.request_property_id=new.property_id
    and c.client_id=new.client_id and c.status='Active'
  )
 ) then raise exception 'Contractor schedule does not match this job.'; end if;
 if new.service_occurrence_id is not null or new.source_contractor_opportunity_id is not null then
  perform pg_advisory_xact_lock(hashtextextended(new.property_id::text,0));
  if exists(
   select 1 from public.jobs j where j.client_id=new.client_id and j.property_id=new.property_id
    and regexp_replace(lower(btrim(j.service_name)), '^custom +', '')=regexp_replace(lower(btrim(new.service_name)), '^custom +', '')
    and j.scheduled_date=new.scheduled_date and j.start_time is not distinct from new.start_time
    and j.archived_at is null and j.status not in ('Cancelled','Archived')
  ) then raise exception 'A Job already exists for this contractor appointment.'; end if;
 end if;
 return new;
end $$;

create function public.schedule_contractor_opportunity_visits(
 p_opportunity_id uuid, p_expected_updated_at timestamptz, p_dates date[], p_frequency text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 op public.contractor_opportunities;
 company public.contractor_companies;
 visit_date date;
 first_job uuid;
 created_job uuid;
 duration numeric;
 requested_frequency text;
begin
 if not private.contractor_is_internal() then raise exception 'Operations management permission required.'; end if;
 select * into strict op from public.contractor_opportunities where id=p_opportunity_id for update;
 if op.linked_job_id is not null and exists(select 1 from public.jobs j where j.id=op.linked_job_id and j.source_contractor_opportunity_id=op.id) then
  return op.linked_job_id;
 end if;
 if op.updated_at is distinct from p_expected_updated_at or op.linked_job_id is not null
  or op.status<>'Awaiting Approval' or op.partner_confirmed_at is null
  or nullif(btrim(op.final_scope),'') is null or op.agreed_amount is null then
  raise exception 'Reload the opportunity and confirm the scope and per-visit compensation before scheduling.';
 end if;
 select * into strict company from public.contractor_companies where id=op.company_id for update;
 if company.status<>'Active' or company.client_id is null or op.request_property_id is null or op.requested_time is null then
  raise exception 'An active contractor, saved property, and start time are required.';
 end if;
 requested_frequency:=lower(regexp_replace(coalesce(op.request_options->>'bookingFrequency',''),'[^a-zA-Z0-9]','','g'));
 if requested_frequency='everyotherweek' then requested_frequency:='biweekly'; end if;
 if p_frequency is null or p_frequency not in ('Weekly','Biweekly','Monthly','Twice Monthly','Multiple Days Per Week','Every 4 Weeks','Daily','Custom')
  or lower(regexp_replace(p_frequency,'[^a-zA-Z0-9]','','g')) is distinct from requested_frequency
  or coalesce(cardinality(p_dates),0) not between 2 and 366
  or cardinality(p_dates)<>(select count(distinct d) from unnest(p_dates) d)
  or not (op.requested_date=any(p_dates))
  or exists(select 1 from unnest(p_dates) d where d<op.requested_date or d<(now() at time zone 'America/Los_Angeles')::date or d>op.requested_date+366)
 then raise exception 'Select recurring visit dates within one year, beginning on the requested date.'; end if;
 duration:=op.estimated_person_hours/nullif(op.cleaner_count,0);
 if duration is null or duration<=0 then raise exception 'Valid job duration required.'; end if;
 if company.contractor_division='Residential' and (
  op.requested_time<time '08:00' or op.requested_time>time '18:00'
  or extract(epoch from op.requested_time)+duration*3600>72000
  or exists(select 1 from unnest(p_dates) d where extract(dow from d)=0 or (extract(dow from d)=6 and d>date '2026-11-21'))
 ) then raise exception 'The schedule includes a date or time outside residential contractor availability.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(op.request_property_id::text,0));
 if exists(select 1 from public.service_agreements a where a.client_id=company.client_id and a.property_id=op.request_property_id
  and a.archived_at is null and a.status not in ('Cancelled','Archived') and (
   a.source_contractor_opportunity_id=op.id or (a.frequency<>'One-Time' and
   regexp_replace(lower(btrim(a.service_name)), '^custom +', '')=regexp_replace(lower(btrim(op.service_type)), '^custom +', ''))
  )
 ) then raise exception 'An agreement already covers this request. Use its existing schedule.'; end if;

 for visit_date in select d from unnest(p_dates) d order by d loop
  insert into public.jobs(job_number,client_id,property_id,division,client_name,property_name,service_name,
   frequency,status,scheduled_date,start_time,estimated_duration,price,balance,labor_hours,recommended_crew_size,
   scope,access_instructions,internal_notes,source_contractor_opportunity_id)
  values('JOB-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
   company.client_id,op.request_property_id,op.property_type,company.name,coalesce(op.property_name,op.property_address),
   op.service_type,p_frequency,'Scheduled',visit_date,op.requested_time,duration,op.agreed_amount,op.agreed_amount,
   op.estimated_person_hours,op.cleaner_count,jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'text',op.final_scope)),
   op.access_arrangements,op.special_instructions,op.id)
  returning id into created_job;
  first_job:=coalesce(first_job,created_job);
 end loop;
 update public.contractor_opportunities set status='Crew Assignment',linked_job_id=first_job,
  internal_confirmed_at=coalesce(internal_confirmed_at,now()),decided_by=auth.uid(),decided_at=now(),updated_at=clock_timestamp()
 where id=op.id;
 insert into public.contractor_audit_events(company_id,opportunity_id,actor_id,event_type,detail)
 values(company.id,op.id,auth.uid(),'Recurring Visits Scheduled',jsonb_build_object('firstJobId',first_job,'dates',p_dates,'frequency',p_frequency));
 return first_job;
end $$;
revoke all on function public.schedule_contractor_opportunity_visits(uuid,timestamptz,date[],text) from public,anon,authenticated;
grant execute on function public.schedule_contractor_opportunity_visits(uuid,timestamptz,date[],text) to authenticated;
