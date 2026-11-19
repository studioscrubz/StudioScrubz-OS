-- Robert's Brava-specific email-code entry. No OTP secrets are stored in application tables.
create table if not exists public.contractor_brava_otp_throttle (
  id text primary key check (id = 'brava'),
  window_started timestamptz not null default now(),
  last_requested timestamptz not null default now() - interval '2 minutes',
  request_count integer not null default 0 check (request_count between 0 and 5)
);
alter table public.contractor_brava_otp_throttle enable row level security;
revoke all on public.contractor_brava_otp_throttle from public, anon, authenticated;
grant select, insert, update on public.contractor_brava_otp_throttle to service_role;

create or replace function public.reserve_brava_email_otp()
returns boolean language plpgsql security invoker set search_path = '' as $$
declare r public.contractor_brava_otp_throttle;
begin
  insert into public.contractor_brava_otp_throttle(id)
  values ('brava') on conflict(id) do nothing;
  select * into r from public.contractor_brava_otp_throttle where id = 'brava' for update;
  if r.last_requested > now() - interval '60 seconds' then return false; end if;
  if r.window_started > now() - interval '24 hours' and r.request_count >= 5 then return false; end if;
  update public.contractor_brava_otp_throttle set
    last_requested = now(),
    window_started = case when r.window_started <= now() - interval '24 hours' then now() else r.window_started end,
    request_count = case when r.window_started <= now() - interval '24 hours' then 1 else r.request_count + 1 end
  where id = 'brava';
  return true;
end $$;
revoke all on function public.reserve_brava_email_otp() from public, anon, authenticated;
grant execute on function public.reserve_brava_email_otp() to service_role;

-- Only the verified owner of Brava's specific pending invitation can activate it.
-- This does not give email-code login access to any other contractor or company.
create or replace function public.activate_brava_email_invitation()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_company_id uuid := 'a1b0e01c-3990-47e8-9c4f-40c772ce35fd';
  v_inv public.contractor_invitations%rowtype;
  v_existing public.contractor_members%rowtype;
begin
  if v_user is null then raise exception 'Sign in required.' using errcode='42501'; end if;
  select lower(email) into v_email from auth.users
    where id = v_user and email_confirmed_at is not null;
  if v_email is distinct from 'management@bravahomecleaning.com' then
    raise exception 'This email is not authorized for Brava access.' using errcode='42501';
  end if;
  if exists(select 1 from public.user_profiles where id=v_user) then
    raise exception 'StudioScrubz employee accounts cannot use contractor access.' using errcode='42501';
  end if;
  perform 1 from public.contractor_companies
    where id=v_company_id and lower(name)='brava home cleaning' and status='Active' for update;
  if not found then raise exception 'Brava contractor access is unavailable.'; end if;
  select * into v_existing from public.contractor_members where user_id=v_user;
  if found then
    if v_existing.company_id=v_company_id and v_existing.is_active then return v_company_id; end if;
    raise exception 'This account already has a different or inactive contractor membership.';
  end if;
  select * into v_inv from public.contractor_invitations
    where company_id=v_company_id
      and lower(invited_email)=v_email and member_role='Company Admin'
      and status='Pending' and expires_at>now()
    order by created_at desc limit 1 for update;
  if not found then raise exception 'Brava management invitation is unavailable or expired. Contact StudioScrubz Operations.'; end if;
  insert into public.contractor_members(company_id,user_id,email,member_role)
  values(v_company_id,v_user,v_email,'Company Admin');
  update public.contractor_invitations
    set status='Redeemed',redeemed_at=now(),redeemed_by=v_user
    where id=v_inv.id and status='Pending';
  insert into public.contractor_audit_events(company_id,actor_id,event_type,detail)
  values(v_company_id,v_user,'Invitation Redeemed',jsonb_build_object('invitation_id',v_inv.id,'method','verified_email_otp'));
  return v_company_id;
end $$;
revoke all on function public.activate_brava_email_invitation() from public, anon;
grant execute on function public.activate_brava_email_invitation() to authenticated;
