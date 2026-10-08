begin;

alter table public.proposals
  add column if not exists revision_group_id uuid,
  add column if not exists revision_number integer,
  add column if not exists revised_from_proposal_id uuid,
  add column if not exists is_current_revision boolean,
  add column if not exists superseded_at timestamptz;

update public.proposals set revision_group_id=coalesce(revision_group_id,id),revision_number=coalesce(revision_number,1),is_current_revision=coalesce(is_current_revision,true);
alter table public.proposals alter column revision_group_id set not null,alter column revision_number set not null,alter column revision_number set default 1,alter column is_current_revision set not null,alter column is_current_revision set default true;
alter table public.proposals add constraint proposals_revision_number_check check (revision_number>=1);
alter table public.proposals add constraint proposals_revision_group_id_fkey foreign key (revision_group_id) references public.proposals(id) on delete restrict deferrable initially deferred;
alter table public.proposals add constraint proposals_revised_from_proposal_id_fkey foreign key (revised_from_proposal_id) references public.proposals(id) on delete restrict;

drop index if exists public.proposals_one_active_per_estimate_idx;
drop index if exists public.proposals_one_active_per_walkthrough;
drop index if exists public.proposals_one_active_per_walkthrough_idx;
create unique index proposals_origin_estimate_uidx on public.proposals(estimate_id) where estimate_id is not null and revision_number=1 and archived_at is null;
create unique index proposals_origin_walkthrough_uidx on public.proposals(walkthrough_id) where walkthrough_id is not null and revision_number=1 and archived_at is null;
create unique index proposals_revision_group_number_uidx on public.proposals(revision_group_id,revision_number);
create unique index proposals_current_revision_uidx on public.proposals(revision_group_id) where is_current_revision=true;
create unique index proposals_one_open_revision_uidx on public.proposals(revision_group_id) where revision_number>1 and archived_at is null and status in ('Draft','Ready for Approval','Approved');
create index proposals_revised_from_idx on public.proposals(revised_from_proposal_id) where revised_from_proposal_id is not null;
create index proposals_revision_group_idx on public.proposals(revision_group_id,revision_number desc);

create or replace function private.initialize_proposal_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.revision_group_id is null then new.revision_group_id:=new.id; end if; return new; end $$;
revoke all on function private.initialize_proposal_revision() from public,anon,authenticated;
create trigger proposals_initialize_revision before insert on public.proposals for each row execute function private.initialize_proposal_revision();

create or replace function private.protect_sent_proposal_offer() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.accepted is true and old.accepted is false and old.is_current_revision is not true then raise exception 'A superseded Proposal cannot be accepted.'; end if;
  if old.sent_at is not null and (new.client_id is distinct from old.client_id or new.property_id is distinct from old.property_id or new.estimate_id is distinct from old.estimate_id or new.walkthrough_id is distinct from old.walkthrough_id or new.division is distinct from old.division or new.client_name is distinct from old.client_name or new.property_name is distinct from old.property_name or new.frequency is distinct from old.frequency or new.requested_date is distinct from old.requested_date or new.notes is distinct from old.notes or new.result is distinct from old.result or new.photos is distinct from old.photos or new.signature is distinct from old.signature or new.expiration_date is distinct from old.expiration_date) then raise exception 'Sent Proposal revisions are immutable. Create a revision instead.'; end if;
  return new;
end $$;
revoke all on function private.protect_sent_proposal_offer() from public,anon,authenticated;
create trigger proposals_protect_sent_offer before update on public.proposals for each row execute function private.protect_sent_proposal_offer();

