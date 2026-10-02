-- Lead Representative Portal Phase 3: weekly commission payout accounting.
-- Phase 2 commission qualification and ledger rows remain unchanged.
begin;

create table public.lead_commission_hold_events (
  id uuid primary key default gen_random_uuid(),
  ledger_entry_id uuid not null references public.lead_commission_ledger(id) on delete restrict,
  event_type text not null check (event_type in ('HOLD','RELEASE')),
  reason text not null check (nullif(btrim(reason), '') is not null),
  reference text,
  note text,
  actor_user_id uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default transaction_timestamp()
);
create index lead_commission_hold_events_entry_created_idx
on public.lead_commission_hold_events(ledger_entry_id, created_at desc, id desc);

create table public.lead_commission_payout_adjustments (
  id uuid primary key default gen_random_uuid(),
  lead_representative_id uuid not null references public.employees(id) on delete restrict,
  amount numeric(12,2) not null check (amount <> 0 and amount = round(amount, 2)),
  reason text not null check (nullif(btrim(reason), '') is not null),
  reference text,
  note text,
  effective_at timestamptz not null,
  representative_name_snapshot text not null,
  actor_user_id uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default transaction_timestamp()
);
create index lead_commission_payout_adjustments_rep_effective_idx
on public.lead_commission_payout_adjustments(lead_representative_id, effective_at, id);

create table public.lead_commission_payout_batches (
  id uuid primary key default gen_random_uuid(),
  batch_number text not null unique,
  lead_representative_id uuid not null references public.employees(id) on delete restrict,
  representative_name_snapshot text not null,
  representative_number_snapshot text not null,
  period_start date not null,
  period_end date not null,
  period_start_at timestamptz not null,
  period_end_exclusive_at timestamptz not null,
  business_timezone_snapshot text not null,
  gross_positive_amount numeric(12,2) not null,
  negative_activity_amount numeric(12,2) not null,
  carry_forward_in numeric(12,2) not null,
  accounting_total numeric(12,2) not null,
  payout_amount numeric(12,2) not null check (payout_amount >= 0),
  carry_forward_out numeric(12,2) not null check (carry_forward_out <= 0),
  generated_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  generated_at timestamptz not null default transaction_timestamp(),
  generation_revision integer not null check (generation_revision > 0),
  discarded_at timestamptz,
  discarded_by_user_id uuid references public.user_profiles(id) on delete restrict,
  discard_reason text,
  check (period_end = period_start + 6),
  check (extract(isodow from period_start) = 5 and extract(isodow from period_end) = 4),
  check (period_start_at < period_end_exclusive_at),
  check (accounting_total = round(gross_positive_amount + negative_activity_amount + carry_forward_in, 2)),
  check (payout_amount = greatest(accounting_total, 0)),
  check (carry_forward_out = least(accounting_total, 0)),
  check ((discarded_at is null and discarded_by_user_id is null and discard_reason is null)
    or (discarded_at is not null and discarded_by_user_id is not null and nullif(btrim(discard_reason), '') is not null)),
  unique(lead_representative_id, period_end, generation_revision)
);
create unique index lead_commission_one_active_batch_per_period
on public.lead_commission_payout_batches(lead_representative_id, period_end)
where discarded_at is null;

create table public.lead_commission_payout_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.lead_commission_payout_batches(id) on delete restrict,
  source_type text not null check (source_type in ('COMMISSION_LEDGER','PAYOUT_ADJUSTMENT','NEGATIVE_CARRY_FORWARD')),
  ledger_entry_id uuid references public.lead_commission_ledger(id) on delete restrict,
  adjustment_id uuid references public.lead_commission_payout_adjustments(id) on delete restrict,
  carry_source_batch_id uuid references public.lead_commission_payout_batches(id) on delete restrict,
  amount numeric(12,2) not null check (amount <> 0 and amount = round(amount, 2)),
  effective_at_snapshot timestamptz not null,
  description_snapshot text not null,
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot) = 'object'),
  created_at timestamptz not null default transaction_timestamp(),
  check (
    (source_type = 'COMMISSION_LEDGER' and ledger_entry_id is not null and adjustment_id is null and carry_source_batch_id is null)
    or (source_type = 'PAYOUT_ADJUSTMENT' and ledger_entry_id is null and adjustment_id is not null and carry_source_batch_id is null)
    or (source_type = 'NEGATIVE_CARRY_FORWARD' and ledger_entry_id is null and adjustment_id is null and carry_source_batch_id is not null)
  ),
  unique(batch_id, ledger_entry_id),
  unique(batch_id, adjustment_id),
  unique(batch_id, carry_source_batch_id)
);

