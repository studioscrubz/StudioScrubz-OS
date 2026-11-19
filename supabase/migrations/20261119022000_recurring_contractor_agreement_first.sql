-- Recurring contractor requests use the existing agreement/occurrence/job workflow.
alter table public.service_agreements add column source_contractor_opportunity_id uuid
 references public.contractor_opportunities(id) on delete restrict;
create unique index service_agreements_current_contractor_source_idx
 on public.service_agreements(source_contractor_opportunity_id)
 where source_contractor_opportunity_id is not null and archived_at is null and status not in ('Cancelled','Archived');

create function private.validate_contractor_agreement_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source_contractor_opportunity_id is null then return new; end if;
 if not private.contractor_is_internal() then raise exception 'Only operations management may link contractor agreements.'; end if;
 if not exists(select 1 from public.contractor_opportunities o join public.contractor_companies c on c.id=o.company_id
  where o.id=new.source_contractor_opportunity_id and c.client_id=new.client_id
   and o.request_property_id=new.property_id and c.status='Active') then
  raise exception 'The recurring agreement must use the contractor and property from its source request.';
 end if;
 return new;
end $$;
revoke all on function private.validate_contractor_agreement_source() from public,anon,authenticated;
create trigger validate_contractor_agreement_source before insert or update of source_contractor_opportunity_id,client_id,property_id
on public.service_agreements for each row execute function private.validate_contractor_agreement_source();

create function private.require_agreement_for_recurring_contractor_job()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.contractor_companies c where c.client_id=new.client_id)
  and new.frequency is distinct from 'One-Time' then
  if new.service_occurrence_id is null or not exists(
   select 1 from public.service_occurrences o join public.service_agreements a on a.id=o.agreement_id
   where o.id=new.service_occurrence_id and a.client_id=new.client_id and a.property_id=new.property_id
    and a.status='Active' and a.archived_at is null) then
   raise exception 'Create and activate the recurring contractor Service Agreement, then generate its schedule before creating Jobs.';
  end if;
 end if;
 if new.service_occurrence_id is not null and exists(select 1 from public.contractor_companies c where c.client_id=new.client_id)
  and exists(select 1 from public.jobs j where j.client_id=new.client_id and j.property_id=new.property_id
   and lower(btrim(j.service_name))=lower(btrim(new.service_name)) and j.scheduled_date=new.scheduled_date
   and j.start_time is not distinct from new.start_time and j.archived_at is null and j.status not in ('Cancelled','Archived')) then
  raise exception 'A Job already exists for this contractor appointment. Review the existing Job before generating another.';
 end if;
 return new;
end $$;
revoke all on function private.require_agreement_for_recurring_contractor_job() from public,anon,authenticated;
create trigger require_agreement_for_recurring_contractor_job before insert on public.jobs
for each row execute function private.require_agreement_for_recurring_contractor_job();

create function private.link_recurring_contractor_job()
returns trigger language plpgsql security definer set search_path='' as $$
declare agreement_source uuid;
begin
 if new.service_occurrence_id is null then return new; end if;
 select a.source_contractor_opportunity_id into agreement_source from public.service_occurrences o
  join public.service_agreements a on a.id=o.agreement_id where o.id=new.service_occurrence_id;
 update public.contractor_opportunities o set linked_job_id=new.id,status='Crew Assignment',
  internal_confirmed_at=coalesce(o.internal_confirmed_at,now()),updated_at=clock_timestamp()
 from public.contractor_companies c
 where c.id=o.company_id and c.client_id=new.client_id and o.request_property_id=new.property_id
  and o.linked_job_id is null and o.status in ('New Opportunity','Information Requested','Negotiating','Awaiting Approval','Accepted')
  and (o.id=agreement_source or (o.requested_date=new.scheduled_date and o.requested_time is not distinct from new.start_time
   and lower(btrim(o.service_type))=lower(btrim(new.service_name)) and coalesce(o.request_options->>'bookingFrequency','One-Time')<>'One-Time'));
 return new;
end $$;
revoke all on function private.link_recurring_contractor_job() from public,anon,authenticated;
create trigger link_recurring_contractor_job after insert on public.jobs
for each row execute function private.link_recurring_contractor_job();

