begin;

alter table public.business_settings
  add column post_construction_deposit_percent numeric(5,2) not null default 25.00,
  add column post_construction_payment_method text not null default 'Zelle',
  add column post_construction_payment_recipient_name text not null default 'Joseph Garcia',
  add column post_construction_payment_recipient_phone text not null default '8186310746',
  add column post_construction_payment_memo_template text not null default 'Proposal {{proposal_number}} - {{client_name}}';

alter table public.business_settings
  add constraint business_settings_pc_deposit_percent_check check (post_construction_deposit_percent > 0 and post_construction_deposit_percent <= 100),
  add constraint business_settings_pc_payment_method_check check (post_construction_payment_method = 'Zelle'),
  add constraint business_settings_pc_recipient_name_check check (length(btrim(post_construction_payment_recipient_name)) between 2 and 150),
  add constraint business_settings_pc_recipient_phone_check check (post_construction_payment_recipient_phone ~ '^[0-9]{10,15}$'),
  add constraint business_settings_pc_memo_template_check check (length(btrim(post_construction_payment_memo_template)) between 1 and 300);

create or replace view public.business_settings_workflow
with (security_barrier = true) as
select
  id, business_name, tagline, business_email, business_phone, website, address, city, state, zip,
  default_tax_rate, default_estimate_expiration_days, default_proposal_expiration_days,
  default_invoice_due_days, default_payment_terms, default_invoice_terms, default_proposal_terms,
  default_estimate_notes, currency, timezone, created_at, updated_at, default_service_agreement_terms,
  default_estimate_terms, default_cancellation_terms, upkeep_adjustment_percent,
  post_construction_deposit_percent, post_construction_payment_method,
  post_construction_payment_recipient_name, post_construction_payment_recipient_phone,
  post_construction_payment_memo_template
from public.business_settings
where auth.uid() is not null
  and public.has_any_role(array['Master Admin','Administrator','Manager','Sales']);
revoke all on public.business_settings_workflow from public, anon, authenticated;
grant select on public.business_settings_workflow to authenticated;

