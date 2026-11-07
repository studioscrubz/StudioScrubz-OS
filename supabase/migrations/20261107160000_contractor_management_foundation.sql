-- Contractor management isolation layer. NOT for production until explicitly approved.
-- Partner auth users have NO user_profiles employee record and NO direct access to
-- jobs, invoices, profitability, contractor companies, or contractor private records.
begin;

create table public.contractor_companies (
 id uuid primary key default gen_random_uuid(),
 contractor_code text not null unique default ('CTR-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
 name text not null check(length(btrim(name)) between 2 and 200),
 contact_name text not null default '',
 contact_email text not null,
 phone text,
 business_address text,
 territories text[] not null default '{}',
 service_types text[] not null default '{}',
 proposed_rates jsonb not null default '{}'::jsonb,
 negotiated_rates jsonb not null default '{}'::jsonb,
 payment_terms text,
 assigned_manager_id uuid references public.user_profiles(id) on delete set null,
 client_id uuid unique references public.clients(id) on delete set null,
 status text not null default 'Pending' check(status in ('Active','Pending','Suspended','Archived')),
 internal_notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index contractor_companies_manager_idx on public.contractor_companies(assigned_manager_id);
create table public.contractor_members (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.contractor_companies(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 email text not null,
 member_role text not null default 'Member' check(member_role in ('Company Admin','Member')),
 is_active boolean not null default true,
 joined_at timestamptz not null default now(),
 unique(company_id,user_id),
 unique(user_id)
);
create index contractor_members_user_idx on public.contractor_members(user_id) where is_active;
create table public.contractor_invitations (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.contractor_companies(id) on delete restrict,
 invited_email text not null,
 member_role text not null default 'Member' check(member_role in ('Company Admin','Member')),
 token_hash text not null unique check(length(token_hash)=64),
 expires_at timestamptz not null default (now() + interval '7 days'),
 status text not null default 'Pending' check(status in ('Pending','Redeemed','Revoked','Expired')),
 delivery_status text not null default 'Prepared' check(delivery_status in ('Prepared','Sent','Failed')),
 delivery_provider_id text,
 invited_by uuid not null references public.user_profiles(id),
 redeemed_by uuid references auth.users(id),
 redeemed_at timestamptz,
 created_at timestamptz not null default now(),
 constraint contractor_invitation_seven_days check(expires_at<=created_at+interval '7 days' and expires_at>created_at)
);
create index contractor_invitations_company_idx on public.contractor_invitations(company_id,created_at desc);
create table public.contractor_opportunities (
 id uuid primary key default gen_random_uuid(),
 opportunity_number text not null unique default ('OPP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 company_id uuid not null references public.contractor_companies(id) on delete restrict,
 manager_id uuid references public.user_profiles(id) on delete set null,
 submitted_by uuid references auth.users(id),
 external_reference text,
 service_type text not null check(length(btrim(service_type))>1),
 property_address text not null check(length(btrim(property_address))>7),
 property_type text not null check(property_type in ('Residential','Commercial')),
 square_feet numeric check(square_feet>=0),
 bedrooms numeric check(bedrooms>=0),
 bathrooms numeric check(bathrooms>=0),
 scope_of_work text not null check(length(btrim(scope_of_work))>=10),
 property_condition text,
 requested_date date not null,
 requested_time time,
 estimated_person_hours numeric not null check(estimated_person_hours>0 and estimated_person_hours<=10000),
 cleaner_count integer not null default 1 check(cleaner_count between 1 and 100),
 proposed_amount numeric not null check(proposed_amount>=0),
 pricing_basis text not null default 'Flat Price',
 special_instructions text,
 access_arrangements text,
 status text not null default 'New Opportunity' check(status in (
 'New Opportunity','Information Requested','Negotiating','Awaiting Approval',
 'Accepted','Declined','Crew Assignment','Scheduled','In Progress',
 'Pending Quality Review','Completed','Invoiced','Paid','Cancelled','Disputed'
 )),
 final_scope text,
 agreed_amount numeric check(agreed_amount>=0),
 partner_confirmed_at timestamptz,
 internal_confirmed_at timestamptz,
 decision_reason text,
 decided_by uuid references public.user_profiles(id),
 decided_at timestamptz,
 linked_job_id uuid unique references public.jobs(id) on delete restrict,
 cancelled_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(company_id,external_reference)
);
create index contractor_opps_company_status_idx on public.contractor_opportunities(company_id,status,created_at desc);
create index contractor_opps_manager_idx on public.contractor_opportunities(manager_id,status);
create table public.contractor_offers (
 id uuid primary key default gen_random_uuid(),
 opportunity_id uuid not null references public.contractor_opportunities(id) on delete restrict,
 company_id uuid not null references public.contractor_companies(id) on delete restrict,
 offered_by uuid not null references auth.users(id),
 offered_by_side text not null check(offered_by_side in ('StudioScrubz','Contractor')),
 amount numeric not null check(amount>=0),
 pricing_basis text not null,
 scope_text text not null,
 message text,
 created_at timestamptz not null default now()
);
create index contractor_offers_opportunity_idx on public.contractor_offers(opportunity_id,created_at desc);
create table public.contractor_messages (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.contractor_companies(id) on delete restrict,
 opportunity_id uuid references public.contractor_opportunities(id) on delete restrict,
 sender_id uuid not null references auth.users(id),
 sender_side text not null check(sender_side in ('StudioScrubz','Contractor')),
 body text not null check(length(btrim(body)) between 1 and 10000),
 created_at timestamptz not null default now()
);
create index contractor_messages_company_idx on public.contractor_messages(company_id,created_at desc);
create table public.contractor_profitability (
 opportunity_id uuid primary key references public.contractor_opportunities(id) on delete restrict,
 assessed_by uuid not null references public.user_profiles(id),
 projection jsonb not null,
 minimum_price numeric,
 projected_margin numeric,
 cost_complete boolean not null default false,
 override_approved_by uuid references public.user_profiles(id),
 override_reason text,
 override_at timestamptz,
 updated_at timestamptz not null default now()
);
create table public.contractor_audit_events (
 id uuid primary key default gen_random_uuid(),
 company_id uuid references public.contractor_companies(id) on delete restrict,
 opportunity_id uuid references public.contractor_opportunities(id) on delete restrict,
 actor_id uuid references auth.users(id),
 event_type text not null,
 detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index contractor_audit_company_idx on public.contractor_audit_events(company_id,created_at desc);
create table public.contractor_documents (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.contractor_companies(id) on delete restrict,
 opportunity_id uuid references public.contractor_opportunities(id) on delete restrict,
 uploaded_by uuid not null references auth.users(id),
 storage_path text not null unique,
 file_name text not null,
 mime_type text not null,
 file_size bigint not null check(file_size>0 and file_size<=15728640),
 category text not null check(category in ('Scope','Photo','Insurance','Tax','Agreement','Other')),
 created_at timestamptz not null default now()
);

-- Every table is protected. Partner reads use server-side allowlisted projections
-- rather than broad table grants that could leak internal notes or finances.
alter table public.contractor_companies enable row level security;
alter table public.contractor_members enable row level security;
alter table public.contractor_invitations enable row level security;
alter table public.contractor_opportunities enable row level security;
alter table public.contractor_offers enable row level security;
alter table public.contractor_messages enable row level security;
alter table public.contractor_profitability enable row level security;
alter table public.contractor_audit_events enable row level security;
alter table public.contractor_documents enable row level security;

create or replace function private.contractor_is_internal()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p
 where p.id=(select auth.uid()) and p.is_active
 and p.role in ('Master Admin','Manager'))
$$;
revoke all on function private.contractor_is_internal() from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.contractor_is_internal() to authenticated;

create policy contractor_companies_internal_select on public.contractor_companies for select to authenticated
 using ((select private.contractor_is_internal()));
create policy contractor_companies_internal_insert on public.contractor_companies for insert to authenticated
 with check ((select private.contractor_is_internal()));
create policy contractor_companies_internal_update on public.contractor_companies for update to authenticated
 using ((select private.contractor_is_internal())) with check ((select private.contractor_is_internal()));
create policy contractor_members_internal_select on public.contractor_members for select to authenticated
 using ((select private.contractor_is_internal()) or user_id=(select auth.uid()));
create policy contractor_members_internal_write on public.contractor_members for insert to authenticated
 with check ((select private.contractor_is_internal()));
-- External members cannot UPDATE their own authorization or company association.
create policy contractor_members_internal_update on public.contractor_members for update to authenticated
 using ((select private.contractor_is_internal())) with check ((select private.contractor_is_internal()));

create policy contractor_invitations_internal_select on public.contractor_invitations for select to authenticated
 using ((select private.contractor_is_internal()));
create policy contractor_invitations_internal_insert on public.contractor_invitations for insert to authenticated
 with check ((select private.contractor_is_internal()));
create policy contractor_invitations_internal_update on public.contractor_invitations for update to authenticated
 using ((select private.contractor_is_internal())) with check ((select private.contractor_is_internal()));

create policy contractor_opportunities_internal_select on public.contractor_opportunities for select to authenticated
 using ((select private.contractor_is_internal()));
create policy contractor_opportunities_internal_insert on public.contractor_opportunities for insert to authenticated
 with check ((select private.contractor_is_internal()));
create policy contractor_opportunities_internal_update on public.contractor_opportunities for update to authenticated
 using ((select private.contractor_is_internal())) with check ((select private.contractor_is_internal()));
create policy contractor_offers_internal_select on public.contractor_offers for select to authenticated
 using ((select private.contractor_is_internal()));
create policy contractor_offers_internal_insert on public.contractor_offers for insert to authenticated
 with check ((select private.contractor_is_internal()));
create policy contractor_messages_internal_select on public.contractor_messages for select to authenticated
 using ((select private.contractor_is_internal()));
create policy contractor_messages_internal_insert on public.contractor_messages for insert to authenticated
 with check ((select private.contractor_is_internal()));
create policy contractor_profitability_internal_select on public.contractor_profitability for select to authenticated
 using ((select private.contractor_is_internal()));
create policy contractor_profitability_internal_write on public.contractor_profitability for insert to authenticated
 with check ((select private.contractor_is_internal()));
create policy contractor_profitability_internal_update on public.contractor_profitability for update to authenticated
 using ((select private.contractor_is_internal())) with check ((select private.contractor_is_internal()));
create policy contractor_audit_internal_select on public.contractor_audit_events for select to authenticated
 using ((select private.contractor_is_internal()));
create policy contractor_audit_internal_insert on public.contractor_audit_events for insert to authenticated
 with check ((select private.contractor_is_internal()));
create policy contractor_documents_internal_select on public.contractor_documents for select to authenticated
 using ((select private.contractor_is_internal()));
create policy contractor_documents_internal_insert on public.contractor_documents for insert to authenticated
 with check ((select private.contractor_is_internal()));

grant select,insert,update on public.contractor_companies to authenticated;
grant select,insert,update on public.contractor_members to authenticated;
grant select,insert,update on public.contractor_invitations to authenticated;
grant select,insert,update on public.contractor_opportunities to authenticated;
grant select,insert on public.contractor_offers,public.contractor_messages,
public.contractor_audit_events,public.contractor_documents to authenticated;
grant select,insert,update on public.contractor_profitability to authenticated;


commit;
