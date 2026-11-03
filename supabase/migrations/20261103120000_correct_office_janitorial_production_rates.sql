-- Correct legacy office production assumptions without overwriting site-specific overrides.
-- Values are labor production in cleanable square feet per employee-hour.
-- Existing seeded defaults: light 1200, average/production 900, heavy 650.
-- New planning assumptions: light 3000, average 2200, heavy 1400.
-- Calibrate these with a walkthrough and job-time records before quoting.
UPDATE public.services
SET pricing_config =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(pricing_config,
          '{production_rate}',
          CASE WHEN pricing_config->>'production_rate' = '900'
               THEN to_jsonb(2200) ELSE pricing_config->'production_rate' END,
          true
        ),
        '{average_production_rate}',
        CASE WHEN pricing_config->>'average_production_rate' = '900'
             THEN to_jsonb(2200) ELSE pricing_config->'average_production_rate' END,
        true
      ),
      '{light_production_rate}',
      CASE WHEN pricing_config->>'light_production_rate' = '1200'
           THEN to_jsonb(3000) ELSE pricing_config->'light_production_rate' END,
      true
    ),
    '{heavy_production_rate}',
    CASE WHEN pricing_config->>'heavy_production_rate' = '650'
         THEN to_jsonb(1400) ELSE pricing_config->'heavy_production_rate' END,
    true
  )
WHERE service_code = 'COM-OFFICE'
  AND pricing_config IS NOT NULL
  AND (
    pricing_config->>'production_rate' = '900'
    OR pricing_config->>'average_production_rate' = '900'
    OR pricing_config->>'light_production_rate' = '1200'
    OR pricing_config->>'heavy_production_rate' = '650'
  );