create table public.lead_commission_payout_approvals (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique references public.lead_commission_payout_batches(id) on delete restrict,
  approved_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  approved_at timestamptz not null default transaction_timestamp(),
  representative_name_snapshot text not null,
  period_start_snapshot date not null,
  period_end_snapshot date not null,
  gross_positive_amount_snapshot numeric(12,2) not null,
  negative_activity_amount_snapshot numeric(12,2) not null,
  carry_forward_in_snapshot numeric(12,2) not null,
  accounting_total_snapshot numeric(12,2) not null,
  payout_amount_snapshot numeric(12,2) not null,
  carry_forward_out_snapshot numeric(12,2) not null
);

create table public.lead_commission_payout_consumptions (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.lead_commission_payout_approvals(id) on delete restrict,
  payout_item_id uuid not null unique references public.lead_commission_payout_items(id) on delete restrict,
  source_type text not null check (source_type in ('COMMISSION_LEDGER','PAYOUT_ADJUSTMENT','NEGATIVE_CARRY_FORWARD')),
  ledger_entry_id uuid references public.lead_commission_ledger(id) on delete restrict,
  adjustment_id uuid references public.lead_commission_payout_adjustments(id) on delete restrict,
  carry_source_batch_id uuid references public.lead_commission_payout_batches(id) on delete restrict,
  consumed_at timestamptz not null default transaction_timestamp()
);
create unique index lead_commission_ledger_consumed_once
on public.lead_commission_payout_consumptions(ledger_entry_id) where ledger_entry_id is not null;
create unique index lead_commission_adjustment_consumed_once
on public.lead_commission_payout_consumptions(adjustment_id) where adjustment_id is not null;
create unique index lead_commission_carry_consumed_once
on public.lead_commission_payout_consumptions(carry_source_batch_id) where carry_source_batch_id is not null;

create table public.lead_commission_payout_payments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique references public.lead_commission_payout_batches(id) on delete restrict,
  actual_payment_date date not null,
  payment_method text not null check (payment_method in (
    'Apple Pay','Zelle','Venmo','Cash App','Chime','Debit Card','Other'
  )),
  other_method_description text,
  confirmation_reference text,
  note text,
  recorded_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  recorded_at timestamptz not null default transaction_timestamp(),
  check (
    (payment_method = 'Other' and nullif(btrim(other_method_description), '') is not null)
    or (payment_method <> 'Other' and other_method_description is null)
  )
);

alter table public.lead_commission_hold_events enable row level security;
alter table public.lead_commission_payout_adjustments enable row level security;
alter table public.lead_commission_payout_batches enable row level security;
alter table public.lead_commission_payout_items enable row level security;
alter table public.lead_commission_payout_approvals enable row level security;
alter table public.lead_commission_payout_consumptions enable row level security;
alter table public.lead_commission_payout_payments enable row level security;

revoke all on table public.lead_commission_hold_events,
  public.lead_commission_payout_adjustments,
  public.lead_commission_payout_batches,
  public.lead_commission_payout_items,
  public.lead_commission_payout_approvals,
  public.lead_commission_payout_consumptions,
  public.lead_commission_payout_payments
from public, anon, authenticated;
grant select on table public.lead_commission_hold_events,
  public.lead_commission_payout_adjustments,
  public.lead_commission_payout_batches,
  public.lead_commission_payout_items,
  public.lead_commission_payout_approvals,
  public.lead_commission_payout_consumptions,
  public.lead_commission_payout_payments
to service_role;

create function private.reject_lead_commission_payout_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Lead commission payout history is append-only.' using errcode = '55000';
end;
$$;
revoke all on function private.reject_lead_commission_payout_mutation() from public, anon, authenticated;

create function private.protect_lead_commission_payout_batch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Lead commission payout batches cannot be deleted.' using errcode = '55000';
  end if;
  if exists (select 1 from public.lead_commission_payout_approvals approval where approval.batch_id = old.id) then
    raise exception 'Approved payout batches are immutable.' using errcode = '55000';
  end if;
  if old.discarded_at is not null
    or new.id is distinct from old.id
    or new.batch_number is distinct from old.batch_number
    or new.lead_representative_id is distinct from old.lead_representative_id
    or new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end
    or new.period_start_at is distinct from old.period_start_at
    or new.period_end_exclusive_at is distinct from old.period_end_exclusive_at
    or new.business_timezone_snapshot is distinct from old.business_timezone_snapshot
    or new.gross_positive_amount is distinct from old.gross_positive_amount
    or new.negative_activity_amount is distinct from old.negative_activity_amount
    or new.carry_forward_in is distinct from old.carry_forward_in
    or new.accounting_total is distinct from old.accounting_total
    or new.payout_amount is distinct from old.payout_amount
    or new.carry_forward_out is distinct from old.carry_forward_out
    or new.generated_by_user_id is distinct from old.generated_by_user_id
    or new.generated_at is distinct from old.generated_at
    or new.generation_revision is distinct from old.generation_revision
    or new.discarded_at is null
  then
    raise exception 'Only an unapproved generated batch may be discarded.' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_lead_commission_payout_batch() from public, anon, authenticated;

