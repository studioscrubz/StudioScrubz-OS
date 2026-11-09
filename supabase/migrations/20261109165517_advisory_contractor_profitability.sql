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
  'One-Time','Ready to Schedule',v_op.requested_date,v_op.requested_time,
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
revoke all on function public.convert_contractor_opportunity_to_job(uuid,text,timestamptz) from public,anon;
grant execute on function public.convert_contractor_opportunity_to_job(uuid,text,timestamptz) to authenticated;

-- Applying the calculated price is an explicit, audited counteroffer.
create function public.offer_contractor_profitability_price(p_opportunity_id uuid,p_reason text,p_expected_assessed_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();
 v_op public.contractor_opportunities%rowtype;
 v_pr public.contractor_profitability%rowtype;
 v_offer uuid;
begin
 if not exists(select 1 from public.user_profiles where id=v_actor and is_active and role='Master Admin')
 then raise exception 'Master Admin approval is required to use the suggested price.' using errcode='42501'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 12 and 2000
 then raise exception 'Provide a reason between 12 and 2000 characters.'; end if;
 select * into v_op from public.contractor_opportunities where id=p_opportunity_id for update;
 if not found then raise exception 'Opportunity is unavailable.'; end if;
 if not exists(select 1 from public.contractor_companies where id=v_op.company_id and status='Active')
 then raise exception 'Only active contractor companies may receive offers.'; end if;
 select * into v_pr from public.contractor_profitability where opportunity_id=v_op.id for update;
 if not found or not v_pr.cost_complete or v_pr.minimum_price is null
 then raise exception 'Calculate a complete profitability assessment to use its suggested price.'; end if;
 if p_expected_assessed_at is distinct from v_pr.updated_at or v_pr.request_revision<>v_op.request_revision
  or v_pr.assessed_amount is distinct from coalesce(v_op.agreed_amount,v_op.proposed_amount)
  or v_pr.assessed_scope is distinct from coalesce(v_op.final_scope,v_op.scope_of_work)
 then raise exception 'The assessment or request changed. Recalculate and review the suggested price.'; end if;
 v_offer:=public.record_contractor_offer(v_op.id,v_actor,v_pr.minimum_price,
  coalesce(v_op.final_scope,v_op.scope_of_work),v_op.pricing_basis,null);
 update public.contractor_profitability set override_approved_by=v_actor,override_reason=btrim(p_reason),override_at=now(),updated_at=clock_timestamp()
 where opportunity_id=v_op.id;
 insert into public.contractor_audit_events(company_id,opportunity_id,actor_id,event_type,detail)
 values(v_op.company_id,v_op.id,v_actor,'Profitability Price Offered',
  jsonb_build_object('offerId',v_offer,'amount',v_pr.minimum_price,'reason',btrim(p_reason)));
 return v_offer;
end $$;
revoke all on function public.offer_contractor_profitability_price(uuid,text,timestamptz) from public,anon;
grant execute on function public.offer_contractor_profitability_price(uuid,text,timestamptz) to authenticated;
notify pgrst,'reload schema';
