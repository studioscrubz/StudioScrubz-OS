-- Keep historical shared messages separate so their recipients are never guessed.
create table public.contractor_private_messages (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.contractor_companies(id) on delete restrict,
 opportunity_id uuid references public.contractor_opportunities(id) on delete restrict,
 partner_user_id uuid not null references auth.users(id),
 manager_user_id uuid not null references public.user_profiles(id),
 sender_side text not null check (sender_side in ('StudioScrubz','Contractor')),
 body text not null check (length(btrim(body)) between 1 and 10000),
 created_at timestamptz not null default now(),
 read_at timestamptz,
 check (partner_user_id <> manager_user_id)
);
create index contractor_private_messages_partner_idx
 on public.contractor_private_messages(partner_user_id,company_id,manager_user_id,created_at desc);
create index contractor_private_messages_manager_idx
 on public.contractor_private_messages(manager_user_id,company_id,created_at desc);

alter table public.contractor_private_messages enable row level security;
revoke all on public.contractor_private_messages from public,anon,authenticated;
grant select,insert,update on public.contractor_private_messages to service_role;

-- Retain historical records for audit without exposing shared threads to browser roles.
revoke select on public.contractor_messages,public.contractor_message_reads from public,anon,authenticated;