create trigger lead_commission_hold_events_immutable before update or delete on public.lead_commission_hold_events
for each row execute function private.reject_lead_commission_payout_mutation();
create trigger lead_commission_payout_adjustments_immutable before update or delete on public.lead_commission_payout_adjustments
for each row execute function private.reject_lead_commission_payout_mutation();
create trigger lead_commission_payout_items_immutable before update or delete on public.lead_commission_payout_items
for each row execute function private.reject_lead_commission_payout_mutation();
create trigger lead_commission_payout_approvals_immutable before update or delete on public.lead_commission_payout_approvals
for each row execute function private.reject_lead_commission_payout_mutation();
create trigger lead_commission_payout_consumptions_immutable before update or delete on public.lead_commission_payout_consumptions
for each row execute function private.reject_lead_commission_payout_mutation();
create trigger lead_commission_payout_payments_immutable before update or delete on public.lead_commission_payout_payments
for each row execute function private.reject_lead_commission_payout_mutation();
create trigger lead_commission_payout_batches_protected before update or delete on public.lead_commission_payout_batches
for each row execute function private.protect_lead_commission_payout_batch();

create function private.is_lead_commission_payout_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and public.current_user_role() in ('Master Admin','Administrator')
$$;
revoke all on function private.is_lead_commission_payout_admin() from public, anon, authenticated;

create function private.lead_commission_business_timezone()
returns text language plpgsql stable security definer set search_path = '' as $$
declare timezone_name text;
begin
  select nullif(btrim(settings.timezone), '') into timezone_name
  from public.business_settings settings order by settings.id limit 1;
  if timezone_name is null
    or not exists (select 1 from pg_catalog.pg_timezone_names zone where zone.name = timezone_name)
  then
    raise exception 'A valid StudioScrubz business timezone is required.';
  end if;
  return timezone_name;
end;
$$;
revoke all on function private.lead_commission_business_timezone() from public, anon, authenticated;

create function private.lead_commission_entry_is_held(p_ledger_entry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select event.event_type = 'HOLD'
    from public.lead_commission_hold_events event
    where event.ledger_entry_id = p_ledger_entry_id
    order by event.created_at desc, event.id desc limit 1
  ), false)
$$;
revoke all on function private.lead_commission_entry_is_held(uuid) from public, anon, authenticated;