create or replace function public.create_proposal_revision(p_proposal_id uuid) returns public.proposals language plpgsql security definer set search_path='' as $$
declare source public.proposals; created public.proposals; next_revision integer; actor text;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Sales']) then raise exception 'You do not have permission to create Proposal revisions.' using errcode='42501'; end if;
  select * into source from public.proposals where id=p_proposal_id for update;
  if not found or source.archived_at is not null or source.status not in ('Sent','Viewed') or source.accepted or not source.is_current_revision then raise exception 'Only the current unaccepted Sent or Viewed Proposal can be revised.'; end if;
  perform 1 from public.proposals where revision_group_id=source.revision_group_id for update;
  if exists(select 1 from public.proposals where revision_group_id=source.revision_group_id and revision_number>1 and archived_at is null and status in ('Draft','Ready for Approval','Approved')) then raise exception 'This Proposal already has an open draft revision.'; end if;
  select coalesce(max(revision_number),0)+1 into next_revision from public.proposals where revision_group_id=source.revision_group_id;
  select coalesce(nullif(display_name,''),email,role,'StudioScrubz User') into actor from public.user_profiles where id=auth.uid() and is_active=true;
  insert into public.proposals(proposal_number,client_id,property_id,estimate_id,walkthrough_id,division,client_name,property_name,customer_phone,customer_email,frequency,requested_date,representative_name,notes,result,photos,signature,status,approval_status,approved_at,approved_by,approval_notes,sent_at,sent_via,sent_to,sent_by,client_access_token,client_access_token_expires_at,client_delivery_snapshot,client_acceptance_consent,client_acceptance_consent_at,viewed_at,accepted,accepted_at,accepted_by_name,acceptance_method,declined_at,decline_reason,expiration_date,expired_at,lead_representative_id,revision_group_id,revision_number,revised_from_proposal_id,is_current_revision,superseded_at)
  values(source.proposal_number||'-R'||next_revision,source.client_id,source.property_id,source.estimate_id,source.walkthrough_id,source.division,source.client_name,source.property_name,source.customer_phone,source.customer_email,source.frequency,source.requested_date,source.representative_name,source.notes,source.result,source.photos,null,'Draft','Not Submitted',null,null,null,null,null,null,null,null,null,null,null,null,null,false,null,null,null,null,null,greatest(source.expiration_date,current_date+30),null,source.lead_representative_id,source.revision_group_id,next_revision,source.id,false,null) returning * into created;
  insert into public.proposal_history(proposal_id,event_type,previous_status,new_status,description,metadata,performed_by) values(created.id,'Revision Created',source.status,'Draft','Created from '||source.proposal_number,jsonb_build_object('source_proposal_id',source.id,'revision_number',next_revision),coalesce(actor,'StudioScrubz User'));
  return created;
end $$;
revoke all on function public.create_proposal_revision(uuid) from public,anon,authenticated;
grant execute on function public.create_proposal_revision(uuid) to authenticated;

