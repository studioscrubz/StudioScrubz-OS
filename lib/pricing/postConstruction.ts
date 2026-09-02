import type { Condition, EstimateResult, PostConstructionCalculatorInput, PostConstructionDetailLevel, PostConstructionSeverity } from "@/types/estimate";

export const POST_CONSTRUCTION_BASE_HOURS_PER_1K_SQUARE_FEET = 19;
export const POST_CONSTRUCTION_MAX_MARGIN_PERCENT = 70;

export const POST_CONSTRUCTION_LABOR_FACTORS = {
  condition: { Light: 0, Average: 0, Heavy: 0.06, Extreme: 0.12 } satisfies Record<Condition, number>,
  dustSeverity: { Light: 0, Average: 0, Heavy: 0.15, Extreme: 0.3 } satisfies Record<PostConstructionSeverity, number>,
  debrisSeverity: { Light: 0, Average: 0, Heavy: 0.1, Extreme: 0.2 } satisfies Record<PostConstructionSeverity, number>,
  detailLevel: { Standard: 0, Detailed: 0, "High Detail": 0.16 } satisfies Record<PostConstructionDetailLevel, number>,
  windowOrGlassHours: 0.12,
  cabinetOrDrawerHours: 0.06,
  applianceInteriorHours: 0.75,
  stairFlightHours: 1,
} as const;

export const POST_CONSTRUCTION_SUPPLY_COSTS = {
  minimum: 75,
  perSquareFoot: 0.025,
  perWindowOrGlass: 0.35,
  perCabinetOrDrawer: 0.12,
  perApplianceInterior: 2.5,
} as const;

export function calculatePostConstructionEstimate(input: PostConstructionCalculatorInput): EstimateResult {
  const squareFeet = nonnegative(input.squareFeet);
  const baseProductionHours = squareFeet / 1000 * POST_CONSTRUCTION_BASE_HOURS_PER_1K_SQUARE_FEET;
  const adjustments: Array<{ label: string; laborHours: number }> = [];
  addFactor(adjustments, `${input.condition} overall condition`, baseProductionHours, POST_CONSTRUCTION_LABOR_FACTORS.condition[input.condition]);
  addFactor(adjustments, `${input.dustSeverity} construction dust`, baseProductionHours, POST_CONSTRUCTION_LABOR_FACTORS.dustSeverity[input.dustSeverity]);
  addFactor(adjustments, `${input.debrisSeverity} debris`, baseProductionHours, POST_CONSTRUCTION_LABOR_FACTORS.debrisSeverity[input.debrisSeverity]);
  addFactor(adjustments, `${input.detailLevel} finish work`, baseProductionHours, POST_CONSTRUCTION_LABOR_FACTORS.detailLevel[input.detailLevel]);
  addQuantity(adjustments, "Exceptional windows / glass work", whole(input.windowsOrGlassCount), POST_CONSTRUCTION_LABOR_FACTORS.windowOrGlassHours);
  addQuantity(adjustments, "Cabinet / drawer detailing", whole(input.cabinetOrDrawerCount), POST_CONSTRUCTION_LABOR_FACTORS.cabinetOrDrawerHours);
  addQuantity(adjustments, "Appliance interiors", whole(input.applianceInteriorCount), POST_CONSTRUCTION_LABOR_FACTORS.applianceInteriorHours);
  addQuantity(adjustments, "Stair detailing", whole(input.stairFlights), POST_CONSTRUCTION_LABOR_FACTORS.stairFlightHours);

  const totalLaborHours = Math.max(0, baseProductionHours + adjustments.reduce((sum, item) => sum + item.laborHours, 0));
  const targetProjectDays = positive(input.targetProjectDays, 1);
  const workdayHours = input.workdayHours === 10 ? 10 : 8;
  const availableCrewHoursPerWorker = targetProjectDays * workdayHours;
  const recommendedCrewSize = Math.max(1, Math.ceil(totalLaborHours / availableCrewHoursPerWorker));
  const estimatedProjectDays = totalLaborHours / (recommendedCrewSize * workdayHours);
  const laborCost = totalLaborHours * nonnegative(input.workerHourlyPay);
  const supplyCost = Math.max(
    POST_CONSTRUCTION_SUPPLY_COSTS.minimum,
    squareFeet * POST_CONSTRUCTION_SUPPLY_COSTS.perSquareFoot
      + whole(input.windowsOrGlassCount) * POST_CONSTRUCTION_SUPPLY_COSTS.perWindowOrGlass
      + whole(input.cabinetOrDrawerCount) * POST_CONSTRUCTION_SUPPLY_COSTS.perCabinetOrDrawer
      + whole(input.applianceInteriorCount) * POST_CONSTRUCTION_SUPPLY_COSTS.perApplianceInterior,
  );
  const directCost = laborCost + supplyCost;
  const targetMarginPercent = clamp(input.targetProfitMarginPercent, 0, POST_CONSTRUCTION_MAX_MARGIN_PERCENT);
  const additionalDiscountPercent = clamp(input.additionalDiscountPercent, 0, 100);
  const taxRatePercent = clamp(input.taxRatePercent, 0, 100);
  const basePrice = directCost / (1 - targetMarginPercent / 100);
  const manualDiscount = basePrice * additionalDiscountPercent / 100;
  const discountedPrice = Math.max(0, basePrice - manualDiscount);
  const taxes = discountedPrice * taxRatePercent / 100;
  const finalPrice = discountedPrice + taxes;
  const estimatedProfit = discountedPrice - directCost;
  const projectedMarginPercent = basePrice > 0 ? (basePrice - directCost) / basePrice * 100 : 0;
  const roundedLaborHours = tenth(totalLaborHours);
  const roundedBaseHours = tenth(baseProductionHours);
  const roundedDays = tenth(estimatedProjectDays);
  const scope = ["Base square-footage production", ...adjustments.map((item) => item.label)];

  return {
    serviceName: input.serviceType,
    serviceDescription: null,
    basePrice: money(basePrice),
    adjustments: [],
    catalogAddons: input.addonSelections,
    oneTimePrice: money(basePrice),
    recurringDiscount: 0,
    recurringDiscountPercent: 0,
    recurringPricingRuleId: input.recurringPricingRuleId ?? null,
    recurringPricingRuleName: null,
    manualDiscount: money(manualDiscount),
    totalDiscount: money(manualDiscount),
    taxes: money(taxes),
    calculatedFinalPrice: money(finalPrice),
    finalPrice: money(finalPrice),
    monthlyPrice: estimatedMonthlyTotal(finalPrice, input.frequency, input.customIntervalDays),
    visitsPerMonth: estimatedVisitsPerMonth(input.frequency, input.customIntervalDays),
    laborHours: roundedLaborHours,
    crewSize: recommendedCrewSize,
    estimatedDuration: tenth(totalLaborHours / recommendedCrewSize),
    laborCost: money(laborCost),
    supplyCost: money(supplyCost),
    estimatedProfit: money(estimatedProfit),
    scope,
    calculatorInput: {
      ...input,
      squareFeet,
      floors: whole(input.floors),
      rooms: whole(input.rooms),
      bathrooms: whole(input.bathrooms),
      kitchens: whole(input.kitchens),
      windowsOrGlassCount: whole(input.windowsOrGlassCount),
      cabinetOrDrawerCount: whole(input.cabinetOrDrawerCount),
      applianceInteriorCount: whole(input.applianceInteriorCount),
      stairFlights: whole(input.stairFlights),
      targetProjectDays,
      workdayHours,
      workerHourlyPay: nonnegative(input.workerHourlyPay),
      targetProfitMarginPercent: targetMarginPercent,
      additionalDiscountPercent,
      taxRatePercent,
    },
    postConstructionBreakdown: {
      baseProductionHours: roundedBaseHours,
      adjustments: adjustments.map((item) => ({ ...item, laborHours: tenth(item.laborHours) })),
      totalLaborHours: roundedLaborHours,
      availableCrewHoursPerWorker: tenth(availableCrewHoursPerWorker),
      recommendedCrewSize,
      estimatedProjectDays: roundedDays,
      projectedMarginPercent: tenth(projectedMarginPercent),
    },
  };
}

