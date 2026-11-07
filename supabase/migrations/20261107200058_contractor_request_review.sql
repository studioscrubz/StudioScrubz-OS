alter table public.contractor_opportunities
 add column property_name text,
 add column request_property_id uuid references public.properties(id) on delete set null,
 add column request_options jsonb,
 add column request_revision integer not null default 0 check (request_revision >= 0);

alter table public.contractor_profitability
 add column request_revision integer not null default 0;

create function private.save_contractor_request_property(p_request public.contractor_opportunities)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_company public.contractor_companies%rowtype; v_client uuid; v_property uuid;
begin
 select * into strict v_company from public.contractor_companies where id=p_request.company_id for update;
 if v_company.status<>'Active' then raise exception 'Only active contractor companies may submit jobs.'; end if;
 v_client:=v_company.client_id;
 if v_client is null then
  insert into public.clients(client_type,company_name,phone,email,status)
  values('Contractor',v_company.name,v_company.phone,v_company.contact_email,'Active') returning id into v_client;
  update public.contractor_companies set client_id=v_client where id=v_company.id;
 end if;
 select id into v_property from public.properties
 where client_id=v_client and property_type=p_request.property_type and archived_at is null
   and lower(btrim(address))=lower(btrim(p_request.property_address))
 order by (id=p_request.request_property_id) desc nulls last,id limit 1;
 if v_property is null then
  insert into public.properties(client_id,property_type,property_name,address,square_feet,bedrooms,bathrooms)
  values(v_client,p_request.property_type,p_request.property_name,p_request.property_address,p_request.square_feet,p_request.bedrooms,p_request.bathrooms)
  returning id into v_property;
 end if;
 return v_property;
end $$;
revoke all on function private.save_contractor_request_property(public.contractor_opportunities) from public,anon,authenticated;

create function private.sync_contractor_request_property()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if old.linked_job_id is not null or old.internal_confirmed_at is not null or
     old.status not in ('New Opportunity','Information Requested','Negotiating','Awaiting Approval') then
   raise exception 'This contractor request is locked.';
  end if;
  -- A changed request must receive fresh approval even if its price and scope text match.
  delete from public.contractor_profitability where opportunity_id=old.id;
  new.updated_at:=clock_timestamp();
 elsif new.request_options is null then
  -- Older submissions can still be converted using the approval-time fallback.
  return new;
 end if;
 if new.property_type='Residential' and nullif(btrim(new.property_name),'') is null then
  raise exception 'A name is required for residential requests.';
 end if;
 new.request_property_id:=private.save_contractor_request_property(new);
 return new;
end $$;
revoke all on function private.sync_contractor_request_property() from public,anon,authenticated;
create trigger sync_contractor_request_property
 before insert or update of request_revision on public.contractor_opportunities
 for each row execute function private.sync_contractor_request_property();

-- The OS reads only the current recipient's review queue.
create function public.get_my_contractor_request_reviews()
returns table(id uuid,opportunity_number text,property_name text,service_type text,request_revision integer,status text,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select o.id,o.opportunity_number,o.property_name,o.service_type,o.request_revision,o.status,o.updated_at
 from public.contractor_opportunities o
 join public.contractor_companies c on c.id=o.company_id
 join public.user_profiles actor on actor.id=(select auth.uid()) and actor.is_active
 where c.status='Active' and o.linked_job_id is null and o.internal_confirmed_at is null
   and o.status in ('New Opportunity','Awaiting Approval')
   and actor.role in ('Manager','Master Admin')
   and (
    actor.id=coalesce(o.manager_id,c.assigned_manager_id)
    or (actor.role='Master Admin' and not exists(
     select 1 from public.user_profiles manager where manager.id=coalesce(o.manager_id,c.assigned_manager_id)
       and manager.is_active and manager.role in ('Manager','Master Admin')
    ))
   )
 order by o.updated_at desc limit 100
$$;
revoke all on function public.get_my_contractor_request_reviews() from public,anon,authenticated;
grant execute on function public.get_my_contractor_request_reviews() to authenticated;

create or replace function public.convert_contractor_opportunity_to_job(p_opportunity_id uuid,p_decision_reason text default null,p_expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_op public.contractor_opportunities%rowtype;
 v_co public.contractor_companies%rowtype;
 v_pr public.contractor_profitability%rowtype;
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
 select * into v_pr from public.contractor_profitability where opportunity_id=v_op.id for update;
 if not found then raise exception 'Internal profitability assessment is required.'; end if;
 if v_pr.request_revision<>v_op.request_revision or v_pr.assessed_amount<>v_op.agreed_amount or v_pr.assessed_scope<>v_op.final_scope then
  raise exception 'Profitability assessment is stale; reassess final scope and compensation.'; end if;
 if (not v_pr.cost_complete or v_pr.minimum_price is null or v_op.agreed_amount<v_pr.minimum_price)
   and v_pr.override_approved_by is null then raise exception 'Master Admin profitability approval is required.'; end if;
 if v_pr.override_approved_by is not null and (v_pr.override_reason is null or length(btrim(v_pr.override_reason))<12)
 then raise exception 'A documented override reason is required.'; end if;
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
