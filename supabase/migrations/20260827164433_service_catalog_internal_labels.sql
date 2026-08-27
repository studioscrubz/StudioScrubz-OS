-- StudioScrubz OS: reusable internal labels for Service Catalog services.
-- Labels are operational metadata only; they do not alter customer pricing.

begin;

create or replace function public.normalize_service_label_name(p_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(regexp_replace(btrim(p_name), '[[:space:]]+', ' ', 'g'));
$$;

revoke all on function public.normalize_service_label_name(text)
from public, anon, authenticated;
grant execute on function public.normalize_service_label_name(text)
to authenticated;

create table if not exists public.service_labels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (public.normalize_service_label_name(name)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_labels_name_check check (
    btrim(name) <> ''
    and char_length(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) <= 80
  ),
  constraint service_labels_normalized_name_key unique (normalized_name)
);

create table if not exists public.service_label_assignments (
  service_id uuid not null references public.services(id) on delete cascade,
  label_id uuid not null references public.service_labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (service_id, label_id)
);

create index if not exists service_label_assignments_label_id_idx
  on public.service_label_assignments(label_id);

drop trigger if exists service_labels_updated_at on public.service_labels;
create trigger service_labels_updated_at
before update on public.service_labels
for each row execute function public.phase19_set_updated_at();

alter table public.service_labels enable row level security;
alter table public.service_label_assignments enable row level security;

drop policy if exists "Catalog workflow read" on public.service_labels;
create policy "Catalog workflow read"
on public.service_labels
for select
to authenticated
using (public.has_any_role(array['Master Admin','Administrator','Manager','Sales']));

drop policy if exists "Master Admin manages service labels" on public.service_labels;
create policy "Master Admin manages service labels"
on public.service_labels
for all
to authenticated
using (public.is_master_admin())
with check (public.is_master_admin());

drop policy if exists "Catalog workflow read" on public.service_label_assignments;
create policy "Catalog workflow read"
on public.service_label_assignments
for select
to authenticated
using (public.has_any_role(array['Master Admin','Administrator','Manager','Sales']));

drop policy if exists "Master Admin manages service label assignments" on public.service_label_assignments;
create policy "Master Admin manages service label assignments"
on public.service_label_assignments
for all
to authenticated
using (public.is_master_admin())
with check (public.is_master_admin());

grant select, insert, update, delete on public.service_labels to authenticated;
grant select, insert, delete on public.service_label_assignments to authenticated;

create or replace function public.get_or_create_service_label(p_name text)
returns public.service_labels
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cleaned_name text := regexp_replace(btrim(p_name), '[[:space:]]+', ' ', 'g');
  result public.service_labels;
begin
  if cleaned_name = '' or char_length(cleaned_name) > 80 then
    raise exception using errcode = '23514', message = 'A service label must contain 1 to 80 characters.';
  end if;

  insert into public.service_labels (name)
  values (cleaned_name)
  on conflict (normalized_name) do update
    set name = public.service_labels.name
  returning * into result;

  return result;
end;
$$;

revoke all on function public.get_or_create_service_label(text)
from public, anon;
grant execute on function public.get_or_create_service_label(text)
to authenticated;

notify pgrst, 'reload schema';

commit;
