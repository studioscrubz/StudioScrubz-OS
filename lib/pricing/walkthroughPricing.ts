import type { CalculatorInput, CommercialCalculatorInput, Frequency, ResidentialCalculatorInput } from "@/types/estimate";
import type { ServiceCatalogBundle } from "@/types/serviceCatalog";
import type { WalkthroughWithRelations } from "@/types/walkthrough";
import { isPostConstructionV2Estimate, type PostConstructionEstimateInput } from "@/lib/pricing/estimates";
import { findCatalogService, isPostConstructionCatalogService } from "@/lib/services/serviceCatalog";

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

  const saved = walkthrough.pricing_review?.estimateResult.calculatorInput ?? walkthrough.pricing_review?.calculatorInput;
  if (isPostConstructionCatalogService(service) || /post[- ]construction/i.test(serviceName)) {
    // Preserve explicit historical calculator versions; never infer V2 from legacy inputs.
    const previous = saved ?? fallback;
    if (previous && "calculatorType" in previous && previous.calculatorType === "Post-Construction") {
      if (saved || !isPostConstructionV2Estimate(previous)) return previous;
      return { ...previous, rooms: measurements.bedrooms ?? previous.rooms, bathrooms: measurements.bathrooms ?? previous.bathrooms,
        floors: measurements.floors ?? previous.floors, kitchens: measurements.kitchenAreas ?? previous.kitchens,
        squareFeet: measurements.squareFeet ?? previous.squareFeet,
        projectCosting: { ...previous.projectCosting, totalSquareFeet: measurements.squareFeet ?? previous.projectCosting.totalSquareFeet },
      } as PostConstructionEstimateInput;
    }
    const projectCosting = {
      version: 2 as const, calculatorType: "Post-Construction" as const,
      totalSquareFeet: measurements.squareFeet ?? 0, scope: walkthrough.scope.map(item => item.label),
      estimatedPersonHours: 0, crewSize: 1, workerHourlyPay: measurements.workerHourlyPay ?? 40,
      plannedProjectDays: measurements.targetProjectDays ?? 1, workdayHours: measurements.workdayHours === 10 ? 10 as const : 8 as const,
      suppliesCost: 0, equipmentRentalCost: 0, travelLogisticsCost: 0, disposalDebrisCost: 0,
      supervisionAdminCost: 0, contingencyCost: 0, desiredMarginPercent: measurements.targetProfitMarginPercent ?? 35,
    };
    const input: PostConstructionEstimateInput = {
      version: 2, projectCosting, calculatorType: "Post-Construction", division: walkthrough.division,
      serviceType: "Post-Construction Cleaning", serviceCode: service?.service_code, frequency: "One-Time", condition,
      squareFeet: projectCosting.totalSquareFeet, floors: measurements.floors ?? 1, rooms: measurements.bedrooms ?? 0, bathrooms: measurements.bathrooms ?? 0,
      kitchens: measurements.kitchenAreas ?? 0, dustSeverity: "Average", debrisSeverity: "Average", detailLevel: "Detailed",
      windowsOrGlassCount: 0, cabinetOrDrawerCount: 0, applianceInteriorCount: 0, stairFlights: 0,
      targetProjectDays: projectCosting.plannedProjectDays, workdayHours: projectCosting.workdayHours,
      workerHourlyPay: projectCosting.workerHourlyPay, targetProfitMarginPercent: projectCosting.desiredMarginPercent,
      additionalDiscountPercent: 0, taxRatePercent: 0, additionalServices: [],
    };
    return input;
  }

  if (walkthrough.division === "Residential") {
    const previous = fallback?.division === "Residential" && !("calculatorType" in fallback) ? fallback : null;
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

  const previous = fallback?.division === "Commercial" && !("calculatorType" in fallback) ? fallback : null;
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