function addFactor(items: Array<{ label: string; laborHours: number }>, label: string, baseHours: number, factor: number): void {
  if (factor > 0 && baseHours > 0) items.push({ label, laborHours: baseHours * factor });
}

function addQuantity(items: Array<{ label: string; laborHours: number }>, label: string, quantity: number, hoursEach: number): void {
  if (quantity > 0) items.push({ label, laborHours: quantity * hoursEach });
}

function finite(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }
function nonnegative(value: number): number { return Math.max(0, finite(value)); }
function positive(value: number, fallback: number): number { return value > 0 && Number.isFinite(value) ? value : fallback; }
function whole(value: number): number { return Math.floor(nonnegative(value)); }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, finite(value))); }
function money(value: number): number { return Math.round(finite(value) * 100) / 100; }
function tenth(value: number): number { return Math.round(finite(value) * 10) / 10; }
function estimatedVisitsPerMonth(frequency: string, customIntervalDays?: number | null): number {
  if (frequency === "Daily") return 365 / 12;
  if (frequency === "Weekly") return 52 / 12;
  if (frequency === "Biweekly") return 26 / 12;
  if (frequency === "Twice Monthly") return 2;
  if (frequency === "Monthly") return 1;
  if (frequency === "Custom") return Number.isInteger(customIntervalDays) && Number(customIntervalDays) >= 1 ? 365 / Number(customIntervalDays) / 12 : 0;
  return frequency === "One-Time" ? 1 : 0;
}
function estimatedMonthlyTotal(perVisit: number, frequency: string, customIntervalDays?: number | null): number | null {
  if (frequency === "One-Time") return null;
  const visits = estimatedVisitsPerMonth(frequency, customIntervalDays);
  return visits > 0 ? money(perVisit * visits) : null;
}
