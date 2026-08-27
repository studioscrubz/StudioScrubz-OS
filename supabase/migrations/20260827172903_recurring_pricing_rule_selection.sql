-- StudioScrubz OS: allow named recurring pricing choices per service/frequency.
-- Historical unnamed rules remain valid and retain their IDs.

begin;

create or replace function public.normalize_recurring_pricing_rule_name(p_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(regexp_replace(btrim(p_name), '[[:space:]]+', ' ', 'g'));
$$;

revoke all on function public.normalize_recurring_pricing_rule_name(text)
from public, anon, authenticated;
grant execute on function public.normalize_recurring_pricing_rule_name(text)
to authenticated;

alter table public.recurring_pricing_rules
  add column if not exists normalized_rule_name text
  generated always as (public.normalize_recurring_pricing_rule_name(rule_name)) stored;

drop index if exists public.recurring_pricing_rule_unique_idx;

create unique index if not exists recurring_pricing_rules_service_rule_name_unique_idx
on public.recurring_pricing_rules (
  coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
  normalized_rule_name
)
where rule_name is not null;

comment on index public.recurring_pricing_rules_service_rule_name_unique_idx is
  'Prevents duplicate normalized rule names within one service scope while allowing multiple rules for the same frequency.';

notify pgrst, 'reload schema';

commit;
