-- StudioScrubz OS: human-friendly internal names for recurring pricing rules.
-- Nullable for backward compatibility with existing unnamed rules.

begin;

alter table public.recurring_pricing_rules
  add column if not exists rule_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recurring_pricing_rules_rule_name_check'
      and conrelid = 'public.recurring_pricing_rules'::regclass
  ) then
    alter table public.recurring_pricing_rules
      add constraint recurring_pricing_rules_rule_name_check
      check (
        rule_name is null
        or (btrim(rule_name) <> '' and char_length(btrim(rule_name)) <= 120)
      );
  end if;
end;
$$;

comment on column public.recurring_pricing_rules.rule_name is
  'Internal display name for identifying a recurring pricing rule; does not affect pricing calculations.';

notify pgrst, 'reload schema';

commit;
