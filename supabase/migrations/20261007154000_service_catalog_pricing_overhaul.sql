begin;

-- ============================================================
-- StudioScrubz Service Catalog Pricing Overhaul
-- 2026-10-07
--
-- Locked pricing policy:
--   Target gross margin: 35%
--   Normal minimum margin: 30%
--   Exception floor: 25%
--
-- Recurring:
--   Daily: 15%
--   Weekly: 10%
--   Biweekly: 5%
--   Monthly: no automatic discount
--   Upkeep: handled separately by calculator at 30%
--
-- Catalog tiers are pricing FLOORS, not automatic final quotes.
-- ============================================================


-- ------------------------------------------------------------
-- 1. GLOBAL RECURRING PRICING
-- ------------------------------------------------------------

-- Retire the old global Upkeep rule. Upkeep is a standalone
-- residential product and must not behave like a global weekly
-- discount.
update public.recurring_pricing_rules
set is_active = false
where service_id is null
  and lower(coalesce(rule_name, '')) = lower('Monthly Upkeep Plan');

-- Daily: 15%
update public.recurring_pricing_rules
set adjustment_type = 'Percentage',
    adjustment_value = 15,
    is_active = true
where service_id is null
  and frequency = 'Daily';

-- Weekly: 10%
update public.recurring_pricing_rules
set adjustment_type = 'Percentage',
    adjustment_value = 10,
    is_active = true
where service_id is null
  and frequency = 'Weekly'
  and lower(coalesce(rule_name, '')) <> lower('Monthly Upkeep Plan');

-- Biweekly / every two weeks: 5%
update public.recurring_pricing_rules
set adjustment_type = 'Percentage',
    adjustment_value = 5,
    is_active = true
where service_id is null
  and frequency = 'Biweekly';

-- No automatic monthly discount.
update public.recurring_pricing_rules
set is_active = false
where service_id is null
  and frequency = 'Monthly';


-- ------------------------------------------------------------
-- 2. COMMERCIAL SERVICE FLOORS + PRICING GUARDRAILS
-- ------------------------------------------------------------

-- Office
update public.services
set base_price = 120,
    minimum_price = 120,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'production_rate', 900,
        'light_production_rate', 1200,
        'average_production_rate', 900,
        'heavy_production_rate', 650,
        'default_target_profit_margin_percent', 35,
        'minimum_acceptable_margin_percent', 30,
        'exception_margin_floor_percent', 25
      )
where service_code = 'COM-OFFICE';

-- Barbershop / Salon
update public.services
set base_price = 120,
    minimum_price = 120,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'production_rate', 800,
        'default_target_profit_margin_percent', 35,
        'minimum_acceptable_margin_percent', 30,
        'exception_margin_floor_percent', 25
      )
where service_code = 'COM-BARBER';

-- Gym / Spa
update public.services
set base_price = 180,
    minimum_price = 180,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'production_rate', 900,
        'default_target_profit_margin_percent', 35,
        'minimum_acceptable_margin_percent', 30,
        'exception_margin_floor_percent', 25
      )
where service_code = 'COM-GYM';

-- Restaurant
update public.services
set base_price = 250,
    minimum_price = 250,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'production_rate', 700,
        'default_target_profit_margin_percent', 35,
        'minimum_acceptable_margin_percent', 30,
        'exception_margin_floor_percent', 25
      )
where service_code = 'COM-RESTAURANT';

-- Recording Studio
update public.services
set base_price = 150,
    minimum_price = 150,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'default_target_profit_margin_percent', 35,
        'minimum_acceptable_margin_percent', 30,
        'exception_margin_floor_percent', 25
      )
where service_code = 'COM-STUDIO';

-- Tattoo
update public.services
set base_price = 150,
    minimum_price = 150,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'production_rate', 800,
        'default_target_profit_margin_percent', 35,
        'minimum_acceptable_margin_percent', 30,
        'exception_margin_floor_percent', 25
      )
where service_code = 'COM-TATTOO';

-- Retail
update public.services
set base_price = 150,
    minimum_price = 150,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'production_rate', 1200,
        'default_target_profit_margin_percent', 35,
        'minimum_acceptable_margin_percent', 30,
        'exception_margin_floor_percent', 25
      )
where service_code = 'COM-RETAIL';

-- Warehouse
update public.services
set base_price = 350,
    minimum_price = 350,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'production_rate', 1800,
        'default_target_profit_margin_percent', 35,
        'minimum_acceptable_margin_percent', 30,
        'exception_margin_floor_percent', 25
      )
where service_code = 'COM-WAREHOUSE';