create function public.hold_lead_commission_entry(
  p_ledger_entry_id uuid, p_reason text, p_reference text default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare event_id uuid;
begin
  if not private.is_lead_commission_payout_admin() then raise exception 'Payout hold permission denied.' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'A hold reason is required.'; end if;
  if not exists (select 1 from public.lead_commission_ledger entry where entry.id = p_ledger_entry_id) then raise exception 'Commission ledger entry not found.'; end if;
  if exists (
    select 1 from public.lead_commission_payout_consumptions consumption
    where consumption.ledger_entry_id = p_ledger_entry_id
  ) then raise exception 'A finalized payout entry cannot be held.'; end if;
  if exists (
    select 1 from public.lead_commission_payout_items item
    join public.lead_commission_payout_batches batch on batch.id=item.batch_id
    where item.ledger_entry_id=p_ledger_entry_id and batch.discarded_at is null
  ) then raise exception 'Discard the generated batch before holding this commission entry.'; end if;
  if private.lead_commission_entry_is_held(p_ledger_entry_id) then raise exception 'Commission entry is already held.'; end if;
  insert into public.lead_commission_hold_events(ledger_entry_id,event_type,reason,reference,note,actor_user_id)
  values(p_ledger_entry_id,'HOLD',btrim(p_reason),nullif(btrim(p_reference),''),nullif(btrim(p_note),''),auth.uid())
  returning id into event_id;
  return event_id;
end;
$$;

create function public.release_lead_commission_entry_hold(
  p_ledger_entry_id uuid, p_reason text, p_reference text default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare event_id uuid;
begin
  if not private.is_lead_commission_payout_admin() then raise exception 'Payout hold release permission denied.' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'A release reason is required.'; end if;
  if not private.lead_commission_entry_is_held(p_ledger_entry_id) then raise exception 'Commission entry is not held.'; end if;
  insert into public.lead_commission_hold_events(ledger_entry_id,event_type,reason,reference,note,actor_user_id)
  values(p_ledger_entry_id,'RELEASE',btrim(p_reason),nullif(btrim(p_reference),''),nullif(btrim(p_note),''),auth.uid())
  returning id into event_id;
  return event_id;
end;
$$;

create function public.create_lead_commission_payout_adjustment(
  p_lead_representative_id uuid, p_amount numeric, p_reason text,
  p_effective_at timestamptz default now(), p_reference text default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare adjustment_id uuid; representative_name text;
begin
  if not private.is_lead_commission_payout_admin() then raise exception 'Payout adjustment permission denied.' using errcode = '42501'; end if;
  if p_amount is null or p_amount = 0 or p_amount <> round(p_amount,2) then raise exception 'A non-zero, cent-precision adjustment amount is required.'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'An adjustment reason is required.'; end if;
  select coalesce(nullif(btrim(employee.preferred_name),''),nullif(btrim(concat_ws(' ',employee.first_name,employee.last_name)),''),employee.employee_number)
  into representative_name from public.employees employee where employee.id = p_lead_representative_id
    and (employee.department='Lead Representative' or exists(
      select 1 from public.lead_commission_ledger entry where entry.lead_representative_id=employee.id
    ));
  if representative_name is null then raise exception 'Lead Representative employee not found.'; end if;
  insert into public.lead_commission_payout_adjustments(
    lead_representative_id,amount,reason,reference,note,effective_at,representative_name_snapshot,actor_user_id
  ) values(p_lead_representative_id,round(p_amount,2),btrim(p_reason),nullif(btrim(p_reference),''),
    nullif(btrim(p_note),''),p_effective_at,representative_name,auth.uid()) returning id into adjustment_id;
  return adjustment_id;
end;
$$;

create function public.generate_weekly_lead_commission_payouts(p_period_end date)
returns setof uuid language plpgsql security definer set search_path = '' as $$
declare timezone_name text; period_start_date date; start_at timestamptz; end_exclusive_at timestamptz;
  representative record; batch_id uuid; batch_revision integer; positive_total numeric; negative_total numeric;
  carry_total numeric; accounting_total_value numeric; representative_name text; representative_number text;
begin
  if not private.is_lead_commission_payout_admin() then raise exception 'Weekly payout generation permission denied.' using errcode = '42501'; end if;
  if p_period_end is null or extract(isodow from p_period_end) <> 4 then raise exception 'The payout period must end on Thursday.'; end if;
  timezone_name := private.lead_commission_business_timezone();
  if (transaction_timestamp() at time zone timezone_name)::date <= p_period_end then raise exception 'Only a closed payout period can be generated.'; end if;
  period_start_date := p_period_end - 6;
  start_at := period_start_date::timestamp at time zone timezone_name;
  end_exclusive_at := (p_period_end + 1)::timestamp at time zone timezone_name;
  perform pg_advisory_xact_lock(hashtext('lead-payout-period:' || p_period_end::text));

  for representative in
    with eligible_representatives as (
      select entry.lead_representative_id from public.lead_commission_ledger entry
      where entry.earned_at < end_exclusive_at
        and not private.lead_commission_entry_is_held(entry.id)
        and not exists(select 1 from public.lead_commission_payout_consumptions c where c.ledger_entry_id=entry.id)
        and not exists(select 1 from public.lead_commission_payout_items i join public.lead_commission_payout_batches b on b.id=i.batch_id where i.ledger_entry_id=entry.id and b.discarded_at is null)
      union
      select adjustment.lead_representative_id from public.lead_commission_payout_adjustments adjustment
      where adjustment.effective_at < end_exclusive_at
        and not exists(select 1 from public.lead_commission_payout_consumptions c where c.adjustment_id=adjustment.id)
        and not exists(select 1 from public.lead_commission_payout_items i join public.lead_commission_payout_batches b on b.id=i.batch_id where i.adjustment_id=adjustment.id and b.discarded_at is null)
      union
      select prior.lead_representative_id from public.lead_commission_payout_batches prior
      join public.lead_commission_payout_approvals approval on approval.batch_id=prior.id
      where prior.carry_forward_out < 0
        and not exists(select 1 from public.lead_commission_payout_consumptions c where c.carry_source_batch_id=prior.id)
        and not exists(select 1 from public.lead_commission_payout_items i join public.lead_commission_payout_batches b on b.id=i.batch_id where i.carry_source_batch_id=prior.id and b.discarded_at is null)
    ) select lead_representative_id from eligible_representatives order by lead_representative_id
  loop
    select existing.id into batch_id from public.lead_commission_payout_batches existing
    where existing.lead_representative_id=representative.lead_representative_id and existing.period_end=p_period_end and existing.discarded_at is null;
    if found then return next batch_id; continue; end if;
    select coalesce(sum(entry.commission_amount) filter(where entry.commission_amount>0),0),
      coalesce(sum(entry.commission_amount) filter(where entry.commission_amount<0),0)
    into positive_total,negative_total from public.lead_commission_ledger entry
    where entry.lead_representative_id=representative.lead_representative_id and entry.earned_at<end_exclusive_at
      and not private.lead_commission_entry_is_held(entry.id)
      and not exists(select 1 from public.lead_commission_payout_consumptions c where c.ledger_entry_id=entry.id)
      and not exists(select 1 from public.lead_commission_payout_items i join public.lead_commission_payout_batches b on b.id=i.batch_id where i.ledger_entry_id=entry.id and b.discarded_at is null);
    select positive_total + coalesce(sum(adjustment.amount) filter(where adjustment.amount>0),0),
      negative_total + coalesce(sum(adjustment.amount) filter(where adjustment.amount<0),0)
    into positive_total,negative_total from public.lead_commission_payout_adjustments adjustment
    where adjustment.lead_representative_id=representative.lead_representative_id and adjustment.effective_at<end_exclusive_at
      and not exists(select 1 from public.lead_commission_payout_consumptions c where c.adjustment_id=adjustment.id)
      and not exists(select 1 from public.lead_commission_payout_items i join public.lead_commission_payout_batches b on b.id=i.batch_id where i.adjustment_id=adjustment.id and b.discarded_at is null);
    select coalesce(sum(prior.carry_forward_out),0) into carry_total
    from public.lead_commission_payout_batches prior join public.lead_commission_payout_approvals approval on approval.batch_id=prior.id
    where prior.lead_representative_id=representative.lead_representative_id and prior.carry_forward_out<0
      and not exists(select 1 from public.lead_commission_payout_consumptions c where c.carry_source_batch_id=prior.id)
      and not exists(select 1 from public.lead_commission_payout_items i join public.lead_commission_payout_batches b on b.id=i.batch_id where i.carry_source_batch_id=prior.id and b.discarded_at is null);
    accounting_total_value := round(positive_total + negative_total + carry_total,2);
    select coalesce(nullif(btrim(employee.preferred_name),''),nullif(btrim(concat_ws(' ',employee.first_name,employee.last_name)),''),employee.employee_number), employee.employee_number
    into representative_name,representative_number from public.employees employee where employee.id=representative.lead_representative_id;
    select coalesce(max(existing.generation_revision),0)+1 into batch_revision from public.lead_commission_payout_batches existing
      where existing.lead_representative_id=representative.lead_representative_id and existing.period_end=p_period_end;
    insert into public.lead_commission_payout_batches(
      batch_number,lead_representative_id,representative_name_snapshot,representative_number_snapshot,
      period_start,period_end,period_start_at,period_end_exclusive_at,business_timezone_snapshot,
      gross_positive_amount,negative_activity_amount,carry_forward_in,accounting_total,payout_amount,carry_forward_out,
      generated_by_user_id,generation_revision
    ) values(
      'LRP-'||to_char(p_period_end,'YYYYMMDD')||'-'||upper(substr(replace(representative.lead_representative_id::text,'-',''),1,8))||'-R'||batch_revision,
      representative.lead_representative_id,representative_name,representative_number,period_start_date,p_period_end,start_at,end_exclusive_at,timezone_name,
      round(positive_total,2),round(negative_total,2),round(carry_total,2),accounting_total_value,greatest(accounting_total_value,0),least(accounting_total_value,0),
      auth.uid(),batch_revision
    ) returning id into batch_id;
    insert into public.lead_commission_payout_items(batch_id,source_type,ledger_entry_id,amount,effective_at_snapshot,description_snapshot,source_snapshot)
    select batch_id,'COMMISSION_LEDGER',entry.id,entry.commission_amount,entry.earned_at,
      entry.event_type||' · '||entry.customer_name_snapshot||' · '||entry.job_number_snapshot,
      jsonb_build_object('eventType',entry.event_type,'customerName',entry.customer_name_snapshot,'jobNumber',entry.job_number_snapshot,'serviceName',entry.service_name_snapshot,'policyKey',entry.policy_key,'policyVersion',entry.policy_version)
    from public.lead_commission_ledger entry
    where entry.lead_representative_id=representative.lead_representative_id and entry.earned_at<end_exclusive_at
      and not private.lead_commission_entry_is_held(entry.id)
      and not exists(select 1 from public.lead_commission_payout_consumptions c where c.ledger_entry_id=entry.id)
      and not exists(select 1 from public.lead_commission_payout_items i join public.lead_commission_payout_batches b on b.id=i.batch_id where i.ledger_entry_id=entry.id and b.discarded_at is null);
    insert into public.lead_commission_payout_items(batch_id,source_type,adjustment_id,amount,effective_at_snapshot,description_snapshot,source_snapshot)
    select batch_id,'PAYOUT_ADJUSTMENT',adjustment.id,adjustment.amount,adjustment.effective_at,
      'Payout adjustment · '||adjustment.reason,
      jsonb_build_object('reason',adjustment.reason,'reference',adjustment.reference,'representativeName',adjustment.representative_name_snapshot)
    from public.lead_commission_payout_adjustments adjustment
    where adjustment.lead_representative_id=representative.lead_representative_id and adjustment.effective_at<end_exclusive_at
      and not exists(select 1 from public.lead_commission_payout_consumptions c where c.adjustment_id=adjustment.id)
      and not exists(select 1 from public.lead_commission_payout_items i join public.lead_commission_payout_batches b on b.id=i.batch_id where i.adjustment_id=adjustment.id and b.discarded_at is null);
    insert into public.lead_commission_payout_items(batch_id,source_type,carry_source_batch_id,amount,effective_at_snapshot,description_snapshot,source_snapshot)
    select batch_id,'NEGATIVE_CARRY_FORWARD',prior.id,prior.carry_forward_out,prior.period_end_exclusive_at,
      'Negative carry-forward from '||prior.batch_number,jsonb_build_object('sourceBatchNumber',prior.batch_number,'sourcePeriodEnd',prior.period_end)
    from public.lead_commission_payout_batches prior join public.lead_commission_payout_approvals approval on approval.batch_id=prior.id
    where prior.lead_representative_id=representative.lead_representative_id and prior.carry_forward_out<0
      and not exists(select 1 from public.lead_commission_payout_consumptions c where c.carry_source_batch_id=prior.id)
      and not exists(select 1 from public.lead_commission_payout_items i join public.lead_commission_payout_batches b on b.id=i.batch_id where i.carry_source_batch_id=prior.id and b.discarded_at is null);
    return next batch_id;
  end loop;
end;
$$;

create function public.discard_lead_commission_payout_batch(p_batch_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_lead_commission_payout_admin() then raise exception 'Payout batch discard permission denied.' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A discard reason is required.'; end if;
  if exists(select 1 from public.lead_commission_payout_approvals approval where approval.batch_id=p_batch_id) then raise exception 'Approved payout batches cannot be discarded.'; end if;
  update public.lead_commission_payout_batches set discarded_at=transaction_timestamp(),discarded_by_user_id=auth.uid(),discard_reason=btrim(p_reason)
  where id=p_batch_id and discarded_at is null;
  if not found then raise exception 'Active generated payout batch not found.'; end if;
end;
$$;

create function public.approve_lead_commission_payout_batch(p_batch_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare batch_record public.lead_commission_payout_batches; approval_id uuid;
begin
  if not private.is_lead_commission_payout_admin() then raise exception 'Payout approval permission denied.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext('lead-payout-approve:'||p_batch_id::text));
  select * into batch_record from public.lead_commission_payout_batches where id=p_batch_id for update;
  if not found or batch_record.discarded_at is not null then raise exception 'Active payout batch not found.'; end if;
  select id into approval_id from public.lead_commission_payout_approvals where batch_id=p_batch_id;
  if found then return approval_id; end if;
  if exists(
    select 1 from public.lead_commission_payout_items item
    where item.batch_id=p_batch_id and item.ledger_entry_id is not null
      and private.lead_commission_entry_is_held(item.ledger_entry_id)
  ) then raise exception 'A batch containing a held commission cannot be approved.'; end if;
  insert into public.lead_commission_payout_approvals(
    batch_id,approved_by_user_id,representative_name_snapshot,period_start_snapshot,period_end_snapshot,
    gross_positive_amount_snapshot,negative_activity_amount_snapshot,carry_forward_in_snapshot,
    accounting_total_snapshot,payout_amount_snapshot,carry_forward_out_snapshot
  ) values(batch_record.id,auth.uid(),batch_record.representative_name_snapshot,batch_record.period_start,batch_record.period_end,
    batch_record.gross_positive_amount,batch_record.negative_activity_amount,batch_record.carry_forward_in,
    batch_record.accounting_total,batch_record.payout_amount,batch_record.carry_forward_out) returning id into approval_id;
  insert into public.lead_commission_payout_consumptions(
    approval_id,payout_item_id,source_type,ledger_entry_id,adjustment_id,carry_source_batch_id
  ) select approval_id,item.id,item.source_type,item.ledger_entry_id,item.adjustment_id,item.carry_source_batch_id
    from public.lead_commission_payout_items item where item.batch_id=p_batch_id;
  return approval_id;
end;
$$;

create function public.mark_lead_commission_payout_paid(
  p_batch_id uuid,p_actual_payment_date date,p_payment_method text,
  p_other_method_description text default null,p_confirmation_reference text default null,p_note text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare payment_id uuid; payout_value numeric;
begin
  if not private.is_lead_commission_payout_admin() then raise exception 'Mark Paid permission denied.' using errcode='42501'; end if;
  if p_actual_payment_date is null then raise exception 'Actual payment date is required.'; end if;
  if p_payment_method is null or p_payment_method not in ('Apple Pay','Zelle','Venmo','Cash App','Chime','Debit Card','Other') then raise exception 'Payment method is not allowed.'; end if;
  if p_payment_method='Other' and nullif(btrim(coalesce(p_other_method_description,'')),'') is null then raise exception 'Other payment method requires a description.'; end if;
  if p_payment_method<>'Other' and nullif(btrim(coalesce(p_other_method_description,'')),'') is not null then raise exception 'Other method description is only allowed for Other.'; end if;
  if not exists(select 1 from public.lead_commission_payout_approvals approval where approval.batch_id=p_batch_id) then raise exception 'Only an approved payout batch can be marked paid.'; end if;
  select batch.payout_amount into payout_value from public.lead_commission_payout_batches batch where batch.id=p_batch_id and batch.discarded_at is null;
  if payout_value is null or payout_value<=0 then raise exception 'This accounting batch has no cash payout due.'; end if;
  insert into public.lead_commission_payout_payments(
    batch_id,actual_payment_date,payment_method,other_method_description,confirmation_reference,note,recorded_by_user_id
  ) values(p_batch_id,p_actual_payment_date,p_payment_method,
    case when p_payment_method='Other' then btrim(p_other_method_description) else null end,
    nullif(btrim(p_confirmation_reference),''),nullif(btrim(p_note),''),auth.uid())
  on conflict(batch_id) do nothing returning id into payment_id;
  if payment_id is null then select id into payment_id from public.lead_commission_payout_payments where batch_id=p_batch_id; end if;
  return payment_id;
end;
$$;

create function public.get_my_lead_representative_payouts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare representative_id uuid; timezone_name text; current_period_start date; current_period_start_at timestamptz;
begin
  if auth.uid() is null or not public.is_current_lead_representative_eligible() then raise exception 'Lead Representative payout access denied.' using errcode='42501'; end if;
  representative_id:=public.current_employee_id();
  timezone_name:=private.lead_commission_business_timezone();
  current_period_start:=((transaction_timestamp() at time zone timezone_name)::date - ((extract(isodow from (transaction_timestamp() at time zone timezone_name)::date)::integer-5+7)%7));
  current_period_start_at:=current_period_start::timestamp at time zone timezone_name;
  return jsonb_build_object(
    'businessTimezone',timezone_name,
    'openPeriodStart',current_period_start,
    'openEntries',coalesce((select jsonb_agg(jsonb_build_object(
      'commissionId',entry.id,'customerName',entry.customer_name_snapshot,'commissionType',entry.event_type,
      'jobNumber',entry.job_number_snapshot,'serviceName',entry.service_name_snapshot,'earnedAt',entry.earned_at,
      'amount',entry.commission_amount,'status',case when private.lead_commission_entry_is_held(entry.id) then 'Held' else 'Pending Weekly Payout' end
    ) order by entry.earned_at desc,entry.id desc)
      from public.lead_commission_ledger entry where entry.lead_representative_id=representative_id
        and (entry.earned_at>=current_period_start_at or private.lead_commission_entry_is_held(entry.id))
        and not exists(select 1 from public.lead_commission_payout_consumptions c where c.ledger_entry_id=entry.id)), '[]'::jsonb),
    'batches',coalesce((select jsonb_agg(jsonb_build_object(
      'batchId',batch.id,'batchNumber',batch.batch_number,'periodStart',batch.period_start,'periodEnd',batch.period_end,
      'status',case when payment.id is not null then 'Paid' when approval.id is not null and batch.payout_amount>0 then 'Approved / Awaiting Payment'
        when approval.id is not null then 'Approved / No Payment Due' else 'Awaiting Approval' end,
      'grossPositiveAmount',batch.gross_positive_amount,'negativeActivityAmount',batch.negative_activity_amount,
      'carryForwardIn',batch.carry_forward_in,'accountingTotal',batch.accounting_total,'payoutAmount',batch.payout_amount,
      'carryForwardOut',batch.carry_forward_out,'generatedAt',batch.generated_at,'approvedAt',approval.approved_at,
      'paymentDate',payment.actual_payment_date,'paymentMethod',payment.payment_method,
      'paymentMethodDescription',payment.other_method_description,'confirmationReference',payment.confirmation_reference
    ) order by batch.period_end desc,batch.generation_revision desc)
      from public.lead_commission_payout_batches batch
      left join public.lead_commission_payout_approvals approval on approval.batch_id=batch.id
      left join public.lead_commission_payout_payments payment on payment.batch_id=batch.id
      where batch.lead_representative_id=representative_id and batch.discarded_at is null), '[]'::jsonb)
  );
end;
$$;

create function public.get_lead_commission_payout_management()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_lead_commission_payout_admin() then raise exception 'Payout management access denied.' using errcode='42501'; end if;
  return jsonb_build_object(
    'businessTimezone',private.lead_commission_business_timezone(),
    'ledgerEntries',coalesce((select jsonb_agg(jsonb_build_object(
      'commissionId',entry.id,'leadRepresentativeId',entry.lead_representative_id,'representativeName',coalesce(nullif(btrim(employee.preferred_name),''),nullif(btrim(concat_ws(' ',employee.first_name,employee.last_name)),''),employee.employee_number),
      'customerName',entry.customer_name_snapshot,'eventType',entry.event_type,'earnedAt',entry.earned_at,'amount',entry.commission_amount,
      'held',private.lead_commission_entry_is_held(entry.id),'consumed',exists(select 1 from public.lead_commission_payout_consumptions c where c.ledger_entry_id=entry.id)
    ) order by entry.earned_at desc,entry.id desc) from public.lead_commission_ledger entry join public.employees employee on employee.id=entry.lead_representative_id),'[]'::jsonb),
    'representatives',coalesce((select jsonb_agg(jsonb_build_object('employeeId',employee.id,'displayName',coalesce(nullif(btrim(employee.preferred_name),''),nullif(btrim(concat_ws(' ',employee.first_name,employee.last_name)),''),employee.employee_number)) order by employee.first_name,employee.last_name)
      from public.employees employee where employee.department='Lead Representative' and employee.archived_at is null),'[]'::jsonb),
    'batches',coalesce((select jsonb_agg(jsonb_build_object(
      'batchId',batch.id,'batchNumber',batch.batch_number,'leadRepresentativeId',batch.lead_representative_id,'representativeName',batch.representative_name_snapshot,
      'periodStart',batch.period_start,'periodEnd',batch.period_end,'status',case when batch.discarded_at is not null then 'Discarded' when payment.id is not null then 'Paid'
        when approval.id is not null and batch.payout_amount>0 then 'Approved / Awaiting Payment' when approval.id is not null then 'Approved / No Payment Due' else 'Awaiting Approval' end,
      'grossPositiveAmount',batch.gross_positive_amount,'negativeActivityAmount',batch.negative_activity_amount,'carryForwardIn',batch.carry_forward_in,
      'accountingTotal',batch.accounting_total,'payoutAmount',batch.payout_amount,'carryForwardOut',batch.carry_forward_out,
      'generatedAt',batch.generated_at,'approvedAt',approval.approved_at,'paymentDate',payment.actual_payment_date,'paymentMethod',payment.payment_method,
      'paymentMethodDescription',payment.other_method_description,'confirmationReference',payment.confirmation_reference,
      'items',coalesce((select jsonb_agg(jsonb_build_object('itemId',item.id,'sourceType',item.source_type,'amount',item.amount,'effectiveAt',item.effective_at_snapshot,'description',item.description_snapshot) order by item.effective_at_snapshot,item.id) from public.lead_commission_payout_items item where item.batch_id=batch.id),'[]'::jsonb)
    ) order by batch.period_end desc,batch.generated_at desc) from public.lead_commission_payout_batches batch
      left join public.lead_commission_payout_approvals approval on approval.batch_id=batch.id
      left join public.lead_commission_payout_payments payment on payment.batch_id=batch.id),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.hold_lead_commission_entry(uuid,text,text,text),
  public.release_lead_commission_entry_hold(uuid,text,text,text),
  public.create_lead_commission_payout_adjustment(uuid,numeric,text,timestamptz,text,text),
  public.generate_weekly_lead_commission_payouts(date),
  public.discard_lead_commission_payout_batch(uuid,text),
  public.approve_lead_commission_payout_batch(uuid),
  public.mark_lead_commission_payout_paid(uuid,date,text,text,text,text),
  public.get_my_lead_representative_payouts(),
  public.get_lead_commission_payout_management()
from public, anon, authenticated;
grant execute on function public.hold_lead_commission_entry(uuid,text,text,text),
  public.release_lead_commission_entry_hold(uuid,text,text,text),
  public.create_lead_commission_payout_adjustment(uuid,numeric,text,timestamptz,text,text),
  public.generate_weekly_lead_commission_payouts(date),
  public.discard_lead_commission_payout_batch(uuid,text),
  public.approve_lead_commission_payout_batch(uuid),
  public.mark_lead_commission_payout_paid(uuid,date,text,text,text,text),
  public.get_my_lead_representative_payouts(),
  public.get_lead_commission_payout_management()
to authenticated;

notify pgrst, 'reload schema';
commit;