create or replace function public.prepare_proposal_delivery(p_proposal_id uuid,p_token text,p_token_expires_at timestamptz,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare row public.proposals; safe_snapshot jsonb; settings_row public.business_settings; total numeric; required numeric;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then raise exception 'You do not have permission to send Proposals.' using errcode='42501'; end if;
  if p_token is null or length(p_token)<32 or p_token_expires_at<=now() then raise exception 'A valid secure Proposal token is required.'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' then raise exception 'A client-facing Proposal snapshot is required.'; end if;
  select * into row from public.proposals where id=p_proposal_id for update;
  if not found or row.archived_at is not null or row.status not in ('Approved','Sent','Viewed') or row.approval_status<>'Approved' or row.accepted or row.expiration_date<current_date then raise exception 'This Proposal is unavailable for delivery.'; end if;
  if (row.status in ('Sent','Viewed') and not row.is_current_revision) or (row.status='Approved' and (row.sent_at is not null or exists(select 1 from public.proposals newer where newer.revision_group_id=row.revision_group_id and newer.revision_number>row.revision_number and newer.archived_at is null))) then raise exception 'Only the current offer or newest approved revision can be delivered.'; end if;
  if row.revision_number>1 and exists(select 1 from public.proposals p where p.revision_group_id=row.revision_group_id and p.is_current_revision and p.status='Accepted') then raise exception 'The prior Proposal was accepted before this revision could be sent.'; end if;
  safe_snapshot:=p_snapshot;
  if row.frequency='One-Time' and lower(coalesce(row.result->>'serviceName',''))='post-construction cleaning' then
    select * into settings_row from public.business_settings limit 1;
    if coalesce(p_snapshot->>'per_visit_total','') !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'The Proposal snapshot final total is invalid.'; end if;
    total:=round((p_snapshot->>'per_visit_total')::numeric,2); required:=round(total*settings_row.post_construction_deposit_percent/100,2);
    safe_snapshot:=p_snapshot||jsonb_build_object('deposit_percent',settings_row.post_construction_deposit_percent,'required_deposit_amount',required,'remaining_balance',round(total-required,2));
  end if;
  perform set_config('studioscrubz.controlled_delivery_snapshot','on',true);
  update public.proposals set client_access_token=p_token,client_access_token_expires_at=p_token_expires_at,client_delivery_snapshot=safe_snapshot where id=row.id;
  return jsonb_build_object('prepared',true,'snapshot',safe_snapshot);
end $$;
revoke all on function public.prepare_proposal_delivery(uuid,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_proposal_delivery(uuid,text,timestamptz,jsonb) to authenticated;

create or replace function public.mark_proposal_sent_for_delivery(p_proposal_id uuid,p_via text,p_recipient text,p_sender text,p_token text,p_token_expires_at timestamptz,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare row public.proposals; previous_status text; sent_time timestamptz:=now();
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then raise exception 'You do not have permission to send Proposals.' using errcode='42501'; end if;
  if p_via not in ('Email','Text') or length(btrim(coalesce(p_recipient,'')))<3 then raise exception 'A valid Proposal delivery recipient is required.'; end if;
  select * into row from public.proposals where id=p_proposal_id for update;
  if not found or row.archived_at is not null or row.status not in ('Approved','Sent','Viewed') or row.approval_status<>'Approved' or row.accepted or row.expiration_date<current_date then raise exception 'This Proposal is unavailable for delivery.'; end if;
  if (row.status in ('Sent','Viewed') and not row.is_current_revision) or (row.status='Approved' and (row.sent_at is not null or exists(select 1 from public.proposals newer where newer.revision_group_id=row.revision_group_id and newer.revision_number>row.revision_number and newer.archived_at is null))) then raise exception 'Only the current offer or newest approved revision can be delivered.'; end if;
  if row.client_access_token is distinct from p_token or row.client_access_token_expires_at is distinct from p_token_expires_at or row.client_delivery_snapshot is null or p_snapshot is null then raise exception 'Proposal delivery was not prepared with this secure snapshot.'; end if;
  perform 1 from public.proposals p where p.revision_group_id=row.revision_group_id for update;
  if row.revision_number>1 and exists(select 1 from public.proposals p where p.revision_group_id=row.revision_group_id and p.is_current_revision and p.id<>row.id and p.status='Accepted') then raise exception 'The prior Proposal was accepted before this revision could be activated.'; end if;
  previous_status:=row.status;
  if not row.is_current_revision then
    update public.proposals set is_current_revision=false,superseded_at=sent_time where revision_group_id=row.revision_group_id and is_current_revision=true and id<>row.id;
    update public.proposals set is_current_revision=true,superseded_at=null where id=row.id;
  end if;
  update public.proposals set status='Sent',sent_at=coalesce(sent_at,sent_time),sent_via=p_via,sent_to=btrim(p_recipient),sent_by=nullif(btrim(coalesce(p_sender,'')),'') where id=row.id returning * into row;
  if previous_status='Approved' then insert into public.proposal_history(proposal_id,event_type,previous_status,new_status,description,metadata,performed_by) values(row.id,'Sent by '||p_via,previous_status,'Sent',null,jsonb_build_object('revision_number',row.revision_number),coalesce(nullif(btrim(p_sender),''),'StudioScrubz User')); end if;
  return jsonb_build_object('sent_at',row.sent_at,'revision_number',row.revision_number);
end $$;
revoke all on function public.mark_proposal_sent_for_delivery(uuid,text,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.mark_proposal_sent_for_delivery(uuid,text,text,text,text,timestamptz,jsonb) to authenticated;

create or replace function public.get_proposal_by_token(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if p_token is null or length(p_token)<32 then raise exception 'This proposal link is invalid, expired, or no longer available.'; end if;
  select p.client_delivery_snapshot||jsonb_build_object(
    'status',p.status,'revision_number',p.revision_number,'is_current_revision',p.is_current_revision,'superseded',not p.is_current_revision,
    'accepted_at',p.accepted_at,'accepted_by_name',p.accepted_by_name,'client_acceptance_consent',p.client_acceptance_consent,
    'business_name',coalesce(bs.business_name,'StudioScrubz'),'tagline',bs.tagline,'business_email',bs.business_email,'business_phone',bs.business_phone,'website',bs.website,'address',bs.address,'city',bs.city,'state',bs.state,'zip',bs.zip,
    'deposit_instructions',case when p.status='Accepted' and dr.id is not null then jsonb_build_object('status',dr.status,'payment_method',dr.payment_method,'recipient_name',dr.recipient_name,'recipient_phone',dr.recipient_phone,'required_amount',dr.required_amount,'remaining_balance',dr.remaining_balance,'currency',dr.currency,'rendered_memo',dr.rendered_memo,'instruction_version',dr.instruction_version) else null end
  ) into v_result
  from public.proposals p left join public.business_settings bs on true left join public.proposal_deposit_requirements dr on dr.proposal_id=p.id
  where p.client_access_token=p_token and p.archived_at is null and p.status in ('Sent','Viewed','Accepted') and p.client_delivery_snapshot is not null and (p.status='Accepted' or p.expiration_date>=current_date) and (p.client_access_token_expires_at is null or p.client_access_token_expires_at>now()) limit 1;
  if v_result is null then raise exception 'This proposal link is invalid, expired, or no longer available.'; end if;
  return v_result;
end $$;
revoke all on function public.get_proposal_by_token(text) from public,anon,authenticated;
grant execute on function public.get_proposal_by_token(text) to anon,authenticated;

create or replace function public.accept_proposal_by_token(p_token text,p_accepted_by_name text,p_consent boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_name text:=btrim(coalesce(p_accepted_by_name,'')); v_consent constant text:='I have reviewed and accept this Proposal.'; v_id uuid; v_group uuid; v_previous_status text; v_current boolean; v_accepted_at timestamptz:=now(); v_updated_count integer;
begin
  if p_token is null or length(p_token)<32 then raise exception 'This proposal link is invalid, expired, or no longer available.'; end if;
  if p_consent is distinct from true then raise exception 'Explicit consent is required to accept this Proposal.'; end if;
  if length(v_name)<2 or length(v_name)>150 then raise exception 'Enter a valid full name.'; end if;
  select p.id,p.revision_group_id into v_id,v_group from public.proposals p where p.client_access_token=p_token limit 1;
  if v_id is null then raise exception 'This Proposal cannot be accepted because it is invalid, expired, archived, or unavailable.'; end if;
  perform 1 from public.proposals p where p.revision_group_id=v_group for update;
  select p.status,p.is_current_revision into v_previous_status,v_current from public.proposals p where p.id=v_id and p.archived_at is null and p.status in ('Sent','Viewed','Accepted') and p.approval_status='Approved' and p.expiration_date>=current_date and (p.client_access_token_expires_at is null or p.client_access_token_expires_at>now());
  if v_previous_status is null then raise exception 'This Proposal cannot be accepted because it is invalid, expired, archived, or unavailable.'; end if;
  if not v_current then raise exception 'This Proposal has been revised and can no longer be accepted. Please review the current Proposal.'; end if;
  if v_previous_status='Accepted' then perform private.ensure_post_construction_acceptance_handoff(v_id); return public.get_proposal_by_token(p_token); end if;
  perform set_config('studioscrubz.controlled_proposal_acceptance','on',true);
  update public.proposals set status='Accepted',accepted=true,accepted_at=v_accepted_at,accepted_by_name=v_name,acceptance_method='Signed Proposal',client_acceptance_consent=v_consent,client_acceptance_consent_at=v_accepted_at where id=v_id and status in ('Sent','Viewed') and accepted=false and is_current_revision=true;
  get diagnostics v_updated_count=row_count;
  if v_updated_count<>1 then raise exception 'This Proposal changed before acceptance could be completed. Refresh and try again.'; end if;
  insert into public.proposal_history(proposal_id,event_type,previous_status,new_status,description,metadata,performed_by) values(v_id,'Accepted',v_previous_status,'Accepted','Proposal accepted through the secure client review page.',jsonb_build_object('accepted_by_name',v_name,'accepted_at',v_accepted_at),'Client');
  perform private.ensure_post_construction_acceptance_handoff(v_id);
  return public.get_proposal_by_token(p_token);
end $$;
revoke all on function public.accept_proposal_by_token(text,text,boolean) from public,anon,authenticated;
grant execute on function public.accept_proposal_by_token(text,text,boolean) to anon,authenticated;

commit;