create table public.proposal_deposit_requirements (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references public.proposals(id) on delete restrict,
  agreement_id uuid references public.service_agreements(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  currency text not null,
  deposit_percent numeric(5,2) not null check (deposit_percent > 0 and deposit_percent <= 100),
  accepted_total numeric(12,2) not null check (accepted_total >= 0),
  required_amount numeric(12,2) not null check (required_amount >= 0),
  remaining_balance numeric(12,2) not null check (remaining_balance >= 0),
  status text not null default 'Required' check (status in ('Required','Received','Reversed','Applied To Invoice')),
  payment_method text not null check (payment_method = 'Zelle'),
  recipient_name text not null,
  recipient_phone text not null check (recipient_phone ~ '^[0-9]{10,15}$'),
  rendered_memo text not null,
  instruction_version integer not null default 1 check (instruction_version > 0),
  received_payment_id uuid,
  received_date date,
  received_reference_number text,
  received_notes text,
  received_by uuid references public.user_profiles(id) on delete set null,
  received_at timestamptz,
  reversed_by uuid references public.user_profiles(id) on delete set null,
  reversed_at timestamptz,
  reversal_reason text,
  applied_invoice_id uuid references public.invoices(id) on delete restrict,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposal_deposit_amounts_reconcile check (
    required_amount = round(accepted_total * deposit_percent / 100, 2)
    and remaining_balance = round(accepted_total - required_amount, 2)
  )
);

create table public.proposal_deposit_events (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.proposal_deposit_requirements(id) on delete restrict,
  event_type text not null check (event_type in ('Required','Instructions Refreshed','Received','Reversed','Applied To Invoice')),
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index proposal_deposit_events_requirement_idx on public.proposal_deposit_events(requirement_id, created_at);

alter table public.payments
  add column deposit_requirement_id uuid references public.proposal_deposit_requirements(id) on delete restrict,
  add column voided_at timestamptz,
  add column voided_by uuid references public.user_profiles(id) on delete set null,
  add column void_reason text;
alter table public.proposal_deposit_requirements
  add constraint proposal_deposit_received_payment_fkey foreign key (received_payment_id) references public.payments(id) on delete restrict;
create unique index one_active_payment_per_deposit_requirement
  on public.payments(deposit_requirement_id)
  where deposit_requirement_id is not null and voided_at is null;

create or replace function private.prevent_agreement_delete_with_deposit_activity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(
    select 1 from public.proposal_deposit_requirements requirement
    where requirement.agreement_id=old.id
      and (requirement.status<>'Required' or exists(
        select 1 from public.payments payment
        where payment.deposit_requirement_id=requirement.id
      ))
  ) then raise exception 'An Agreement with deposit payment activity cannot be deleted.'; end if;
  return old;
end $$;
revoke all on function private.prevent_agreement_delete_with_deposit_activity() from public,anon,authenticated;
drop trigger if exists service_agreements_prevent_deposit_activity_delete on public.service_agreements;
create trigger service_agreements_prevent_deposit_activity_delete before delete on public.service_agreements
for each row execute function private.prevent_agreement_delete_with_deposit_activity();

alter table public.proposal_deposit_requirements enable row level security;
alter table public.proposal_deposit_events enable row level security;
revoke all on public.proposal_deposit_requirements, public.proposal_deposit_events from public, anon, authenticated;
grant select on public.proposal_deposit_requirements, public.proposal_deposit_events to authenticated;
create policy "Management reads proposal deposits" on public.proposal_deposit_requirements
  for select to authenticated using (public.has_any_role(array['Master Admin','Administrator','Manager']));
create policy "Management reads proposal deposit events" on public.proposal_deposit_events
  for select to authenticated using (public.has_any_role(array['Master Admin','Administrator','Manager']));

create or replace function private.render_post_construction_deposit_memo(p_template text,p_proposal_number text,p_client_name text)
returns text language sql immutable security invoker set search_path = '' as $$
  select left(replace(replace(p_template,'{{proposal_number}}',coalesce(p_proposal_number,'')),'{{client_name}}',coalesce(p_client_name,'')),300)
$$;
revoke all on function private.render_post_construction_deposit_memo(text,text,text) from public,anon,authenticated;

create or replace function private.ensure_post_construction_deposit_requirement(p_proposal_id uuid,p_agreement_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare proposal_row public.proposals; settings_row public.business_settings; requirement_id uuid;
  accepted_total numeric; deposit_percent numeric; required_amount numeric; currency_code text;
begin
  select * into proposal_row from public.proposals where id=p_proposal_id for update;
  if not found or proposal_row.status<>'Accepted' or proposal_row.accepted is distinct from true
    or proposal_row.frequency<>'One-Time'
    or lower(coalesce(proposal_row.client_delivery_snapshot->>'service_name',proposal_row.result->>'serviceName',''))<>'post-construction cleaning'
  then return null; end if;
  select id into requirement_id from public.proposal_deposit_requirements where proposal_id=proposal_row.id;
  if found then
    update public.proposal_deposit_requirements set agreement_id=coalesce(agreement_id,p_agreement_id),updated_at=now() where id=requirement_id;
    return requirement_id;
  end if;
  select * into settings_row from public.business_settings limit 1;
  if settings_row.id is null then raise exception 'Business Settings are required before accepting this Proposal.'; end if;
  if coalesce(proposal_row.client_delivery_snapshot->>'per_visit_total','') !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception 'The sent Proposal snapshot does not contain a valid final total.';
  end if;
  accepted_total := round((proposal_row.client_delivery_snapshot->>'per_visit_total')::numeric,2);
  deposit_percent := coalesce(nullif(proposal_row.client_delivery_snapshot->>'deposit_percent','')::numeric,settings_row.post_construction_deposit_percent);
  required_amount := round(accepted_total*deposit_percent/100,2);
  currency_code := coalesce(nullif(settings_row.currency,''),'USD');
  insert into public.proposal_deposit_requirements(
    proposal_id,agreement_id,client_id,property_id,currency,deposit_percent,accepted_total,required_amount,remaining_balance,
    payment_method,recipient_name,recipient_phone,rendered_memo
  ) values (
    proposal_row.id,p_agreement_id,proposal_row.client_id,proposal_row.property_id,currency_code,deposit_percent,accepted_total,
    required_amount,round(accepted_total-required_amount,2),settings_row.post_construction_payment_method,
    btrim(settings_row.post_construction_payment_recipient_name),settings_row.post_construction_payment_recipient_phone,
    private.render_post_construction_deposit_memo(settings_row.post_construction_payment_memo_template,proposal_row.proposal_number,coalesce(proposal_row.client_name,'Client'))
  ) returning id into requirement_id;
  insert into public.proposal_deposit_events(requirement_id,event_type,metadata)
  values(requirement_id,'Required',jsonb_build_object('accepted_total',accepted_total,'deposit_percent',deposit_percent,'required_amount',required_amount,'instruction_version',1));
  return requirement_id;
exception when unique_violation then
  select id into requirement_id from public.proposal_deposit_requirements where proposal_id=p_proposal_id;
  return requirement_id;
end $$;
revoke all on function private.ensure_post_construction_deposit_requirement(uuid,uuid) from public,anon,authenticated;

create or replace function private.ensure_post_construction_acceptance_handoff(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare agreement_id uuid; requirement_id uuid;
begin
  agreement_id:=private.ensure_post_construction_draft_agreement(p_proposal_id);
  if agreement_id is null then return null; end if;
  requirement_id:=private.ensure_post_construction_deposit_requirement(p_proposal_id,agreement_id);
  return jsonb_build_object('agreement_id',agreement_id,'deposit_requirement_id',requirement_id);
end $$;
revoke all on function private.ensure_post_construction_acceptance_handoff(uuid) from public,anon,authenticated;

create or replace function public.create_post_construction_draft_agreement(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare handoff jsonb;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then
    raise exception 'Agreement creation permission denied.' using errcode='42501';
  end if;
  handoff:=private.ensure_post_construction_acceptance_handoff(p_proposal_id);
  if handoff is null then raise exception 'Only an accepted one-time Post-Construction Proposal can create this Draft Agreement.'; end if;
  return (handoff->>'agreement_id')::uuid;
end $$;
revoke all on function public.create_post_construction_draft_agreement(uuid) from public,anon,authenticated;
grant execute on function public.create_post_construction_draft_agreement(uuid) to authenticated;

create or replace function public.mark_proposal_sent_for_delivery(p_proposal_id uuid,p_via text,p_recipient text,p_sender text,p_token text,p_token_expires_at timestamptz,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare proposal_row public.proposals; settings_row public.business_settings; previous_status text; safe_snapshot jsonb; total numeric; required numeric;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then raise exception 'You do not have permission to send Proposals.'; end if;
  if p_via not in ('Email','Text') or length(btrim(coalesce(p_recipient,'')))<3 then raise exception 'A valid Proposal delivery recipient is required.'; end if;
  if p_token is null or length(p_token)<32 or p_token_expires_at<=now() then raise exception 'A valid secure Proposal token is required.'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' then raise exception 'A client-facing Proposal snapshot is required.'; end if;
  select * into proposal_row from public.proposals where id=p_proposal_id for update;
  if not found or proposal_row.status not in ('Approved','Sent','Viewed') then raise exception 'This Proposal is unavailable for delivery.'; end if;
  previous_status:=proposal_row.status; safe_snapshot:=p_snapshot;
  if proposal_row.frequency='One-Time' and lower(coalesce(proposal_row.result->>'serviceName',''))='post-construction cleaning' then
    select * into settings_row from public.business_settings limit 1;
    if coalesce(p_snapshot->>'per_visit_total','') !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'The Proposal snapshot final total is invalid.'; end if;
    total:=round((p_snapshot->>'per_visit_total')::numeric,2);
    required:=round(total*settings_row.post_construction_deposit_percent/100,2);
    safe_snapshot:=p_snapshot||jsonb_build_object('deposit_percent',settings_row.post_construction_deposit_percent,'required_deposit_amount',required,'remaining_balance',round(total-required,2));
  end if;
  perform set_config('studioscrubz.controlled_delivery_snapshot','on',true);
  update public.proposals set status='Sent',sent_at=now(),sent_via=p_via,sent_to=btrim(p_recipient),sent_by=nullif(btrim(coalesce(p_sender,'')),''),client_access_token=p_token,client_access_token_expires_at=p_token_expires_at,client_delivery_snapshot=safe_snapshot
  where id=proposal_row.id and archived_at is null and approval_status='Approved' and accepted=false and expiration_date>=current_date returning * into proposal_row;
  if proposal_row.id is null then raise exception 'This Proposal is expired, archived, accepted, or unavailable for delivery.'; end if;
  insert into public.proposal_history(proposal_id,event_type,previous_status,new_status,description,metadata,performed_by)
  values(proposal_row.id,'Sent by '||p_via,previous_status,'Sent',null,'{}'::jsonb,coalesce(nullif(btrim(p_sender),''),'StudioScrubz User'));
  return jsonb_build_object('sent_at',proposal_row.sent_at);
end $$;
revoke all on function public.mark_proposal_sent_for_delivery(uuid,text,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.mark_proposal_sent_for_delivery(uuid,text,text,text,text,timestamptz,jsonb) to authenticated;

create or replace function private.create_post_construction_agreement_after_acceptance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='Accepted' and new.accepted is true
    and (old.status is distinct from new.status or old.accepted is distinct from new.accepted)
  then perform private.ensure_post_construction_acceptance_handoff(new.id); end if;
  return new;
end $$;
revoke all on function private.create_post_construction_agreement_after_acceptance() from public,anon,authenticated;

create or replace function public.get_proposal_by_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_token is null or length(p_token)<32 then raise exception 'This proposal link is invalid, expired, or no longer available.'; end if;
  select p.client_delivery_snapshot || jsonb_build_object(
    'status',p.status,'accepted_at',p.accepted_at,'accepted_by_name',p.accepted_by_name,
    'client_acceptance_consent',p.client_acceptance_consent,
    'business_name',coalesce(bs.business_name,'StudioScrubz'),'tagline',bs.tagline,'business_email',bs.business_email,
    'business_phone',bs.business_phone,'website',bs.website,'address',bs.address,'city',bs.city,'state',bs.state,'zip',bs.zip,
    'deposit_instructions',case when p.status='Accepted' and dr.id is not null then jsonb_build_object(
      'status',dr.status,'payment_method',dr.payment_method,'recipient_name',dr.recipient_name,'recipient_phone',dr.recipient_phone,
      'required_amount',dr.required_amount,'remaining_balance',dr.remaining_balance,'currency',dr.currency,
      'rendered_memo',dr.rendered_memo,'instruction_version',dr.instruction_version) else null end
  ) into v_result
  from public.proposals p left join public.business_settings bs on true
  left join public.proposal_deposit_requirements dr on dr.proposal_id=p.id
  where p.client_access_token=p_token and p.archived_at is null and p.status in ('Sent','Viewed','Accepted')
    and p.client_delivery_snapshot is not null and (p.status='Accepted' or p.expiration_date>=current_date)
    and (p.client_access_token_expires_at is null or p.client_access_token_expires_at>now()) limit 1;
  if v_result is null then raise exception 'This proposal link is invalid, expired, or no longer available.'; end if;
  return v_result;
end $$;
revoke all on function public.get_proposal_by_token(text) from public,anon,authenticated;
grant execute on function public.get_proposal_by_token(text) to anon,authenticated;

create or replace function public.accept_proposal_by_token(p_token text,p_accepted_by_name text,p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_name text:=btrim(coalesce(p_accepted_by_name,'')); v_consent constant text:='I have reviewed and accept this Proposal.';
  v_id uuid; v_previous_status text; v_accepted_at timestamptz:=now(); v_updated_count integer;
begin
  if p_token is null or length(p_token)<32 then raise exception 'This proposal link is invalid, expired, or no longer available.'; end if;
  if p_consent is distinct from true then raise exception 'Explicit consent is required to accept this Proposal.'; end if;
  if length(v_name)<2 or length(v_name)>150 then raise exception 'Enter a valid full name.'; end if;
  select p.id,p.status into v_id,v_previous_status from public.proposals p where p.client_access_token=p_token and p.archived_at is null
    and p.status in ('Sent','Viewed','Accepted') and p.approval_status='Approved' and p.expiration_date>=current_date
    and (p.client_access_token_expires_at is null or p.client_access_token_expires_at>now()) limit 1 for update;
  if v_id is null then raise exception 'This Proposal cannot be accepted because it is invalid, expired, archived, or unavailable.'; end if;
  if v_previous_status='Accepted' then perform private.ensure_post_construction_acceptance_handoff(v_id); return public.get_proposal_by_token(p_token); end if;
  perform set_config('studioscrubz.controlled_proposal_acceptance','on',true);
  update public.proposals set status='Accepted',accepted=true,accepted_at=v_accepted_at,accepted_by_name=v_name,
    acceptance_method='Signed Proposal',client_acceptance_consent=v_consent,client_acceptance_consent_at=v_accepted_at
  where id=v_id and status in ('Sent','Viewed') and accepted=false;
  get diagnostics v_updated_count=row_count;
  if v_updated_count<>1 then raise exception 'This Proposal changed before acceptance could be completed. Refresh and try again.'; end if;
  insert into public.proposal_history(proposal_id,event_type,previous_status,new_status,description,metadata,performed_by)
  values(v_id,'Accepted',v_previous_status,'Accepted','Proposal accepted through the secure client review page.',jsonb_build_object('accepted_by_name',v_name,'accepted_at',v_accepted_at),'Client');
  perform private.ensure_post_construction_acceptance_handoff(v_id);
  return public.get_proposal_by_token(p_token);
end $$;
revoke all on function public.accept_proposal_by_token(text,text,boolean) from public,anon,authenticated;
grant execute on function public.accept_proposal_by_token(text,text,boolean) to anon,authenticated;

create or replace function public.confirm_post_construction_deposit(p_proposal_id uuid,p_received_date date,p_reference_number text default null,p_notes text default null)
returns public.proposal_deposit_requirements language plpgsql security definer set search_path = '' as $$
declare proposal_row public.proposals; agreement_row public.service_agreements; requirement_row public.proposal_deposit_requirements; payment_row public.payments;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Deposit confirmation permission denied.' using errcode='42501'; end if;
  if p_received_date is null then raise exception 'Received date is required.'; end if;
  select * into proposal_row from public.proposals where id=p_proposal_id for update; if not found then raise exception 'Proposal not found.'; end if;
  select * into agreement_row from public.service_agreements where proposal_id=proposal_row.id and archived_at is null and status not in ('Cancelled','Archived') order by created_at limit 1 for update;
  if not found then raise exception 'The active Draft Agreement was not found.'; end if;
  select * into requirement_row from public.proposal_deposit_requirements where proposal_id=proposal_row.id for update;
  if not found then raise exception 'The deposit requirement was not found.'; end if;
  select * into payment_row from public.payments where deposit_requirement_id=requirement_row.id and voided_at is null for update;
  if requirement_row.status in ('Received','Applied To Invoice') and payment_row.id is not null then return requirement_row; end if;
  if requirement_row.status<>'Required' then raise exception 'This deposit is not awaiting confirmation.'; end if;
  if requirement_row.required_amount<>round(requirement_row.accepted_total*requirement_row.deposit_percent/100,2) then raise exception 'The immutable deposit amount is invalid.'; end if;
  if payment_row.id is null then
    insert into public.payments(invoice_id,client_id,job_id,amount,payment_date,payment_method,reference_number,notes,deposit_requirement_id)
    values(null,requirement_row.client_id,null,requirement_row.required_amount,p_received_date,'Zelle',nullif(btrim(coalesce(p_reference_number,'')),''),nullif(btrim(coalesce(p_notes,'')),''),requirement_row.id)
    returning * into payment_row;
  end if;
  update public.proposal_deposit_requirements set status='Received',received_payment_id=payment_row.id,received_date=p_received_date,
    received_reference_number=nullif(btrim(coalesce(p_reference_number,'')),''),received_notes=nullif(btrim(coalesce(p_notes,'')),''),
    received_by=auth.uid(),received_at=now(),updated_at=now() where id=requirement_row.id returning * into requirement_row;
  insert into public.proposal_deposit_events(requirement_id,event_type,actor_user_id,metadata)
  values(requirement_row.id,'Received',auth.uid(),jsonb_build_object('payment_id',payment_row.id,'amount',payment_row.amount,'received_date',p_received_date));
  return requirement_row;
end $$;

create or replace function public.refresh_post_construction_deposit_instructions(p_proposal_id uuid)
returns public.proposal_deposit_requirements language plpgsql security definer set search_path = '' as $$
declare proposal_row public.proposals; agreement_row public.service_agreements; requirement_row public.proposal_deposit_requirements; settings_row public.business_settings;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Deposit instruction refresh permission denied.' using errcode='42501'; end if;
  select * into proposal_row from public.proposals where id=p_proposal_id for update; if not found then raise exception 'Proposal not found.'; end if;
  select * into agreement_row from public.service_agreements where proposal_id=proposal_row.id and archived_at is null and status not in ('Cancelled','Archived') order by created_at limit 1 for update;
  select * into requirement_row from public.proposal_deposit_requirements where proposal_id=proposal_row.id for update; if not found then raise exception 'Deposit requirement not found.'; end if;
  if requirement_row.status<>'Required' then raise exception 'Payment instructions are frozen after deposit receipt.'; end if;
  select * into settings_row from public.business_settings limit 1;
  update public.proposal_deposit_requirements set payment_method=settings_row.post_construction_payment_method,
    recipient_name=btrim(settings_row.post_construction_payment_recipient_name),recipient_phone=settings_row.post_construction_payment_recipient_phone,
    rendered_memo=private.render_post_construction_deposit_memo(settings_row.post_construction_payment_memo_template,proposal_row.proposal_number,coalesce(proposal_row.client_name,'Client')),
    instruction_version=instruction_version+1,updated_at=now() where id=requirement_row.id returning * into requirement_row;
  insert into public.proposal_deposit_events(requirement_id,event_type,actor_user_id,metadata)
  values(requirement_row.id,'Instructions Refreshed',auth.uid(),jsonb_build_object('instruction_version',requirement_row.instruction_version));
  return requirement_row;
end $$;

create or replace function public.reverse_post_construction_deposit(p_proposal_id uuid,p_reason text)
returns public.proposal_deposit_requirements language plpgsql security definer set search_path = '' as $$
declare proposal_row public.proposals; agreement_row public.service_agreements; requirement_row public.proposal_deposit_requirements; payment_row public.payments;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Deposit reversal permission denied.' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A reversal reason is required.'; end if;
  select * into proposal_row from public.proposals where id=p_proposal_id for update; if not found then raise exception 'Proposal not found.'; end if;
  select * into agreement_row from public.service_agreements where proposal_id=proposal_row.id and archived_at is null and status not in ('Cancelled','Archived') order by created_at limit 1 for update;
  if not found or agreement_row.status<>'Draft' or agreement_row.sent_at is not null then raise exception 'A deposit cannot be reversed after the Agreement is sent.'; end if;
  select * into requirement_row from public.proposal_deposit_requirements where proposal_id=proposal_row.id for update;
  if not found or requirement_row.status<>'Received' or requirement_row.applied_invoice_id is not null then raise exception 'Only a received, unapplied deposit may be reversed.'; end if;
  select * into payment_row from public.payments where id=requirement_row.received_payment_id for update;
  if not found or payment_row.voided_at is not null or payment_row.invoice_id is not null then raise exception 'The linked deposit payment cannot be reversed.'; end if;
  update public.payments set voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_reason) where id=payment_row.id;
  update public.proposal_deposit_requirements set status='Reversed',reversed_by=auth.uid(),reversed_at=now(),reversal_reason=btrim(p_reason),updated_at=now()
    where id=requirement_row.id returning * into requirement_row;
  insert into public.proposal_deposit_events(requirement_id,event_type,actor_user_id,metadata)
  values(requirement_row.id,'Reversed',auth.uid(),jsonb_build_object('payment_id',payment_row.id,'reason',btrim(p_reason)));
  return requirement_row;
end $$;

create or replace function public.reopen_post_construction_deposit(p_proposal_id uuid)
returns public.proposal_deposit_requirements language plpgsql security definer set search_path = '' as $$
declare proposal_row public.proposals; agreement_row public.service_agreements; requirement_row public.proposal_deposit_requirements;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Deposit reopening permission denied.' using errcode='42501'; end if;
  select * into proposal_row from public.proposals where id=p_proposal_id for update; if not found then raise exception 'Proposal not found.'; end if;
  select * into agreement_row from public.service_agreements where proposal_id=proposal_row.id and archived_at is null and status not in ('Cancelled','Archived') order by created_at limit 1 for update;
  if not found or agreement_row.status<>'Draft' then raise exception 'The Agreement must remain Draft.'; end if;
  select * into requirement_row from public.proposal_deposit_requirements where proposal_id=proposal_row.id for update;
  if not found or requirement_row.status<>'Reversed' then raise exception 'Only a reversed deposit may be reopened.'; end if;
  update public.proposal_deposit_requirements set status='Required',updated_at=now() where id=requirement_row.id returning * into requirement_row;
  insert into public.proposal_deposit_events(requirement_id,event_type,actor_user_id,metadata)
  values(requirement_row.id,'Required',auth.uid(),jsonb_build_object('reason','Reopened after reversal'));
  return requirement_row;
end $$;

create or replace function private.require_post_construction_deposit_before_agreement_send()
returns trigger language plpgsql security definer set search_path = '' as $$
declare requirement_row public.proposal_deposit_requirements;
begin
  if new.status='Sent' and old.status is distinct from 'Sent' and new.proposal_id is not null
    and exists(select 1 from public.proposals p where p.id=new.proposal_id and p.frequency='One-Time' and lower(coalesce(p.result->>'serviceName',''))='post-construction cleaning')
  then
    select * into requirement_row from public.proposal_deposit_requirements where proposal_id=new.proposal_id for update;
    if not found or requirement_row.status not in ('Received','Applied To Invoice')
      or not exists(select 1 from public.payments payment where payment.deposit_requirement_id=requirement_row.id and payment.voided_at is null and payment.amount=requirement_row.required_amount)
    then raise exception 'Deposit confirmation required before this Agreement can be sent.'; end if;
  end if;
  return new;
end $$;
revoke all on function private.require_post_construction_deposit_before_agreement_send() from public,anon,authenticated;
drop trigger if exists service_agreements_require_pc_deposit_before_send on public.service_agreements;
create trigger service_agreements_require_pc_deposit_before_send before update of status on public.service_agreements
for each row execute function private.require_post_construction_deposit_before_agreement_send();

create or replace function public.mark_service_agreement_sent_for_delivery(p_agreement_id uuid,p_sent_to text,p_sent_by text,p_token text,p_token_expires_at timestamptz)
returns public.service_agreements language plpgsql security definer set search_path = '' as $$
declare proposal_id uuid; proposal_row public.proposals; agreement_row public.service_agreements; requirement_row public.proposal_deposit_requirements;
begin
  if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Sales']) then raise exception 'Agreement delivery permission denied.' using errcode='42501'; end if;
  if length(btrim(coalesce(p_sent_to,'')))<3 then raise exception 'A client delivery recipient is required.'; end if;
  if p_token is null or length(p_token)<32 or p_token_expires_at<=now() then raise exception 'A valid secure Agreement token is required.'; end if;
  select a.proposal_id into proposal_id from public.service_agreements a where a.id=p_agreement_id;
  if proposal_id is not null then select * into proposal_row from public.proposals where id=proposal_id for update; end if;
  select * into agreement_row from public.service_agreements where id=p_agreement_id for update;
  if not found or agreement_row.archived_at is not null or agreement_row.status not in ('Draft','Sent') then raise exception 'This Agreement is unavailable for delivery.'; end if;
  if agreement_row.status='Sent' then return agreement_row; end if;
  if proposal_id is not null and proposal_row.frequency='One-Time' and lower(coalesce(proposal_row.result->>'serviceName',''))='post-construction cleaning' then
    select * into requirement_row from public.proposal_deposit_requirements where proposal_id=proposal_id for update;
    if not found or requirement_row.status not in ('Received','Applied To Invoice')
      or not exists(select 1 from public.payments p where p.deposit_requirement_id=requirement_row.id and p.voided_at is null and p.amount=requirement_row.required_amount)
    then raise exception 'Deposit confirmation required before this Agreement can be sent.'; end if;
  end if;
  update public.service_agreements set status='Sent',sent_at=now(),sent_to=btrim(p_sent_to),sent_by=nullif(btrim(coalesce(p_sent_by,'')),''),
    client_access_token=p_token,client_access_token_expires_at=p_token_expires_at where id=agreement_row.id returning * into agreement_row;
  return agreement_row;
end $$;

revoke all on function public.confirm_post_construction_deposit(uuid,date,text,text),public.refresh_post_construction_deposit_instructions(uuid),
  public.reverse_post_construction_deposit(uuid,text),public.reopen_post_construction_deposit(uuid),
  public.mark_service_agreement_sent_for_delivery(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.confirm_post_construction_deposit(uuid,date,text,text),public.refresh_post_construction_deposit_instructions(uuid),
  public.reverse_post_construction_deposit(uuid,text),public.reopen_post_construction_deposit(uuid),
  public.mark_service_agreement_sent_for_delivery(uuid,text,text,text,timestamptz) to authenticated;

create or replace function public.create_completed_job_invoice(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller_role text; job_row public.jobs; client_row public.clients; proposal_row public.proposals; settings_row public.business_settings;
  amount numeric; issue_date date:=current_date; invoice_id uuid; invoice_number text; line_items jsonb; snapshot_addon jsonb; attempt integer;
  violated_constraint_name text; requirement_row public.proposal_deposit_requirements; payment_row public.payments; new_status text;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  caller_role:=public.current_user_role(); if caller_role is null or caller_role not in ('Master Admin','Administrator','Manager','Crew Lead') then raise exception 'Job completion invoicing is not permitted.'; end if;
  select * into job_row from public.jobs where id=p_job_id for update; if not found then raise exception 'Job not found.'; end if;
  if job_row.archived_at is not null or job_row.status='Archived' then raise exception 'Archived Jobs cannot be invoiced.'; end if;
  if caller_role='Crew Lead' and (job_row.assigned_crew_id is null or not public.is_assigned_to_crew(job_row.assigned_crew_id)) then raise exception 'Job is not assigned to your crew.'; end if;
  if job_row.status is distinct from 'Completed' then raise exception 'Only completed Jobs can be invoiced.'; end if;
  select i.id,i.invoice_number into invoice_id,invoice_number from public.invoices i where i.job_id=job_row.id and i.archived_at is null and i.status<>'Cancelled' order by i.created_at limit 1;
  if found then return jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'created',false,'skipped',false,'financially_resolved',true); end if;
  if public.is_job_financially_handed_off(job_row.id) then
    select i.id,i.invoice_number into invoice_id,invoice_number
    from public.invoices i where i.job_id=job_row.id and (
      (coalesce(i.amount_paid,0)>0 and coalesce(i.balance_due,i.total)<=0 and coalesce(i.amount_paid,0)>=coalesce(i.total,0))
      or (coalesce(i.total,0)>0 and coalesce((select sum(p.amount) from public.payments p where p.invoice_id=i.id and p.voided_at is null),0)>=i.total)
    ) order by i.created_at desc limit 1;
    return jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'created',false,'skipped',true,'financially_resolved',true);
  end if;
  if job_row.service_occurrence_id is not null and exists(select 1 from public.service_occurrences o join public.service_agreements a on a.id=o.agreement_id where o.id=job_row.service_occurrence_id and a.billing_type in ('Weekly','Biweekly','Monthly','Flat Contract')) then
    return jsonb_build_object('invoice_id',null,'invoice_number',null,'created',false,'skipped',true,'financially_resolved',false); end if;
  select * into client_row from public.clients where id=job_row.client_id; select * into proposal_row from public.proposals where id=job_row.proposal_id; select * into settings_row from public.business_settings limit 1;
  if job_row.price is null or job_row.price='NaN'::numeric or job_row.price<0 then raise exception 'The completed Job does not contain a valid authoritative price.'; end if;
  amount:=job_row.price;
  if job_row.pricing_snapshot is null then line_items:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'description',coalesce(nullif(job_row.service_name,''),'StudioScrubz service'),'quantity',1,'rate',amount,'amount',amount));
  else
    if not public.is_valid_job_pricing_snapshot(job_row.pricing_snapshot,amount) then raise exception 'The completed Job pricing snapshot is invalid or does not reconcile to the authoritative Job price.'; end if;
    line_items:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'description',coalesce(nullif(job_row.service_name,''),'StudioScrubz service'),'quantity',1,'rate',round((job_row.pricing_snapshot->>'baseServiceAmount')::numeric,2),'amount',round((job_row.pricing_snapshot->>'baseServiceAmount')::numeric,2)));
    for snapshot_addon in select value from jsonb_array_elements(job_row.pricing_snapshot->'addons') loop
      line_items:=line_items||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'description','Add-On: '||snapshot_addon->>'label'||case when snapshot_addon->>'pricingType'='Per Unit' then ' ('||snapshot_addon->>'unitName'||')' else '' end,'quantity',case when snapshot_addon->>'pricingType'='Per Unit' then (snapshot_addon->>'quantity')::numeric else 1 end,'rate',case when snapshot_addon->>'pricingType'='Per Unit' then (snapshot_addon->>'unitPrice')::numeric else (snapshot_addon->>'lineTotal')::numeric end,'amount',(snapshot_addon->>'lineTotal')::numeric));
    end loop;
  end if;
  if job_row.proposal_id is not null then
    select * into requirement_row from public.proposal_deposit_requirements where proposal_id=job_row.proposal_id for update;
    if found then select * into payment_row from public.payments where deposit_requirement_id=requirement_row.id and voided_at is null for update; end if;
  end if;
  for attempt in 1..5 loop
    invoice_number:='INV-'||to_char(issue_date,'YYYYMMDD')||'-'||lpad(floor(random()*10000)::text,4,'0');
    begin
      new_status:=case when payment_row.id is not null and payment_row.amount>=amount and amount>0 then 'Paid' when payment_row.id is not null and payment_row.amount>0 then 'Partially Paid' else 'Open' end;
      insert into public.invoices(invoice_number,job_id,service_agreement_id,contract_billing_type,billing_period_start,proposal_id,client_id,property_id,client_name,property_name,customer_phone,customer_email,service_name,status,issue_date,due_date,line_items,subtotal,discount,tax,total,amount_paid,balance_due,paid_at,notes,terms)
      values(invoice_number,job_row.id,null,null,null,job_row.proposal_id,job_row.client_id,job_row.property_id,job_row.client_name,job_row.property_name,
        coalesce(nullif(btrim(client_row.phone),''),nullif(btrim(proposal_row.customer_phone),'')),coalesce(nullif(btrim(client_row.email),''),nullif(btrim(proposal_row.customer_email),'')),
        job_row.service_name,new_status,issue_date,issue_date+coalesce(settings_row.default_invoice_due_days,15),line_items,amount,0,0,amount,
        coalesce(payment_row.amount,0),greatest(round(amount-coalesce(payment_row.amount,0),2),0),case when new_status='Paid' then now() end,job_row.internal_notes,coalesce(settings_row.default_invoice_terms,settings_row.default_payment_terms)) returning id into invoice_id;
      if payment_row.id is not null then
        update public.payments set invoice_id=invoice_id,job_id=job_row.id where id=payment_row.id and invoice_id is null;
        if not found then raise exception 'The deposit payment was already applied to another Invoice.'; end if;
        update public.proposal_deposit_requirements set status='Applied To Invoice',applied_invoice_id=invoice_id,applied_at=now(),updated_at=now() where id=requirement_row.id;
        insert into public.proposal_deposit_events(requirement_id,event_type,actor_user_id,metadata) values(requirement_row.id,'Applied To Invoice',auth.uid(),jsonb_build_object('invoice_id',invoice_id,'payment_id',payment_row.id,'amount',payment_row.amount));
      end if;
      return jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'created',true,'skipped',false,'financially_resolved',true);
    exception when unique_violation then
      get stacked diagnostics violated_constraint_name=constraint_name;
      if violated_constraint_name='invoices_one_active_per_job_idx' then
        select i.id,i.invoice_number into invoice_id,invoice_number from public.invoices i where i.job_id=job_row.id and i.archived_at is null and i.status<>'Cancelled' order by i.created_at limit 1;
        if found then return jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'created',false,'skipped',false,'financially_resolved',true); end if;
        raise;
      elsif violated_constraint_name is distinct from 'invoices_invoice_number_key' then raise; end if;
    end;
  end loop;
  raise exception 'A unique Invoice number could not be generated.';
