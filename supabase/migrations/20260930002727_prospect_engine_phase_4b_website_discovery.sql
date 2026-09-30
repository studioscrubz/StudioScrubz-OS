begin;

-- Phase 4B records that a website may have been discovered after the original
-- OpenStreetMap result. Existing Phase 4A rows and accepted decisions remain intact.
alter table public.prospect_enrichment_items
  add column if not exists website_discovery_status text
  check (website_discovery_status is null or website_discovery_status in ('Not Needed','Verified','Not Found','Failed'));

alter table public.prospect_enrichment_items
  add column if not exists website_discovered_at timestamptz;

alter table public.prospect_enrichment_items
  add column if not exists website_discovery_source text
  check (website_discovery_source is null or website_discovery_source in ('Public Web Search'));

notify pgrst,'reload schema';
commit;
