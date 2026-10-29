-- Dedicated separately quoted commercial service.
-- Reuse existing approved commercial calculator defaults rather than inventing
-- a high-dusting rate, floor, or working-at-height charge.
insert into public.services (
  service_code, service_name, division, category, description,
  pricing_model, pricing_config, base_price, minimum_price,
  is_recurring_available, is_active, display_order, notes
)
select
  'COM-HIGH-DUST', 'High Dusting Cleaning', 'Commercial', 'Specialty Cleaning',
  'Commercial high dusting of approved elevated surfaces. Scope and price require a separate site assessment and estimate; not included in routine janitorial service.',
  'Custom',
  coalesce(template.pricing_config, '{}'::jsonb) ||
    '{"requires_separate_quote":true,"requires_walkthrough":true,"catalog_price_is_floor":false,"default_worker_hourly_pay":30,"default_target_profit_margin_percent":35}'::jsonb,
  0, 0, false, true, 175,
  'Quote separately: document ceiling heights, elevated surfaces, access equipment, operating conditions and exclusions. Do not include this work in a regular cleaning estimate or price it as a flat add-on.'
from public.services template
where template.service_code = 'COM-OTHER'
on conflict (service_code) do nothing;

-- Never link this service into service_addons or service_addon_links.
-- It must be its own estimate with its own authorization and pricing.
