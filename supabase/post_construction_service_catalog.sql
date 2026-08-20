-- Review and run in the Supabase SQL editor after verifying production catalog data.
-- Adds Post-Construction Cleaning only when no matching code or service name exists.

insert into public.services (
  service_code,
  service_name,
  division,
  category,
  description,
  pricing_model,
  pricing_config,
  base_price,
  unit_label,
  minimum_price,
  is_recurring_available,
  is_active,
  display_order,
  notes
)
select
  'BOTH-POST-CONSTRUCTION',
  'Post-Construction Cleaning',
  'Both',
  'Post-Construction',
  'One-time cleaning after construction or renovation work, configured to the property scope and site conditions.',
  'Custom',
  jsonb_build_object(
    'production_rate', 75,
    'restroom_hours', 0.75,
    'kitchen_hours', 1.00,
    'station_hours', 0.10,
    'unit_hours', 0.40,
    'additional_floor_hours', 1.00,
    'minimum_supply_cost', 50,
    'supply_cost_per_square_foot', 0.04,
    'maximum_margin_percent', 85,
    'minimum_margin_denominator', 0.15,
    'default_target_completion_hours', 8,
    'default_worker_hourly_pay', 35,
    'default_target_profit_margin_percent', 35,
    'requires_complete_pricing_config', true
  ),
  0,
  null,
  0,
  false,
  true,
  210,
  'Configure the production rate, fixture labor, supply costs, and margin guardrails before quoting.'
where not exists (
  select 1
  from public.services
  where lower(service_code) in (lower('BOTH-POST-CONSTRUCTION'), lower('COM-POST-CONSTRUCTION'))
     or lower(service_name) = lower('Post-Construction Cleaning')
)
on conflict (service_code) do nothing;
