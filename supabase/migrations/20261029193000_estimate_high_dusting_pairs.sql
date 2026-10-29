-- Pair two independently priced estimates without sharing amounts or approval.
create table if not exists public.estimate_service_pairs (
 id uuid primary key default gen_random_uuid(),
 estimate_a_id uuid not null references public.estimates(id) on delete cascade,
 estimate_b_id uuid not null references public.estimates(id) on delete cascade,
 created_at timestamptz not null default now(),
 created_by uuid not null default auth.uid(),
 constraint distinct_pair check (estimate_a_id <> estimate_b_id),
 constraint canonical_pair check (estimate_a_id < estimate_b_id),
 constraint unique_estimate_service_pair unique (estimate_a_id, estimate_b_id)
);
create index if not exists estimate_service_pairs_b_idx on public.estimate_service_pairs(estimate_b_id);
alter table public.estimate_service_pairs enable row level security;
revoke all on public.estimate_service_pairs from public, anon, authenticated;
grant select, insert on public.estimate_service_pairs to authenticated;

create or replace function public.valid_high_dusting_estimate_pair(a uuid,b uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
 select exists (
   select 1 from public.estimates e1 join public.estimates e2
     on e1.client_id = e2.client_id and e1.property_id = e2.property_id
   where e1.id=a and e2.id=b and e1.division='Commercial' and e2.division='Commercial'
     and e1.archived_at is null and e2.archived_at is null
     and ( (e1.result->>'serviceName' = 'High Dusting Cleaning' and e2.result->>'serviceName' <> 'High Dusting Cleaning')
       or (e2.result->>'serviceName' = 'High Dusting Cleaning' and e1.result->>'serviceName' <> 'High Dusting Cleaning') )
 );
$$;
revoke all on function public.valid_high_dusting_estimate_pair(uuid,uuid) from public,anon;
grant execute on function public.valid_high_dusting_estimate_pair(uuid,uuid) to authenticated;

create policy "Sales workflow reads linked estimates" on public.estimate_service_pairs
 for select to authenticated using (
   public.has_any_role(array['Master Admin','Administrator','Manager','Sales'])
   and public.valid_high_dusting_estimate_pair(estimate_a_id,estimate_b_id)
 );
create policy "Sales workflow creates linked estimates" on public.estimate_service_pairs
 for insert to authenticated with check (
   created_by = (select auth.uid())
   and public.has_any_role(array['Master Admin','Administrator','Manager','Sales'])
   and public.valid_high_dusting_estimate_pair(estimate_a_id,estimate_b_id)
 );
