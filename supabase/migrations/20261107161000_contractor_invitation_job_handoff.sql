-- Atomic single-use activation and accepted-opportunity -> existing operational Job handoff.
-- Security definer functions validate auth identity and never grant partner access to Job tables.
begin;
create or replace function public.redeem_contractor_invitation(p_token_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_inv public.contractor_invitations%rowtype; v_user uuid; v_email text;
begin
 v_user := auth.uid();
 if v_user is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invitation is invalid.'; end if;
 select lower(email) into v_email from auth.users
  where id=v_user and email_confirmed_at is not null;
 if v_email is null then raise exception 'Confirm your account email before activating.'; end if;
 if exists(select 1 from public.user_profiles where id=v_user) then
  raise exception 'Internal StudioScrubz accounts cannot be contractor portal accounts.';
 end if;
 select * into v_inv from public.contractor_invitations
  where token_hash=p_token_hash for update;
 if not found or v_inv.status<>'Pending' or v_inv.expires_at<=now()
   or lower(v_inv.invited_email)<>v_email then
  raise exception 'Invitation is invalid, expired, or belongs to another email.';
 end if;
 if not exists(select 1 from public.contractor_companies c where c.id=v_inv.company_id
   and c.status in ('Active','Pending')) then raise exception 'Company access is unavailable.'; end if;
 if exists(select 1 from public.contractor_members where user_id=v_user) then
  raise exception 'This account already belongs to a contractor company.';
 end if;
 insert into public.contractor_members(company_id,user_id,email,member_role)
 values(v_inv.company_id,v_user,v_email,v_inv.member_role);
 update public.contractor_invitations
 set status='Redeemed',redeemed_at=now(),redeemed_by=v_user where id=v_inv.id;
 insert into public.contractor_audit_events(company_id,actor_id,event_type,detail)
 values(v_inv.company_id,v_user,'Invitation Redeemed',jsonb_build_object('invitation_id',v_inv.id));
 return v_inv.company_id;
end $$;
revoke all on function public.redeem_contractor_invitation(text) from public,anon;
grant execute on function public.redeem_contractor_invitation(text) to authenticated;

create or replace function public.convert_contractor_opportunity_to_job(p_opportunity_id uuid)
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
 if v_op.status<>'Accepted' then raise exception 'Only accepted opportunities may become jobs.'; end if;
 if v_op.partner_confirmed_at is null or v_op.internal_confirmed_at is null
  or v_op.final_scope is null or v_op.agreed_amount is null then
  raise exception 'Final written scope and compensation confirmation are required.'; end if;
 select * into v_pr from public.contractor_profitability where opportunity_id=v_op.id;
 if not found then raise exception 'Internal profitability assessment is required.'; end if;
 if (not v_pr.cost_complete or v_pr.minimum_price is null or v_op.agreed_amount<v_pr.minimum_price)
   and v_pr.override_approved_by is null then raise exception 'Master Admin profitability approval is required.'; end if;
 if v_pr.override_approved_by is not null and (v_pr.override_reason is null or length(btrim(v_pr.override_reason))<12)
 then raise exception 'A documented override reason is required.'; end if;
 select * into v_co from public.contractor_companies where id=v_op.company_id for update;
 if v_co.status<>'Active' then raise exception 'Only active contractor companies may receive jobs.'; end if;
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
 insert into public.jobs(
  job_number,client_id,property_id,division,client_name,property_name,service_name,
  frequency,status,scheduled_date,start_time,estimated_duration,
  price,balance,labor_hours,recommended_crew_size,scope,access_instructions,internal_notes
 ) values(
  'JOB-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  v_client,v_prop,v_op.property_type,v_co.name,v_op.property_address,v_op.service_type,
  'One-Time','Ready to Schedule',v_op.requested_date,v_op.requested_time,
  (v_op.estimated_person_hours/v_op.cleaner_count),
  v_op.agreed_amount,v_op.agreed_amount,v_op.estimated_person_hours,v_op.cleaner_count,
  jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'text',v_op.final_scope)),
  v_op.access_arrangements,v_op.special_instructions
 ) returning id into v_job;
 update public.contractor_opportunities
 set linked_job_id=v_job,status='Crew Assignment',updated_at=now() where id=v_op.id;
 insert into public.contractor_audit_events(company_id,opportunity_id,actor_id,event_type,detail)
 values(v_op.company_id,v_op.id,v_actor,'Converted to Job',jsonb_build_object('job_id',v_job));
 return v_job;
end $$;
revoke all on function public.convert_contractor_opportunity_to_job(uuid) from public,anon;
grant execute on function public.convert_contractor_opportunity_to_job(uuid) to authenticated;

-- Private bucket; uploads and signed reads go exclusively through authenticated,
-- company-scoped server endpoints (never public list/download).
do $$
begin
 if to_regclass('storage.buckets') is not null then
   insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('contractor-private','contractor-private',false,15728640,
   array['image/png','image/jpeg','image/webp','application/pdf'])
   on conflict (id) do nothing;
 end if;
end $$;
commit;