end $$;
revoke all on function public.create_completed_job_invoice(uuid) from public,anon,authenticated;
grant execute on function public.create_completed_job_invoice(uuid) to postgres,service_role,authenticated;

-- Existing invoice payment totals remain ledger-authoritative while voided rows are retained for audit.
create or replace function public.record_invoice_payment(p_invoice_id uuid,p_amount numeric,p_payment_date date,p_payment_method text,p_reference_number text default null,p_notes text default null)
returns public.payments language plpgsql security definer set search_path = '' as $$
declare invoice_row public.invoices; payment_row public.payments; normalized_amount numeric; authoritative_paid numeric; new_balance numeric; new_status text;
begin
  if auth.uid() is null or not public.has_role('Master Admin') then raise exception 'Payment recording permission is required.'; end if;
  select * into invoice_row from public.invoices where id=p_invoice_id for update; if not found then raise exception 'Invoice not found.'; end if;
  if invoice_row.archived_at is not null or invoice_row.status in ('Archived','Cancelled') then raise exception 'This Invoice cannot receive payments.'; end if;
  normalized_amount:=round(p_amount,2); if normalized_amount is null or normalized_amount<=0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if p_payment_date is null then raise exception 'Payment date is required.'; end if;
  if p_payment_method is null or p_payment_method not in ('Cash','Check','Credit Card','Debit Card','ACH','Zelle','Venmo','Cash App','Apple Pay','Other') then raise exception 'Choose a valid payment method.'; end if;
  select round(coalesce(sum(amount),0),2) into authoritative_paid from public.payments where invoice_id=invoice_row.id and voided_at is null;
  if authoritative_paid+normalized_amount>round(invoice_row.total,2) then raise exception 'Payment exceeds the remaining Invoice balance.'; end if;
  insert into public.payments(invoice_id,client_id,job_id,amount,payment_date,payment_method,reference_number,notes)
  values(invoice_row.id,invoice_row.client_id,invoice_row.job_id,normalized_amount,p_payment_date,p_payment_method,nullif(btrim(p_reference_number),''),nullif(btrim(p_notes),'')) returning * into payment_row;
  select round(coalesce(sum(amount),0),2) into authoritative_paid from public.payments where invoice_id=invoice_row.id and voided_at is null;
  new_balance:=greatest(round(invoice_row.total-authoritative_paid,2),0); new_status:=case when authoritative_paid>=round(invoice_row.total,2) and invoice_row.total>0 then 'Paid' when authoritative_paid>0 then 'Partially Paid' when invoice_row.status='Draft' then 'Draft' when invoice_row.status='Sent' then 'Sent' else 'Open' end;
  update public.invoices set amount_paid=authoritative_paid,balance_due=new_balance,status=new_status,paid_at=case when new_status='Paid' then coalesce(invoice_row.paid_at,now()) else null end where id=invoice_row.id;
  return payment_row;
