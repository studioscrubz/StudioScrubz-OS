import type { CalculatorInput, CommercialCalculatorInput, Frequency, ResidentialCalculatorInput } from "@/types/estimate";
import type { ServiceCatalogBundle } from "@/types/serviceCatalog";
import type { WalkthroughWithRelations } from "@/types/walkthrough";
import { findCatalogService } from "@/lib/services/serviceCatalog";

export function mapWalkthroughToCalculatorInput(walkthrough: WalkthroughWithRelations, catalog: ServiceCatalogBundle): CalculatorInput {
  const measurements = walkthrough.measurements;
  const fallback = walkthrough.estimate?.result.calculatorInput;
  const serviceName = measurements.serviceType || walkthrough.estimate?.service_name || walkthrough.estimate?.result.serviceName || "";
  const service = findCatalogService(catalog.services, walkthrough.division, serviceName);
  const config = service?.pricing_config ?? {};
  const frequency = measurements.frequency ?? walkthrough.estimate?.frequency ?? fallback?.frequency ?? "One-Time";
  const customIntervalDays = frequency === "Custom" ? measurements.customIntervalDays ?? fallback?.customIntervalDays ?? null : null;
  const condition = measurements.overallCondition || fallback?.condition || "Average";
  const addons = (measurements.catalogAddons?.length ? measurements.catalogAddons : walkthrough.estimate?.result.catalogAddons ?? []).map(item => item.name);

  if (walkthrough.division === "Residential") {
    const previous = fallback?.division === "Residential" ? fallback : null;
    return {
      division: "Residential",
      serviceType: trimCleaning(serviceName),
      frequency,
      customIntervalDays,
      condition,
      squareFeet: value(measurements.squareFeet, previous?.squareFeet, 0),
      bedrooms: value(measurements.bedrooms, previous?.bedrooms, 0),
      bathrooms: value(measurements.bathrooms, previous?.bathrooms, 0),
      occupied: measurements.occupied ?? previous?.occupied ?? true,
      pets: petValue(measurements.pets, previous?.pets),
      additionalDiscountPercent: previous?.additionalDiscountPercent ?? 0,
      taxRatePercent: 0,
      addOns: addons,
      targetProjectDays: measurements.targetProjectDays ?? previous?.targetProjectDays,
      workdayHours: measurements.workdayHours ?? previous?.workdayHours,
    } satisfies ResidentialCalculatorInput;
  }

  const previous = fallback?.division === "Commercial" ? fallback : null;
  return {
    division: "Commercial",
    commercialType: trimCleaning(serviceName),
    frequency,
    customIntervalDays,
    condition,
    squareFeet: value(measurements.squareFeet, previous?.squareFeet, 0),
    floors: value(measurements.floors, previous?.floors, 1),
    restrooms: value(measurements.restrooms, previous?.restrooms, 0),
    kitchens: value(measurements.kitchenAreas, previous?.kitchens, 0),
    stations: value(measurements.stations, previous?.stations, 0),
    units: value(measurements.units, previous?.units, 0),
    targetCompletionHours: value(measurements.targetCompletionHours, previous?.targetCompletionHours, configNumber(config.default_target_completion_hours, 4)),
    workerHourlyPay: value(measurements.workerHourlyPay, previous?.workerHourlyPay, configNumber(config.default_worker_hourly_pay, 22)),
    targetProfitMarginPercent: value(measurements.targetProfitMarginPercent, previous?.targetProfitMarginPercent, configNumber(config.default_target_profit_margin_percent, 35)),
    additionalDiscountPercent: previous?.additionalDiscountPercent ?? 0,
    taxRatePercent: 0,
    additionalServices: addons,
    targetProjectDays: measurements.targetProjectDays ?? previous?.targetProjectDays ?? 3,
    workdayHours: measurements.workdayHours ?? previous?.workdayHours ?? 8,
  } satisfies CommercialCalculatorInput;
}

export function validFrequency(value: unknown): value is Frequency { return ["One-Time", "Daily", "Weekly", "Biweekly", "Twice Monthly", "Monthly", "Custom"].includes(String(value)); }
function value(primary: number | null | undefined, fallback: number | null | undefined, defaultValue: number) { return primary ?? fallback ?? defaultValue; }
function trimCleaning(value: string) { return value.replace(/ Cleaning$/i, "").trim(); }
function configNumber(value: unknown, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function petValue(value: string, fallback?: boolean) { if (value.trim()) return /^(yes|true|present|\d+)/i.test(value.trim()); return fallback ?? false; }
