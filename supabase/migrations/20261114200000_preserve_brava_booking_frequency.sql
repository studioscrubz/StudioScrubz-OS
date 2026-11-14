create or replace function public.convert_contractor_opportunity_to_job(p_opportunity_id uuid,p_decision_reason text default null,p_expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_op public.contractor_opportunities%rowtype;
 v_co public.contractor_companies%rowtype;
 v_client uuid;v_prop uuid;v_job uuid;v_actor uuid;
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
end $$;