-- Event Venue
update public.services
set base_price = 250,
    minimum_price = 250,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'default_target_profit_margin_percent', 35,
        'minimum_acceptable_margin_percent', 30,
        'exception_margin_floor_percent', 25
      )
where service_code = 'COM-EVENT';

-- Other Commercial
update public.services
set base_price = 150,
    minimum_price = 150,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'default_target_profit_margin_percent', 35,
        'minimum_acceptable_margin_percent', 30,
        'exception_margin_floor_percent', 25
      )
where service_code = 'COM-OTHER';

-- Apartment Building / Complex
update public.services
set base_price = 180,
    minimum_price = 180,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'default_target_profit_margin_percent', 35,
        'minimum_acceptable_margin_percent', 30,
        'exception_margin_floor_percent', 25
      )
where service_code = 'PM-COMMON';


-- ------------------------------------------------------------
-- 3. POST-CONSTRUCTION
-- ------------------------------------------------------------

-- Remove $300 as a meaningful quote anchor.
-- Pricing is walkthrough/project-calculator driven.
update public.services
set base_price = 0,
    minimum_price = 0,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'calculator_required', true,
        'walkthrough_required', true,
        'default_target_profit_margin_percent', 35,
        'minimum_acceptable_margin_percent', 30,
        'exception_margin_floor_percent', 25
      )
where service_code in (
  'BOTH-POST-CONSTRUCTION',
  'COM-POST-CONSTRUCTION'
);


-- ------------------------------------------------------------
-- 4. HELPER: REPLACE COMMERCIAL SIZE TIERS
-- ------------------------------------------------------------

-- Office
delete from public.service_price_tiers
where service_id = (
  select id from public.services where service_code = 'COM-OFFICE'
);

insert into public.service_price_tiers
(service_id, tier_name, min_value, max_value, price, unit_label, pricing_config, display_order, is_active)
select id, '0–1,000 sq ft', 0, 1000, 120, 'Square Feet', '{}'::jsonb, 10, true
from public.services where service_code = 'COM-OFFICE'
union all
select id, '1,001–3,000 sq ft', 1001, 3000, 200, 'Square Feet', '{}'::jsonb, 20, true
from public.services where service_code = 'COM-OFFICE'
union all
select id, '3,001–6,000 sq ft', 3001, 6000, 350, 'Square Feet', '{}'::jsonb, 30, true
from public.services where service_code = 'COM-OFFICE'
union all
select id, '6,001–10,000 sq ft', 6001, 10000, 600, 'Square Feet', '{}'::jsonb, 40, true
from public.services where service_code = 'COM-OFFICE'
union all
select id, '10,000+ sq ft', 10001, null, 600, 'Square Feet',
       '{"custom_quote":true}'::jsonb, 50, true
from public.services where service_code = 'COM-OFFICE';


-- Gym / Spa
delete from public.service_price_tiers
where service_id = (
  select id from public.services where service_code = 'COM-GYM'
);

insert into public.service_price_tiers
(service_id, tier_name, min_value, max_value, price, unit_label, pricing_config, display_order, is_active)
select id, '0–1,500 sq ft', 0, 1500, 180, 'Square Feet', '{}'::jsonb, 10, true
from public.services where service_code = 'COM-GYM'
union all
select id, '1,501–3,000 sq ft', 1501, 3000, 250, 'Square Feet', '{}'::jsonb, 20, true
from public.services where service_code = 'COM-GYM'
union all
select id, '3,001–6,000 sq ft', 3001, 6000, 400, 'Square Feet', '{}'::jsonb, 30, true
from public.services where service_code = 'COM-GYM'
union all
select id, '6,001–10,000 sq ft', 6001, 10000, 650, 'Square Feet', '{}'::jsonb, 40, true
from public.services where service_code = 'COM-GYM'
union all
select id, '10,000+ sq ft', 10001, null, 650, 'Square Feet',
       '{"custom_quote":true}'::jsonb, 50, true
from public.services where service_code = 'COM-GYM';


-- Restaurant
delete from public.service_price_tiers
where service_id = (
  select id from public.services where service_code = 'COM-RESTAURANT'
);

insert into public.service_price_tiers
(service_id, tier_name, min_value, max_value, price, unit_label, pricing_config, display_order, is_active)
select id, '0–1,200 sq ft', 0, 1200, 250, 'Square Feet', '{}'::jsonb, 10, true
from public.services where service_code = 'COM-RESTAURANT'
union all
select id, '1,201–2,500 sq ft', 1201, 2500, 400, 'Square Feet', '{}'::jsonb, 20, true
from public.services where service_code = 'COM-RESTAURANT'
union all
select id, '2,501–4,000 sq ft', 2501, 4000, 650, 'Square Feet', '{}'::jsonb, 30, true
from public.services where service_code = 'COM-RESTAURANT'
union all
select id, '4,001–7,000+ sq ft', 4001, null, 900, 'Square Feet', '{}'::jsonb, 40, true
from public.services where service_code = 'COM-RESTAURANT';


