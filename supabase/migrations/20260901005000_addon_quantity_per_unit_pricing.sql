-- StudioScrubz add-on quantity and Per Unit pricing. Review and apply through the normal migration workflow.
begin;

alter table public.service_addons
  add constraint service_addons_per_unit_pricing_check
  check (
    coalesce(pricing_config->>'pricing_type', 'Flat Price') <> 'Per Unit'
    or (
      nullif(btrim(coalesce(pricing_config->>'unit_name', '')), '') is not null
      and coalesce(pricing_config->>'unit_price', '') ~ '^([0-9]+)(\.[0-9]+)?$'
      and (pricing_config->>'unit_price')::numeric >= 0
    )
  ) not valid;

notify pgrst, 'reload schema';
commit;
