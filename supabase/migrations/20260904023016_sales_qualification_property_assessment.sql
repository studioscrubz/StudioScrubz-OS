-- Sales qualification and customer photo assessment access.
-- Qualification data remains in walkthroughs.measurements so legacy rows need no backfill.

create table if not exists public.assessment_photo_access (
  id uuid primary key default gen_random_uuid(),
  walkthrough_id uuid not null unique references public.walkthroughs(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assessment_photo_access_token_hash_idx on public.assessment_photo_access(token_hash);
alter table public.assessment_photo_access enable row level security;

-- Server-only table: public and browser clients never receive token digests.
revoke all on table public.assessment_photo_access from public, anon, authenticated;
grant all on table public.assessment_photo_access to service_role;

create or replace function public.set_assessment_photo_access_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.set_assessment_photo_access_updated_at() from public, anon, authenticated;
drop trigger if exists assessment_photo_access_set_updated_at on public.assessment_photo_access;
create trigger assessment_photo_access_set_updated_at before update on public.assessment_photo_access
for each row execute function public.set_assessment_photo_access_updated_at();