-- Recording Studio
delete from public.service_price_tiers
where service_id = (
  select id from public.services where service_code = 'COM-STUDIO'
);

insert into public.service_price_tiers
(service_id, tier_name, min_value, max_value, price, unit_label, pricing_config, display_order, is_active)
select id, 'Small Studio', 0, 1000, 150, 'Square Feet', '{}'::jsonb, 10, true
from public.services where service_code = 'COM-STUDIO'
union all
select id, 'Medium Studio', 1001, 2500, 220, 'Square Feet', '{}'::jsonb, 20, true
from public.services where service_code = 'COM-STUDIO'
union all
select id, 'Large Studio', 2501, 5000, 350, 'Square Feet', '{}'::jsonb, 30, true
from public.services where service_code = 'COM-STUDIO'
union all
select id, 'Commercial Facility', 5001, 10000, 600, 'Square Feet', '{}'::jsonb, 40, true
from public.services where service_code = 'COM-STUDIO'
union all
select id, 'Large Commercial Facility', 10001, null, 600, 'Square Feet',
       '{"custom_quote":true}'::jsonb, 50, true
from public.services where service_code = 'COM-STUDIO';


-- Retail
delete from public.service_price_tiers
where service_id = (
  select id from public.services where service_code = 'COM-RETAIL'
);

insert into public.service_price_tiers
(service_id, tier_name, min_value, max_value, price, unit_label, pricing_config, display_order, is_active)
select id, '0–1,000 sq ft', 0, 1000, 150, 'Square Feet', '{}'::jsonb, 10, true
from public.services where service_code = 'COM-RETAIL'
union all
select id, '1,001–2,500 sq ft', 1001, 2500, 225, 'Square Feet', '{}'::jsonb, 20, true
from public.services where service_code = 'COM-RETAIL'
union all
select id, '2,501–5,000 sq ft', 2501, 5000, 350, 'Square Feet', '{}'::jsonb, 30, true
from public.services where service_code = 'COM-RETAIL'
union all
select id, '5,001–10,000 sq ft', 5001, 10000, 600, 'Square Feet', '{}'::jsonb, 40, true
from public.services where service_code = 'COM-RETAIL'
union all
select id, '10,000+ sq ft', 10001, null, 600, 'Square Feet',
       '{"custom_quote":true}'::jsonb, 50, true
from public.services where service_code = 'COM-RETAIL';


-- Warehouse
delete from public.service_price_tiers
where service_id = (
  select id from public.services where service_code = 'COM-WAREHOUSE'
);

insert into public.service_price_tiers
(service_id, tier_name, min_value, max_value, price, unit_label, pricing_config, display_order, is_active)
select id, '0–5,000 sq ft', 0, 5000, 350, 'Square Feet', '{}'::jsonb, 10, true
from public.services where service_code = 'COM-WAREHOUSE'
union all
select id, '5,001–10,000 sq ft', 5001, 10000, 550, 'Square Feet', '{}'::jsonb, 20, true
from public.services where service_code = 'COM-WAREHOUSE'
union all
select id, '10,001–25,000 sq ft', 10001, 25000, 900, 'Square Feet', '{}'::jsonb, 30, true
from public.services where service_code = 'COM-WAREHOUSE'
union all
select id, '25,001–50,000 sq ft', 25001, 50000, 1500, 'Square Feet', '{}'::jsonb, 40, true
from public.services where service_code = 'COM-WAREHOUSE'
union all
select id, '50,000+ sq ft', 50001, null, 1500, 'Square Feet',
       '{"custom_quote":true}'::jsonb, 50, true
from public.services where service_code = 'COM-WAREHOUSE';


-- Apartment Building / Complex
delete from public.service_price_tiers
where service_id = (
  select id from public.services where service_code = 'PM-COMMON'
);

insert into public.service_price_tiers
(service_id, tier_name, min_value, max_value, price, unit_label, pricing_config, display_order, is_active)
select id, '5–15 Units', 5, 15, 180, 'Units', '{}'::jsonb, 10, true
from public.services where service_code = 'PM-COMMON'
union all
select id, '16–40 Units', 16, 40, 250, 'Units', '{}'::jsonb, 20, true
from public.services where service_code = 'PM-COMMON'
union all
select id, '41–80 Units', 41, 80, 400, 'Units', '{}'::jsonb, 30, true
from public.services where service_code = 'PM-COMMON'
union all
select id, '80+ Units', 81, null, 650, 'Units', '{}'::jsonb, 40, true
from public.services where service_code = 'PM-COMMON';


