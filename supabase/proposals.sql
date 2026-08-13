-- Review in Supabase SQL Editor. Intentionally not executed automatically.
create extension if not exists pgcrypto;
create table if not exists public.proposals (
 id uuid primary key default gen_random_uuid(), proposal_number text not null unique,
 client_id uuid not null references public.clients(id) on delete restrict,
 property_id uuid not null references public.properties(id) on delete restrict,
 estimate_id uuid references public.estimates(id) on delete restrict,
 walkthrough_id uuid references public.walkthroughs(id) on delete restrict,
 division text not null check (division in ('Residential','Commercial')), client_name text, property_name text,
 customer_phone text, customer_email text, frequency text not null default 'One-Time', requested_date date,
 representative_name text, notes text, result jsonb not null default '{}'::jsonb, photos jsonb not null default '[]'::jsonb,
 signature text, status text not null default 'Draft' check (status in ('Draft','Ready for Approval','Approved','Sent','Viewed','Accepted','Declined','Expired','Archived')),
 approval_status text not null default 'Not Submitted' check (approval_status in ('Not Submitted','Pending Approval','Approved','Changes Requested','Rejected')),
 approved_at timestamptz, approved_by text, approval_notes text, sent_at timestamptz, sent_via text, viewed_at timestamptz,
 accepted boolean not null default false, accepted_at timestamptz, accepted_by_name text, acceptance_method text,
 declined_at timestamptz, decline_reason text, expiration_date date not null default (current_date + 30), expired_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create index if not exists proposals_client_id_idx on public.proposals(client_id); create index if not exists proposals_property_id_idx on public.proposals(property_id);
create index if not exists proposals_estimate_id_idx on public.proposals(estimate_id); create index if not exists proposals_walkthrough_id_idx on public.proposals(walkthrough_id);
create index if not exists proposals_status_idx on public.proposals(status); create index if not exists proposals_approval_status_idx on public.proposals(approval_status);
create index if not exists proposals_expiration_date_idx on public.proposals(expiration_date); create index if not exists proposals_created_at_idx on public.proposals(created_at desc); create index if not exists proposals_archived_at_idx on public.proposals(archived_at);
create unique index if not exists proposals_one_active_per_estimate_idx on public.proposals(estimate_id) where estimate_id is not null and archived_at is null;
create unique index if not exists proposals_one_active_per_walkthrough_idx on public.proposals(walkthrough_id) where walkthrough_id is not null and archived_at is null;
create or replace function public.set_proposals_updated_at() returns trigger language plpgsql security invoker set search_path='' as $$ begin new.updated_at=now(); return new; end; $$;
revoke all on function public.set_proposals_updated_at() from public; drop trigger if exists proposals_set_updated_at on public.proposals; create trigger proposals_set_updated_at before update on public.proposals for each row execute function public.set_proposals_updated_at();
alter table public.proposals enable row level security; grant select,insert,update on public.proposals to anon,authenticated;
create policy "Temporary proposal read" on public.proposals for select to anon,authenticated using(true); create policy "Temporary proposal create" on public.proposals for insert to anon,authenticated with check(true); create policy "Temporary proposal update" on public.proposals for update to anon,authenticated using(true) with check(true);

create table if not exists public.proposal_history (id uuid primary key default gen_random_uuid(), proposal_id uuid not null references public.proposals(id) on delete cascade, event_type text not null, previous_status text, new_status text, description text, metadata jsonb not null default '{}'::jsonb, performed_by text not null default 'Master Admin', created_at timestamptz not null default now());
create index if not exists proposal_history_proposal_id_idx on public.proposal_history(proposal_id); create index if not exists proposal_history_created_at_idx on public.proposal_history(created_at desc);
alter table public.proposal_history enable row level security; grant select,insert on public.proposal_history to anon,authenticated;
create policy "Temporary proposal history read" on public.proposal_history for select to anon,authenticated using(true); create policy "Temporary proposal history append" on public.proposal_history for insert to anon,authenticated with check(true);
