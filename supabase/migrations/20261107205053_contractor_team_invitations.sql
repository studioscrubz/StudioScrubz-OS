-- Team invitation senders are authenticated contractor owners or OS staff.
alter table public.contractor_invitations
 drop constraint contractor_invitations_invited_by_fkey,
 add constraint contractor_invitations_invited_by_fkey
 foreign key (invited_by) references auth.users(id);

create function public.prepare_contractor_team_invitation(p_actor uuid,p_email text,p_token_hash text)
returns table(id uuid,expires_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare v_company uuid;
begin
 select c.id into v_company
 from public.contractor_members m
 join public.contractor_companies c on c.id=m.company_id
 where m.user_id=p_actor and m.is_active and m.member_role='Company Admin' and c.status='Active'
 for update of c,m;
 if not found then raise exception 'Only an active contractor owner can invite teammates.'; end if;
 if exists(select 1 from public.contractor_members m where m.company_id=v_company and lower(m.email)=p_email) then
  raise exception 'This person already has a contractor account. Contact StudioScrubz Operations for help.';
 end if;
 if exists(select 1 from public.contractor_invitations i
  where i.company_id=v_company and i.invited_email=p_email and i.member_role='Company Admin'
    and i.status='Pending' and i.expires_at>now()) then
  raise exception 'StudioScrubz already has an owner invitation pending for this email.';
 end if;
 update public.contractor_invitations i set status='Revoked'
 where i.company_id=v_company and i.invited_email=p_email and i.member_role='Member' and i.status='Pending';
 return query
 insert into public.contractor_invitations as i(company_id,invited_email,member_role,token_hash,invited_by)
 values(v_company,p_email,'Member',p_token_hash,p_actor)
 returning i.id,i.expires_at;
end $$;

revoke all on function public.prepare_contractor_team_invitation(uuid,text,text) from public,anon,authenticated;
grant execute on function public.prepare_contractor_team_invitation(uuid,text,text) to service_role;