CREATE OR REPLACE FUNCTION public.convert_contractor_opportunity_to_job(p_opportunity_id uuid, p_decision_reason text DEFAULT NULL::text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_op public.contractor_opportunities%rowtype;
 v_co public.contractor_companies%rowtype;
 v_client uuid;v_prop uuid;v_job uuid;v_actor uuid;v_agreement uuid;v_occurrence uuid;v_agreements integer;v_recurring boolean;v_created public.jobs;
begin
 v_actor:=auth.uid();
 if not private.contractor_is_internal() then raise exception 'Only active operations management may create jobs.'; end if;
 select * into v_op from public.contractor_opportunities where id=p_opportunity_id for update;
 if not found then raise exception 'Opportunity does not exist.'; end if;
 if v_op.linked_job_id is not null then return v_op.linked_job_id; end if;
 if p_expected_updated_at is not null and v_op.updated_at<>p_expected_updated_at then
  raise exception 'Opportunity changed. Reload and review the confirmed terms.'; end if;
 if v_op.status not in ('Awaiting Approval','Accepted') then
  raise exception 'Only opportunities awaiting approval or accepted may become jobs.'; end if;
 if v_op.partner_confirmed_at is null or (v_op.status='Accepted' and v_op.internal_confirmed_at is null)
  or v_op.final_scope is null or v_op.agreed_amount is null then
  raise exception 'Final written scope and compensation confirmation are required.'; end if;
 select * into v_co from public.contractor_companies where id=v_op.company_id for update;
 if v_co.status<>'Active' then raise exception 'Only active contractor companies may receive jobs.'; end if;
 if v_op.request_options is not null then
  v_prop:=private.save_contractor_request_property(v_op);
  select client_id into v_client from public.properties where id=v_prop;
 else
  -- Preserve the original handoff for requests created before property links existed.
  v_client:=v_co.client_id;
  if v_client is null then
   insert into public.clients(client_type,company_name,phone,email,status)
   values('Contractor',v_co.name,v_co.phone,v_co.contact_email,'Active') returning id into v_client;
   update public.contractor_companies set client_id=v_client where id=v_co.id;
  end if;
  insert into public.properties(client_id,property_type,address,square_feet,bedrooms,bathrooms,access_instructions,notes)
  values(v_client,v_op.property_type,v_op.property_address,v_op.square_feet,v_op.bedrooms,
  v_op.bathrooms,v_op.access_arrangements,v_op.special_instructions)
  returning id into v_prop;
 end if;
 v_recurring:=lower(regexp_replace(coalesce(v_op.request_options->>'bookingFrequency',''),'[[:space:]-]','','g'))
  in ('weekly','biweekly','everyotherweek','monthly','twicemonthly','multipledaysperweek','every4weeks','daily','custom');
 select count(*),(array_agg(a.id order by a.id))[1] into v_agreements,v_agreement
 from public.service_agreements a where a.client_id=v_client and a.property_id=v_prop
  and lower(btrim(a.service_name))=lower(btrim(v_op.service_type)) and a.status='Active' and a.archived_at is null and a.frequency<>'One-Time';
 if v_agreements>1 then raise exception 'Multiple active agreements cover this service. Review Service Agreements.'; end if;
 if v_recurring or v_agreements=1 then
  if v_agreement is null then raise exception 'Create and activate the recurring contractor Service Agreement before creating a Job.'; end if;
  select id into v_occurrence from public.service_occurrences where agreement_id=v_agreement
   and scheduled_date=v_op.requested_date and scheduled_start_time is not distinct from v_op.requested_time
   and status in ('Scheduled','Job Created') for update;
  if v_occurrence is null then raise exception 'Generate the recurring Service Agreement schedule before creating this Job.'; end if;
  v_created:=public.create_job_from_service_occurrence(v_occurrence);
  v_job:=v_created.id;
 else
 insert into public.jobs(
  job_number,client_id,property_id,division,client_name,property_name,service_name,
  frequency,status,scheduled_date,start_time,estimated_duration,
  price,balance,labor_hours,recommended_crew_size,scope,access_instructions,internal_notes
 ) values(
  'JOB-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  v_client,v_prop,v_op.property_type,v_co.name,coalesce(v_op.property_name,v_op.property_address),v_op.service_type,
  case lower(regexp_replace(coalesce(v_op.request_options->>'bookingFrequency',''),'[[:space:]-]','','g'))
    when 'weekly' then 'Weekly'
    when 'biweekly' then 'Biweekly'
    when 'everyotherweek' then 'Biweekly'
    when 'monthly' then 'Monthly'
    else 'One-Time'
  end,'Ready to Schedule',v_op.requested_date,v_op.requested_time,
  (v_op.estimated_person_hours/v_op.cleaner_count),
  v_op.agreed_amount,v_op.agreed_amount,v_op.estimated_person_hours,v_op.cleaner_count,
  jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'text',v_op.final_scope)),
  v_op.access_arrangements,v_op.special_instructions
 ) returning id into v_job;
 end if;
 update public.contractor_opportunities
 set linked_job_id=v_job,request_property_id=v_prop,status='Crew Assignment',internal_confirmed_at=coalesce(v_op.internal_confirmed_at,now()),
  decided_by=coalesce(v_op.decided_by,v_actor),decided_at=coalesce(v_op.decided_at,now()),
  decision_reason=coalesce(v_op.decision_reason,nullif(btrim(p_decision_reason),''),'Accepted within approved terms'),
  updated_at=clock_timestamp() where id=v_op.id;
 if v_op.status='Awaiting Approval' then
  insert into public.contractor_audit_events(company_id,opportunity_id,actor_id,event_type,detail)
  values(v_op.company_id,v_op.id,v_actor,'Opportunity Accepted',jsonb_build_object('agreedAmount',v_op.agreed_amount));
 end if;
 insert into public.contractor_audit_events(company_id,opportunity_id,actor_id,event_type,detail)
 values(v_op.company_id,v_op.id,v_actor,'Converted to Job',jsonb_build_object('job_id',v_job));
 return v_job;
end $function$
;

