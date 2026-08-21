-- StudioScrubz OS Backlog #30: Commercial contract billing.
-- REVIEW ONLY. Run manually in the Supabase SQL editor after review.

alter table public.invoices alter column job_id drop not null;
alter table public.invoices add column if not exists service_agreement_id uuid;
alter table public.invoices add column if not exists contract_billing_type text;
alter table public.invoices add column if not exists billing_period_start date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='invoices_service_agreement_id_fkey' and conrelid='public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_service_agreement_id_fkey foreign key(service_agreement_id) references public.service_agreements(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='invoices_contract_billing_type_check' and conrelid='public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_contract_billing_type_check check(contract_billing_type in ('Monthly','Flat Contract'));
  end if;
  if not exists (select 1 from pg_constraint where conname='invoices_source_check' and conrelid='public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_source_check check((service_agreement_id is null and contract_billing_type is null and billing_period_start is null) or (job_id is null and service_agreement_id is not null and contract_billing_type is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname='invoices_contract_period_check' and conrelid='public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_contract_period_check check((contract_billing_type='Monthly' and billing_period_start is not null and extract(day from billing_period_start)=1) or (contract_billing_type='Flat Contract' and billing_period_start is null) or contract_billing_type is null);
  end if;
end $$;

create index if not exists invoices_service_agreement_id_idx on public.invoices(service_agreement_id);
create unique index if not exists invoices_one_active_monthly_contract_period_idx on public.invoices(service_agreement_id,billing_period_start) where archived_at is null and status not in ('Cancelled','Archived') and contract_billing_type='Monthly';

create or replace function public.validate_contract_invoice_amount() returns trigger language plpgsql security invoker set search_path='' as $$
declare agreement_type text; agreement_division text; contract_amount numeric; prior_total numeric;
begin
  if new.contract_billing_type is null then return new; end if;
  select billing_type,division,billing_amount into agreement_type,agreement_division,contract_amount from public.service_agreements where id=new.service_agreement_id for update;
  if agreement_type is distinct from new.contract_billing_type or agreement_division is distinct from 'Commercial' then raise exception 'Contract invoice source does not match a Commercial agreement'; end if;
  if new.archived_at is not null or new.status in ('Cancelled','Archived') then return new; end if;
  if new.contract_billing_type='Monthly' and round(new.total,2)<>round(contract_amount,2) then raise exception 'Monthly invoice total must equal the agreement monthly contract amount'; end if;
  if new.contract_billing_type='Flat Contract' then
    select coalesce(sum(total),0) into prior_total from public.invoices where service_agreement_id=new.service_agreement_id and contract_billing_type='Flat Contract' and id<>new.id and archived_at is null and status not in ('Cancelled','Archived');
    if round(prior_total+new.total,2)>round(contract_amount,2) then raise exception 'Flat Contract invoices cannot exceed the agreement contract value'; end if;
  end if;
  return new;
end; $$;
revoke all on function public.validate_contract_invoice_amount() from public;
drop trigger if exists invoices_validate_contract_amount on public.invoices;
create trigger invoices_validate_contract_amount before insert or update of service_agreement_id,contract_billing_type,total,status,archived_at on public.invoices for each row execute function public.validate_contract_invoice_amount();

notify pgrst, 'reload schema';