-- ------------------------------------------------------------
-- 5. RESIDENTIAL ADD-ONS
-- ------------------------------------------------------------

-- Refrigerator
update public.service_addons
set price = 50,
    pricing_model = 'Flat Rate',
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'pricing_type', 'Per Unit',
        'unit_name', 'Refrigerator',
        'unit_price', 50
      )
where addon_code = 'RES-FRIDGE';

-- Oven
update public.service_addons
set price = 50,
    pricing_model = 'Flat Rate',
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'pricing_type', 'Per Unit',
        'unit_name', 'Oven',
        'unit_price', 50,
        'double_oven_price', 85
      )
where addon_code = 'RES-OVEN';

-- Residential windows
update public.service_addons
set price = 10,
    pricing_model = 'Per Unit',
    unit_label = 'Window',
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'pricing_type', 'Per Unit',
        'unit_name', 'Standard Window',
        'unit_price', 10,
        'oversized_window_price', 15,
        'sliding_glass_door_price', 20,
        'french_multi_pane_door_price', 25,
        'picture_floor_to_ceiling_price', 20
      )
where addon_code = 'RES-WINDOWS';

-- Cabinets: $70 minimum, quantity-aware.
update public.service_addons
set price = 70,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'minimum_price', 70,
        'small_max_units', 10,
        'small_price', 70,
        'medium_max_units', 20,
        'medium_price', 110,
        'large_max_units', 30,
        'large_price', 150,
        'additional_unit_price', 5
      )
where addon_code = 'RES-CABINETS';

-- Laundry
update public.service_addons
set price = 30,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'first_load_price', 30,
        'additional_load_price', 25
      )
where addon_code = 'RES-LAUNDRY';

-- Bed linens
update public.service_addons
set price = 15,
    pricing_model = 'Per Bedroom',
    unit_label = 'Bed',
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'pricing_type', 'Per Unit',
        'unit_name', 'Bed',
        'unit_price', 15
      )
where addon_code = 'RES-LINENS';

-- Wall washing
update public.service_addons
set price = 80,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'minimum_price', 80,
        'scope_pricing_required', true
      )
where addon_code = 'RES-WALLS';

-- Garage
update public.service_addons
set price = 75,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'one_car_price', 75,
        'two_car_price', 125,
        'three_car_price', 175,
        'four_plus_custom', true
      )
where addon_code = 'RES-GARAGE';

-- Patio
update public.service_addons
set price = 55,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'minimum_price', 55,
        'scope_pricing_required', true,
        'pressure_washing_separate_service', true
      )
where addon_code = 'RES-PATIO';


-- ------------------------------------------------------------
-- 6. COMMERCIAL ADD-ONS
-- ------------------------------------------------------------

-- Commercial windows
update public.service_addons
set price = 75,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'minimum_price', 75,
        'scope_pricing_required', true
      )
where addon_code = 'COM-WINDOWS';

-- Floor Detail
-- $18 is no longer a customer-facing flat selling price.
update public.service_addons
set price = 0,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'scope_pricing_required', true,
        'calculator_driven', true
      )
where addon_code = 'COM-FLOOR';

-- Commercial appliance detail
update public.service_addons
set price = 130,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'minimum_price', 130,
        'scope_pricing_required', true
      )
where addon_code = 'COM-APPLIANCE';

-- High dusting
update public.service_addons
set price = 75,
    pricing_config =
      coalesce(pricing_config, '{}'::jsonb) ||
      jsonb_build_object(
        'minimum_price', 75,
        'scope_pricing_required', true,
        'high_access_custom', true
      )
where addon_code = 'COM-HIGH-DUST';


-- ------------------------------------------------------------
-- 7. CATALOG POLICY METADATA
-- ------------------------------------------------------------

-- Store common guardrails on active commercial services so the
-- calculator can consume policy from the catalog instead of
-- hardcoding it in UI components.
update public.services
set pricing_config =
  coalesce(pricing_config, '{}'::jsonb) ||
  jsonb_build_object(
    'target_gross_margin_percent', 35,
    'normal_minimum_margin_percent', 30,
    'exception_floor_margin_percent', 25,
    'catalog_price_is_floor', true,
    'final_margin_validation_required', true
  )
where is_active = true
  and division in ('Commercial', 'Both');


commit;