import type {
  ProfitabilityDirectCosts,
  ProfitabilityProjection,
  ProfitabilitySettings,
  TravelProjection,
} from "@/types/profitability";

export type ProfitabilityInput = {
  price: number;
  cleanerCount: number;
  hoursPerCleaner: number;
  hourlyWage?: number | null;
  settings: ProfitabilitySettings;
  travel: TravelProjection;
  supplies?: number | null;
  equipment?: number | null;
  subcontractors?: number | null;
  otherDirectExpenses?: number | null;
  setupLabor?: number | null;
  ownerLabor?: number | null;
  parkingTolls?: number | null;
  disposal?: number | null;
  paymentProcessingFees?: number | null;
  salesCommissions?: number | null;
  allocatedOverhead?: number | null;
  visitsPerPeriod?: number | null;
  legacyTravelLogisticsCost?: number | null;
  legacyProjectCosts?: number | null;
  legacyTravelIncludesDriving?: boolean;
  periodLabel?: string;
};

const money = (value: number) => Math.round(value * 100) / 100;
const nonNegative = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};
const positiveInteger = (value: unknown, fallback: number) => {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
};
const commissionInclusiveMinimum = (directCost: number | null, targetMarginRate: number | null, operatingCosts: { paymentProcessingFees: number; salesCommissions: number; allocatedOverhead: number }): number | null => {
  if (directCost == null || targetMarginRate == null || targetMarginRate >= 1) return null;
  // Cover commission and other quoted-period costs before preserving the configured target margin.
  // Keep commission separate from direct job costs and do not alter customer-facing pricing.
  const allInCost = directCost + operatingCosts.paymentProcessingFees + operatingCosts.salesCommissions + operatingCosts.allocatedOverhead;
  return Math.ceil((allInCost / (1 - targetMarginRate)) * 100 - 1e-9) / 100;
};
const validRate = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number < 1 ? number : null;
};

export function calculateProfitability(input: ProfitabilityInput): ProfitabilityProjection {
  const settings = input.settings;
  const cleanerCount = positiveInteger(input.cleanerCount, 1);
  const hoursPerCleaner = nonNegative(input.hoursPerCleaner);
  const hourlyWage = nonNegative(input.hourlyWage ?? settings.cleanerHourlyWage);
  const burdenRate = validRate(settings.employerBurdenRate) ?? 0;
  const targetMarginRate = validRate(settings.targetGrossMarginRate);
  const visitsPerPeriod = positiveInteger(input.visitsPerPeriod, 1);
  const estimatedLaborHours = money(cleanerCount * hoursPerCleaner * visitsPerPeriod);
  const loadedHourlyLaborCost = money(hourlyWage * (1 + burdenRate));
  const loadedCleaningLabor = money(estimatedLaborHours * loadedHourlyLaborCost);
  const travel = normalizeTravel(input.travel, cleanerCount, settings);
  const rate = settings.vehicleOperatingRatePerMile == null ? null : nonNegative(settings.vehicleOperatingRatePerMile);
  const legacyTravelLogistics = money(nonNegative(input.legacyTravelLogisticsCost));
  const legacyTravelIncludesDriving = input.legacyTravelIncludesDriving === true && legacyTravelLogistics > 0;
  const vehicleOperating = legacyTravelIncludesDriving ? 0 : travel.roundTripMiles == null || rate == null ? null : money(travel.roundTripMiles * rate * travel.vehicleCount * visitsPerPeriod);
  const compensableTravelLabor = legacyTravelIncludesDriving || !travel.companyRequiredTravelIsCompensable
    ? 0
    : travel.roundTripMinutes == null
      ? null
      : money((travel.roundTripMinutes / 60) * travel.travelingEmployeeCount * loadedHourlyLaborCost * visitsPerPeriod);
  const directCosts: ProfitabilityDirectCosts = {
    loadedCleaningLabor,
    vehicleOperating,
    compensableTravelLabor,
    legacyTravelLogistics,
    legacyProjectCosts: money(nonNegative(input.legacyProjectCosts)),
    supplies: money(nonNegative(input.supplies) * visitsPerPeriod),
    equipment: money(nonNegative(input.equipment)),
    subcontractors: money(nonNegative(input.subcontractors)),
    other: money(nonNegative(input.otherDirectExpenses)),
    setupLabor: money(nonNegative(input.setupLabor)),
    ownerLabor: money(nonNegative(input.ownerLabor)),
    parkingTolls: money(nonNegative(input.parkingTolls)),
    disposal: money(nonNegative(input.disposal)),
  };
  const operatingCosts = {
    paymentProcessingFees: money(nonNegative(input.paymentProcessingFees)),
    salesCommissions: money(nonNegative(input.salesCommissions)),
    allocatedOverhead: money(nonNegative(input.allocatedOverhead)),
  };
  const travelCostsVerified = travel.verification === "Verified" || travel.verification === "Manual";
  const costComplete = vehicleOperating != null && compensableTravelLabor != null;
  const directValues = [directCosts.loadedCleaningLabor, directCosts.vehicleOperating, directCosts.compensableTravelLabor, directCosts.legacyTravelLogistics, directCosts.legacyProjectCosts, directCosts.supplies, directCosts.equipment, directCosts.subcontractors, directCosts.other, directCosts.setupLabor, directCosts.ownerLabor, directCosts.parkingTolls, directCosts.disposal];
  const totalEstimatedDirectCost = costComplete
    ? money(directValues.reduce<number>((sum, value) => sum + (value ?? 0), 0))
    : null;
  const price = money(nonNegative(input.price));
  const grossProfit = totalEstimatedDirectCost == null ? null : money(price - totalEstimatedDirectCost);
  const grossMarginPercent = totalEstimatedDirectCost == null || price <= 0 ? null : money((grossProfit! / price) * 100);
  const contributionProfit = grossProfit == null ? null : money(grossProfit - operatingCosts.paymentProcessingFees - operatingCosts.salesCommissions);
  const contributionMarginPercent = contributionProfit == null || price <= 0 ? null : money((contributionProfit / price) * 100);
  const operatingProfit = contributionProfit == null ? null : money(contributionProfit - operatingCosts.allocatedOverhead);
  const operatingMarginPercent = operatingProfit == null || price <= 0 ? null : money((operatingProfit / price) * 100);
  const recommendedMinimumPrice = commissionInclusiveMinimum(totalEstimatedDirectCost, targetMarginRate, operatingCosts);
  const differenceToRecommendedMinimum = recommendedMinimumPrice == null ? null : money(Math.max(0, recommendedMinimumPrice - price));
  return {
    version: 1,
    periodLabel: input.periodLabel?.trim() || "Per service visit",
    visitsPerPeriod,
    legacyTravelIncludesDriving,
    price,
    cleanerCount,
    hoursPerCleaner: money(hoursPerCleaner),
    estimatedLaborHours,
    hourlyWage: money(hourlyWage),
    employerBurdenRate: money(burdenRate * 100),
    loadedHourlyLaborCost,
    travel,
    directCosts,
    operatingCosts,
    contributionProfit,
    contributionMarginPercent,
    operatingProfit,
    operatingMarginPercent,
    travelCostsVerified,
    costComplete,
    totalEstimatedDirectCost,
    grossProfit,
    grossMarginPercent,
    targetGrossMarginPercent: money((targetMarginRate ?? 0) * 100),
    recommendedMinimumPrice,
    differenceToRecommendedMinimum,
    belowTargetMargin: recommendedMinimumPrice != null && price < recommendedMinimumPrice,
  };
}

