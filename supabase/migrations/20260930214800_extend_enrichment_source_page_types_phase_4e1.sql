begin;

alter table public.prospect_enrichment_fields
  drop constraint if exists prospect_enrichment_fields_source_page_type_check;

alter table public.prospect_enrichment_fields
  add constraint prospect_enrichment_fields_source_page_type_check
  check (source_page_type in (
    'OSM','Homepage','Contact','About','Team','Staff','Leadership','Management',
    'Directory','People','Locations','Offices','Structured Data','Generated Email Pattern'
  ));

notify pgrst,'reload schema';

commit;
