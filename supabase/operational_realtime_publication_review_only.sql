-- REVIEW ONLY: apply through the normal Supabase migration workflow after review.
-- This enables Postgres Changes delivery; existing RLS policies continue to govern rows.
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Required publication supabase_realtime does not exist';
  end if;

  foreach v_table in array array[
    'estimates', 'walkthroughs', 'proposals', 'service_agreements', 'jobs',
    'invoices', 'attention_item_states', 'client_communications', 'service_occurrences',
    'service_agreement_documents',
    'payments', 'expenses', 'time_entries', 'clients', 'properties', 'crews', 'employees',
    'services', 'service_addons', 'service_addon_links', 'service_price_tiers',
    'recurring_pricing_rules'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null
      and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table
      )
    then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end
$$;
