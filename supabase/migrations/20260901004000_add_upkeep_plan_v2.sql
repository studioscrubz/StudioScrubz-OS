-- StudioScrubz Upkeep Plan V2. Review and apply through the normal migration workflow.
begin;

alter table public.business_settings
  add column if not exists upkeep_adjustment_percent numeric not null default 30
  check (upkeep_adjustment_percent between 0 and 40);

alter table public.service_agreements
  add column if not exists third_day_of_month integer,
  add constraint service_agreements_third_day_of_month_check
    check (third_day_of_month between 1 and 28),
  drop constraint if exists service_agreements_twice_monthly_schedule_check,
  add constraint service_agreements_twice_monthly_schedule_check
    check (
      (
        frequency = 'Twice Monthly'
        and day_of_month is not null
        and second_day_of_month is not null
        and day_of_month between 1 and 28
        and second_day_of_month between 1 and 28
        and day_of_month <> second_day_of_month
        and third_day_of_month is null
      )
      or (
        service_name = 'StudioScrubz Upkeep Plan'
        and frequency = 'Monthly'
        and day_of_month is not null
        and second_day_of_month is not null
        and third_day_of_month is not null
        and day_of_month between 1 and 28
        and second_day_of_month between 1 and 28
        and third_day_of_month between 1 and 28
        and day_of_month <> second_day_of_month
        and day_of_month <> third_day_of_month
        and second_day_of_month <> third_day_of_month
      )
      or (
        frequency <> 'Twice Monthly'
        and service_name <> 'StudioScrubz Upkeep Plan'
        and second_day_of_month is null
        and third_day_of_month is null
      )
    ),
  add constraint service_agreements_upkeep_plan_schedule_check
    check (
      (
        service_name = 'StudioScrubz Upkeep Plan'
        and frequency = 'Monthly'
        and billing_type = 'Monthly'
        and day_of_month is not null
        and second_day_of_month is not null
        and third_day_of_month is not null
        and day_of_month between 1 and 28
        and second_day_of_month between 1 and 28
        and third_day_of_month between 1 and 28
        and day_of_month <> second_day_of_month
        and day_of_month <> third_day_of_month
        and second_day_of_month <> third_day_of_month
      )
      or (
        service_name <> 'StudioScrubz Upkeep Plan'
        and third_day_of_month is null
      )
    ) not valid;

create or replace function public.prevent_signed_upkeep_schedule_changes()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if old.client_signed_at is not null
    and new.third_day_of_month is distinct from old.third_day_of_month then
    raise exception 'A signed Service Agreement cannot be materially changed. Cancel it and create a new agreement for revised terms.';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_signed_upkeep_schedule_changes() from public, anon, authenticated;
drop trigger if exists prevent_signed_upkeep_schedule_changes on public.service_agreements;
create trigger prevent_signed_upkeep_schedule_changes
before update on public.service_agreements
for each row execute function public.prevent_signed_upkeep_schedule_changes();

create or replace function public.get_service_agreement_by_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'This agreement link is invalid, expired, or no longer available.'; end if;
  select case when a.client_signed_snapshot is not null then
    a.client_signed_snapshot || jsonb_build_object(
      'status',a.status,
      'service_description',coalesce(nullif(a.client_signed_snapshot->>'service_description',''),nullif(a.pricing_snapshot->>'service_description',''),''),
      'client_signed_at',a.client_signed_at,'client_signed_name',a.client_signed_name,
      'client_signature',a.client_signature,'client_consent_text',a.client_consent_text,'client_consent_at',a.client_consent_at)
  else jsonb_build_object(
    'agreement_number',a.agreement_number,'status',a.status,
    'client_name',coalesce(c.company_name,nullif(concat_ws(' ',c.first_name,c.last_name),''),'Client'),
    'property_location',coalesce(p.property_name,p.address,'Service location'),
    'service_name',a.service_name,'service_description',coalesce(nullif(a.pricing_snapshot->>'service_description',''),''),
    'scope',coalesce((select string_agg(item.value->>'text',E'\n') from jsonb_array_elements(a.scope) item),''),
    'frequency',a.frequency,'days_of_week',a.days_of_week,'day_of_month',a.day_of_month,
    'second_day_of_month',a.second_day_of_month,'third_day_of_month',a.third_day_of_month,'custom_interval_days',a.custom_interval_days,
    'default_start_time',a.default_start_time,'start_date',a.start_date,'end_date',a.end_date,
    'billing_type',a.billing_type,'billing_amount',a.billing_amount,'pricing_snapshot',a.pricing_snapshot,
    'payment_terms',a.payment_terms,'agreement_terms',a.agreement_terms,'cancellation_terms',a.cancellation_terms,
    'special_instructions',a.special_instructions,'client_signed_at',null,'client_signed_name',null,
    'client_signature',null,'client_consent_text',null,'client_consent_at',null,
    'business_name',coalesce(bs.business_name,'StudioScrubz'),'tagline',bs.tagline,
    'business_email',bs.business_email,'business_phone',bs.business_phone,'website',bs.website,
    'address',bs.address,'city',bs.city,'state',bs.state,'zip',bs.zip)
  end into v_result
  from public.service_agreements a
  left join public.clients c on c.id=a.client_id
  left join public.properties p on p.id=a.property_id
  left join public.business_settings bs on true
  where a.client_access_token=p_token and a.archived_at is null
    and a.status in ('Sent','Accepted','Active','Paused')
    and (a.client_access_token_expires_at is null or a.client_access_token_expires_at>now())
  limit 1;
  if v_result is null then raise exception 'This agreement link is invalid, expired, or no longer available.'; end if;
  return v_result;