export function repriceProfitability(projection: ProfitabilityProjection | null | undefined, price: number, periodLabel?: string): ProfitabilityProjection | null {
  if (!projection || projection.version !== 1) return null;
  const targetRate = projection.targetGrossMarginPercent / 100;
  const direct = projection.directCosts;
  const costComplete = projection.costComplete && projection.totalEstimatedDirectCost != null;
  const total = costComplete ? projection.totalEstimatedDirectCost! : null;
  const customerPrice = money(nonNegative(price));
  const grossProfit = total == null ? null : money(customerPrice - total);
  const grossMarginPercent = total == null || customerPrice <= 0 ? null : money((grossProfit! / customerPrice) * 100);
  const processing = projection.operatingCosts?.paymentProcessingFees ?? 0;
  const commissions = projection.operatingCosts?.salesCommissions ?? 0;
  const overhead = projection.operatingCosts?.allocatedOverhead ?? 0;
  const contributionProfit = grossProfit == null ? null : money(grossProfit - processing - commissions);
  const operatingProfit = contributionProfit == null ? null : money(contributionProfit - overhead);
  const recommendedMinimumPrice = commissionInclusiveMinimum(total, targetRate, { paymentProcessingFees: processing, salesCommissions: commissions, allocatedOverhead: overhead });
  return {
    ...projection,
    periodLabel: periodLabel?.trim() || projection.periodLabel,
    price: customerPrice,
    directCosts: { ...direct },
    grossProfit,
    grossMarginPercent,
    contributionProfit,
    contributionMarginPercent: contributionProfit == null || customerPrice <= 0 ? null : money((contributionProfit / customerPrice) * 100),
    operatingProfit,
    operatingMarginPercent: operatingProfit == null || customerPrice <= 0 ? null : money((operatingProfit / customerPrice) * 100),
    recommendedMinimumPrice,
    differenceToRecommendedMinimum: recommendedMinimumPrice == null ? null : money(Math.max(0, recommendedMinimumPrice - customerPrice)),
    belowTargetMargin: recommendedMinimumPrice != null && customerPrice < recommendedMinimumPrice,
  };
}

export function validateManualTravelOverride(travel: Pick<TravelProjection, "origin" | "destination" | "roundTripMiles" | "roundTripMinutes">): { miles: number; minutes: number } {
  const miles = travel.roundTripMiles;
  const minutes = travel.roundTripMinutes;
  if (!Number.isFinite(miles) || !Number.isFinite(minutes) || miles == null || minutes == null) throw new Error("Enter both round-trip mileage and driving duration for a manual override.");
  if (miles < 0 || minutes < 0) throw new Error("Manual travel mileage and duration cannot be negative.");
  if ((miles === 0 || minutes === 0) && travel.origin.trim().toLowerCase() !== travel.destination.trim().toLowerCase()) throw new Error("Zero travel is only valid when the origin and destination are the same address.");
  return { miles: money(miles), minutes: money(minutes) };
}

function normalizeTravel(travel: TravelProjection, cleanerCount: number, settings: ProfitabilitySettings): TravelProjection {
  const vehicleCount = positiveInteger(travel.vehicleCount, settings.defaultVehiclesPerJob);
  return {
    ...travel,
    origin: travel.origin.trim() || settings.travelOrigin,
    destination: travel.destination.trim(),
    roundTripMiles: travel.roundTripMiles == null ? null : money(nonNegative(travel.roundTripMiles)),
    roundTripMinutes: travel.roundTripMinutes == null ? null : money(nonNegative(travel.roundTripMinutes)),
    vehicleCount,
    travelingEmployeeCount: positiveInteger(travel.travelingEmployeeCount, cleanerCount),
    companyRequiredTravelIsCompensable: Boolean(travel.companyRequiredTravelIsCompensable),
  };
}