end $$;
revoke all on function public.record_invoice_payment(uuid,numeric,date,text,text,text) from public,anon,authenticated;
grant execute on function public.record_invoice_payment(uuid,numeric,date,text,text,text) to authenticated;

create or replace function public.record_square_invoice_payment(
  p_attempt_id uuid,
  p_square_payment_id text,
  p_square_order_id text,
  p_amount_cents bigint,
  p_currency text,
  p_paid_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.square_checkout_attempts;
  invoice_row public.invoices;
  existing_payment public.payments;
  authoritative_paid numeric;
  payment_amount numeric;
  remaining numeric;
  payment_row public.payments;
begin
  select * into attempt_row from public.square_checkout_attempts where id = p_attempt_id for update;
  if not found then raise exception 'Square checkout attempt not found.'; end if;

  select * into invoice_row from public.invoices where id = attempt_row.invoice_id for update;
  if not found then raise exception 'Invoice not found.'; end if;

  select * into existing_payment from public.payments
  where payment_provider = 'Square' and provider_payment_id = p_square_payment_id;
  if found then
    if existing_payment.invoice_id is distinct from invoice_row.id then raise exception 'Square Payment is already associated with another Invoice.'; end if;
    return jsonb_build_object('created', false, 'conflict', false, 'payment_id', existing_payment.id);
  end if;

  if attempt_row.square_order_id is distinct from p_square_order_id then raise exception 'Square order does not match the checkout attempt.'; end if;
  if attempt_row.amount_cents is distinct from p_amount_cents then
    update public.square_checkout_attempts set status='Conflict',square_payment_id=p_square_payment_id,completed_at=p_paid_at,conflict_reason='Square completed payment amount does not match the authoritative checkout amount.',updated_at=now() where id=p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;
  if attempt_row.currency is distinct from p_currency or p_currency <> 'USD' then
    update public.square_checkout_attempts set status='Conflict',square_payment_id=p_square_payment_id,completed_at=p_paid_at,conflict_reason='Square completed payment currency does not match the Invoice currency.',updated_at=now() where id=p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;
  if invoice_row.archived_at is not null or invoice_row.status in ('Cancelled','Archived') then
    update public.square_checkout_attempts set status='Conflict',square_payment_id=p_square_payment_id,completed_at=p_paid_at,conflict_reason='Square completed payment for a cancelled or archived Invoice.',updated_at=now() where id=p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;

  select round(coalesce(sum(amount),0),2) into authoritative_paid
  from public.payments payment
  where payment.invoice_id=invoice_row.id
    and payment.voided_at is null;
  payment_amount := round(p_amount_cents::numeric / 100, 2);
  remaining := greatest(round(invoice_row.total - authoritative_paid,2),0);
  if payment_amount > remaining then
    update public.square_checkout_attempts set status='Conflict',square_payment_id=p_square_payment_id,completed_at=p_paid_at,conflict_reason='Square completed payment exceeds the current authoritative Invoice balance; manual reconciliation or refund is required.',updated_at=now() where id=p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;

  insert into public.payments (
    invoice_id,client_id,job_id,amount,payment_date,payment_method,reference_number,notes,
    payment_provider,provider_payment_id,provider_order_id
  ) values (
    invoice_row.id,invoice_row.client_id,invoice_row.job_id,payment_amount,
    (p_paid_at at time zone 'UTC')::date,'Credit Card',p_square_payment_id,
    'Verified Square online payment','Square',p_square_payment_id,p_square_order_id
  ) returning * into payment_row;

  select round(coalesce(sum(amount),0),2) into authoritative_paid
  from public.payments payment
  where payment.invoice_id=invoice_row.id
    and payment.voided_at is null;
  update public.invoices set
    amount_paid=authoritative_paid,
    balance_due=greatest(round(total-authoritative_paid,2),0),
    status=case when authoritative_paid>=round(total,2) and total>0 then 'Paid' when authoritative_paid>0 then 'Partially Paid' else 'Open' end,
    paid_at=case when authoritative_paid>=round(total,2) and total>0 then coalesce(paid_at,p_paid_at) else null end
  where id=invoice_row.id;

  update public.square_checkout_attempts set status='Completed',square_payment_id=p_square_payment_id,completed_at=p_paid_at,conflict_reason=null,updated_at=now() where id=p_attempt_id;
  return jsonb_build_object('created', true, 'conflict', false, 'payment_id', payment_row.id);
end;
$$;

create or replace function public.record_square_invoice_payment_v2(
  p_attempt_id uuid,
  p_square_payment_id text,
  p_square_order_id text,
  p_service_amount_cents bigint,
  p_tip_amount_cents bigint,
  p_gross_amount_cents bigint,
  p_currency text,
  p_paid_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.square_checkout_attempts;
  invoice_row public.invoices;
  existing_payment public.payments;
  authoritative_paid numeric;
  service_amount numeric;
  tip_amount numeric;
  gross_amount numeric;
  remaining numeric;
  payment_row public.payments;
begin
  if p_service_amount_cents is null or p_service_amount_cents <= 0
    or p_tip_amount_cents is null or p_tip_amount_cents < 0
    or p_gross_amount_cents is null or p_gross_amount_cents <= 0
    or p_gross_amount_cents <> p_service_amount_cents + p_tip_amount_cents then
    raise exception 'Square Payment amounts are invalid.';
  end if;

  select * into attempt_row
  from public.square_checkout_attempts
  where id = p_attempt_id
  for update;
  if not found then raise exception 'Square checkout attempt not found.'; end if;

  select * into invoice_row
  from public.invoices
  where id = attempt_row.invoice_id
  for update;
  if not found then raise exception 'Invoice not found.'; end if;

  service_amount := round(p_service_amount_cents::numeric / 100, 2);
  tip_amount := round(p_tip_amount_cents::numeric / 100, 2);
  gross_amount := round(p_gross_amount_cents::numeric / 100, 2);

  select * into existing_payment
  from public.payments
  where payment_provider = 'Square'
    and provider_payment_id = p_square_payment_id;
  if found then
    if existing_payment.invoice_id is distinct from invoice_row.id then
      raise exception 'Square Payment is already associated with another Invoice.';
    end if;
    if round(existing_payment.amount, 2) is distinct from service_amount
      or (existing_payment.gross_amount is not null and (
        round(existing_payment.tip_amount, 2) is distinct from tip_amount
        or round(existing_payment.gross_amount, 2) is distinct from gross_amount
      )) then
      raise exception 'Square Payment financial details do not match the existing Payment record.';
    end if;
    return jsonb_build_object('created', false, 'conflict', false, 'payment_id', existing_payment.id);
  end if;

  if attempt_row.square_order_id is distinct from p_square_order_id then
    raise exception 'Square order does not match the checkout attempt.';
  end if;
  if attempt_row.amount_cents is distinct from p_service_amount_cents then
    update public.square_checkout_attempts
    set status = 'Conflict', square_payment_id = p_square_payment_id, completed_at = p_paid_at,
      conflict_reason = 'Square completed service amount does not match the authoritative checkout amount.', updated_at = now()
    where id = p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;
  if attempt_row.currency is distinct from p_currency or p_currency <> 'USD' then
    update public.square_checkout_attempts
    set status = 'Conflict', square_payment_id = p_square_payment_id, completed_at = p_paid_at,
      conflict_reason = 'Square completed payment currency does not match the Invoice currency.', updated_at = now()
    where id = p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;
  if invoice_row.archived_at is not null or invoice_row.status in ('Cancelled', 'Archived') then
    update public.square_checkout_attempts
    set status = 'Conflict', square_payment_id = p_square_payment_id, completed_at = p_paid_at,
      conflict_reason = 'Square completed payment for a cancelled or archived Invoice.', updated_at = now()
    where id = p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;

  select round(coalesce(sum(amount), 0), 2) into authoritative_paid
  from public.payments payment
  where payment.invoice_id = invoice_row.id
    and payment.voided_at is null;
  remaining := greatest(round(invoice_row.total - authoritative_paid, 2), 0);
  if service_amount > remaining then
    update public.square_checkout_attempts
    set status = 'Conflict', square_payment_id = p_square_payment_id, completed_at = p_paid_at,
      conflict_reason = 'Square completed service amount exceeds the current authoritative Invoice balance; manual reconciliation or refund is required.', updated_at = now()
    where id = p_attempt_id;
    return jsonb_build_object('created', false, 'conflict', true);
  end if;

  insert into public.payments (
    invoice_id, client_id, job_id, amount, tip_amount, gross_amount,
    payment_date, payment_method, reference_number, notes,
    payment_provider, provider_payment_id, provider_order_id
  ) values (
    invoice_row.id, invoice_row.client_id, invoice_row.job_id,
    service_amount, tip_amount, gross_amount,
    (p_paid_at at time zone 'UTC')::date, 'Credit Card', p_square_payment_id,
    'Verified Square online payment', 'Square', p_square_payment_id, p_square_order_id
  )
  returning * into payment_row;

  select round(coalesce(sum(amount), 0), 2) into authoritative_paid
  from public.payments payment
  where payment.invoice_id = invoice_row.id
    and payment.voided_at is null;
  update public.invoices
  set amount_paid = authoritative_paid,
    balance_due = greatest(round(total - authoritative_paid, 2), 0),
    status = case
      when authoritative_paid >= round(total, 2) and total > 0 then 'Paid'
      when authoritative_paid > 0 then 'Partially Paid'
      else 'Open'
    end,
    paid_at = case
      when authoritative_paid >= round(total, 2) and total > 0 then coalesce(paid_at, p_paid_at)
      else null
    end
  where id = invoice_row.id;

  update public.square_checkout_attempts
  set status = 'Completed', square_payment_id = p_square_payment_id,
    completed_at = p_paid_at, conflict_reason = null, updated_at = now()
  where id = p_attempt_id;

  return jsonb_build_object('created', true, 'conflict', false, 'payment_id', payment_row.id);
end;
$$;

create or replace function public.get_invoice_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'invoice_number', i.invoice_number, 'status', i.status,
    'issue_date', i.issue_date, 'due_date', i.due_date,
    'client_name', i.client_name, 'property_name', i.property_name,
    'service_name', i.service_name, 'job_number', j.job_number,
    'agreement_number', a.agreement_number,
    'contract_billing_type', i.contract_billing_type,
    'billing_period_start', i.billing_period_start,
    'is_consolidated', i.is_consolidated,
    'job_lines', coalesce((
      select jsonb_agg(to_jsonb(line) - 'invoice_id' order by line.service_date_snapshot, line.job_number_snapshot)
      from public.invoice_job_lines line where line.invoice_id = i.id
    ), '[]'::jsonb),
    'line_items', coalesce(i.line_items, '[]'::jsonb),
    'subtotal', i.subtotal, 'discount', i.discount, 'tax', i.tax,
    'total', i.total, 'amount_paid', i.amount_paid, 'balance_due', i.balance_due,
    'terms', i.terms, 'customer_notes', i.customer_notes,
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
      'amount', p.amount, 'payment_date', p.payment_date, 'payment_method', p.payment_method
    ) order by p.payment_date, p.created_at) from public.payments p
      where p.invoice_id = i.id and p.voided_at is null), '[]'::jsonb),
    'business_name', coalesce(b.business_name, 'StudioScrubz'),
    'tagline', b.tagline, 'business_email', b.business_email,
    'business_phone', b.business_phone, 'website', b.website,
    'address', b.address, 'city', b.city, 'state', b.state, 'zip', b.zip
  )
  from public.invoices i
  left join public.jobs j on j.id = i.job_id
  left join public.service_agreements a on a.id = i.service_agreement_id
  left join lateral (select * from public.business_settings limit 1) b on true
  where p_token is not null and length(p_token) >= 40
    and i.client_access_token = p_token
    and (i.client_access_token_expires_at is null or i.client_access_token_expires_at > now())
  limit 1;
$$;

notify pgrst,'reload schema';
commit;