end;
$$;

create or replace function public.accept_service_agreement_by_token(p_token text,p_signed_name text,p_signature text,p_consent boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_name text:=btrim(coalesce(p_signed_name,''));
  v_signature text:=btrim(coalesce(p_signature,''));
  v_consent_text constant text:='I have reviewed and agree to the terms of this Service Agreement.';
  v_snapshot jsonb;
begin
  if p_token is null or length(p_token)<32 then raise exception 'This agreement link is invalid, expired, or no longer available.'; end if;
  if p_consent is distinct from true then raise exception 'Explicit consent is required to sign this Service Agreement.'; end if;
  if length(v_name)<2 or length(v_name)>150 then raise exception 'Enter a valid full legal name.'; end if;
  if v_signature<>('/s/ '||v_name) then raise exception 'The typed signature is invalid.'; end if;
  select jsonb_build_object(
    'agreement_number',a.agreement_number,
    'client_name',coalesce(c.company_name,nullif(concat_ws(' ',c.first_name,c.last_name),''),'Client'),
    'property_location',coalesce(p.property_name,p.address,'Service location'),
    'service_name',a.service_name,'service_description',coalesce(nullif(a.pricing_snapshot->>'service_description',''),''),
    'scope',coalesce((select string_agg(item.value->>'text',E'\n') from jsonb_array_elements(a.scope) item),''),
    'frequency',a.frequency,'days_of_week',a.days_of_week,'day_of_month',a.day_of_month,
    'second_day_of_month',a.second_day_of_month,'third_day_of_month',a.third_day_of_month,'custom_interval_days',a.custom_interval_days,
    'default_start_time',a.default_start_time,'start_date',a.start_date,'end_date',a.end_date,
    'billing_type',a.billing_type,'billing_amount',a.billing_amount,'pricing_snapshot',a.pricing_snapshot,
    'payment_terms',a.payment_terms,'agreement_terms',a.agreement_terms,'cancellation_terms',a.cancellation_terms,
    'special_instructions',a.special_instructions,'business_name',coalesce(bs.business_name,'StudioScrubz'),
    'tagline',bs.tagline,'business_email',bs.business_email,'business_phone',bs.business_phone,
    'website',bs.website,'address',bs.address,'city',bs.city,'state',bs.state,'zip',bs.zip)
  into v_snapshot
  from public.service_agreements a
  left join public.clients c on c.id=a.client_id
  left join public.properties p on p.id=a.property_id
  left join public.business_settings bs on true
  where a.client_access_token=p_token and a.archived_at is null and a.status='Sent'
    and a.client_signed_at is null
    and (a.client_access_token_expires_at is null or a.client_access_token_expires_at>now())
  limit 1 for update of a;
  if v_snapshot is null then raise exception 'This agreement cannot be signed because it is invalid, expired, revoked, already signed, or no longer awaiting acceptance.'; end if;
  update public.service_agreements set client_signed_name=v_name,client_signature=v_signature,
    client_signed_at=now(),accepted_at=now(),client_consent_text=v_consent_text,
    client_consent_at=now(),client_signed_snapshot=v_snapshot,status='Accepted'
  where client_access_token=p_token and archived_at is null and status='Sent' and client_signed_at is null;
  return public.get_service_agreement_by_token(p_token);
end;
$$;

revoke all on function public.get_service_agreement_by_token(text) from public,anon,authenticated;
revoke all on function public.accept_service_agreement_by_token(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.get_service_agreement_by_token(text) to anon,authenticated;
grant execute on function public.accept_service_agreement_by_token(text,text,text,boolean) to anon,authenticated;

create or replace view public.business_settings_workflow
with (security_barrier = true) as
select
  id, business_name, tagline, business_email, business_phone, website, address, city, state, zip,
  default_tax_rate, default_estimate_expiration_days, default_proposal_expiration_days,
  default_invoice_due_days, default_payment_terms, default_invoice_terms, default_proposal_terms,
  default_estimate_notes, currency, timezone, created_at, updated_at, default_service_agreement_terms,
  default_estimate_terms, default_cancellation_terms, upkeep_adjustment_percent
from public.business_settings
where (select auth.uid()) is not null
  and public.has_any_role(array['Master Admin','Administrator','Manager','Sales']);

revoke all on public.business_settings_workflow from public, anon, authenticated;
grant select on public.business_settings_workflow to authenticated;

insert into public.services(
  service_code, service_name, division, category, description, pricing_model,
  pricing_config, base_price, minimum_price, is_recurring_available, display_order
) values (
  'RES-UPKEEP-PLAN', 'StudioScrubz Upkeep Plan', 'Residential', 'Light Maintenance Cleaning',
  '3 Light Maintenance Visits per Month. Standard Cleaning is used only as the pricing baseline.',
  'Flat Rate', '{}'::jsonb, 0, 0, false, 15
) on conflict (service_code) do nothing;

notify pgrst, 'reload schema';
commit;
