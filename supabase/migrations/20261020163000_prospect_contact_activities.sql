begin;
create table public.prospect_contact_activities (
 id uuid primary key default gen_random_uuid(),
 prospect_id uuid not null references public.prospects(id) on delete restrict,
 activity_type text not null check (activity_type in ('Call','Email','Text','Meeting','Other')),
 outcome text not null check (length(btrim(outcome)) between 1 and 2000),
 actor_user_id uuid not null default auth.uid() references public.user_profiles(id),
 created_at timestamptz not null default now()
);
create index prospect_contact_activities_recent on public.prospect_contact_activities(prospect_id,created_at desc);
alter table public.prospect_contact_activities enable row level security;
create policy "Authorized prospect contact activity read" on public.prospect_contact_activities for select to authenticated using (
 exists(select 1 from public.prospects p where p.id=prospect_id)
);
create policy "Authorized prospect contact activity create" on public.prospect_contact_activities for insert to authenticated with check (
 actor_user_id=(select auth.uid()) and exists(select 1 from public.prospects p where p.id=prospect_id)
);
revoke all on public.prospect_contact_activities from public,anon,authenticated;
grant select,insert on public.prospect_contact_activities to authenticated;
notify pgrst,'reload schema';
commit;
