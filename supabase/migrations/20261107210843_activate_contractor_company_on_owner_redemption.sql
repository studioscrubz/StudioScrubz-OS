-- A verified owner invitation activates a pending company as part of redemption.
create or replace function public.redeem_contractor_invitation(p_token_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_inv public.contractor_invitations%rowtype; v_user uuid; v_email text; v_company_id uuid; v_company_status text;
begin
 v_user := auth.uid();
 if v_user is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invitation is invalid.'; end if;
 select lower(email) into v_email from auth.users
  where id=v_user and email_confirmed_at is not null;
 if v_email is null then raise exception 'Confirm your account email before activating.'; end if;
 if exists(select 1 from public.user_profiles where id=v_user) then
  raise exception 'Internal StudioScrubz accounts cannot be contractor portal accounts.';
 end if;
 -- Lock the company before its invitation, matching teammate invitation preparation.
 select company_id into v_company_id from public.contractor_invitations where token_hash=p_token_hash;
 select status into v_company_status from public.contractor_companies where id=v_company_id for update;
 select * into v_inv from public.contractor_invitations
  where token_hash=p_token_hash and company_id=v_company_id for update;
 if not found or v_inv.status<>'Pending' or v_inv.expires_at<=now()
   or lower(v_inv.invited_email)<>v_email then
  raise exception 'Invitation is invalid, expired, or belongs to another email.';
 end if;
 if v_company_status is null or v_company_status not in ('Active','Pending')
  or (v_company_status='Pending' and v_inv.member_role<>'Company Admin') then
  raise exception 'Company access is unavailable.';
 end if;
 if exists(select 1 from public.contractor_members where user_id=v_user) then
  raise exception 'This account already belongs to a contractor company.';
 end if;
 insert into public.contractor_members(company_id,user_id,email,member_role)
 values(v_inv.company_id,v_user,v_email,v_inv.member_role);
 if v_company_status='Pending' then
  update public.contractor_companies set status='Active',updated_at=now() where id=v_inv.company_id;
  insert into public.contractor_audit_events(company_id,actor_id,event_type,detail)
  values(v_inv.company_id,v_user,'Company Activated by Invitation',jsonb_build_object('invitation_id',v_inv.id));
 end if;
 update public.contractor_invitations
 set status='Redeemed',redeemed_at=now(),redeemed_by=v_user where id=v_inv.id;
 insert into public.contractor_audit_events(company_id,actor_id,event_type,detail)
 values(v_inv.company_id,v_user,'Invitation Redeemed',jsonb_build_object('invitation_id',v_inv.id));
 return v_inv.company_id;
end $$;
revoke all on function public.redeem_contractor_invitation(text) from public,anon;
grant execute on function public.redeem_contractor_invitation(text) to authenticated;
