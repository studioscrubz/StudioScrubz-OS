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
  legacyTravelLogisticsCost?: number | null;
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
  const estimatedLaborHours = money(cleanerCount * hoursPerCleaner);
  const loadedHourlyLaborCost = money(hourlyWage * (1 + burdenRate));
  const loadedCleaningLabor = money(estimatedLaborHours * loadedHourlyLaborCost);
  const travel = normalizeTravel(input.travel, cleanerCount, settings);
  const rate = settings.vehicleOperatingRatePerMile == null ? null : nonNegative(settings.vehicleOperatingRatePerMile);
  const legacyTravelLogistics = money(nonNegative(input.legacyTravelLogisticsCost));
  const legacyTravelIncludesDriving = input.legacyTravelIncludesDriving === true && legacyTravelLogistics > 0;
  const vehicleOperating = legacyTravelIncludesDriving ? 0 : travel.roundTripMiles == null || rate == null ? null : money(travel.roundTripMiles * rate * travel.vehicleCount);
  const compensableTravelLabor = legacyTravelIncludesDriving || !travel.companyRequiredTravelIsCompensable
    ? 0
    : travel.roundTripMinutes == null
      ? null
      : money((travel.roundTripMinutes / 60) * travel.travelingEmployeeCount * loadedHourlyLaborCost);
  const directCosts: ProfitabilityDirectCosts = {
    loadedCleaningLabor,
    vehicleOperating,
    compensableTravelLabor,
    legacyTravelLogistics,
    supplies: money(nonNegative(input.supplies)),
    equipment: money(nonNegative(input.equipment)),
    subcontractors: money(nonNegative(input.subcontractors)),
    other: money(nonNegative(input.otherDirectExpenses)),
  };
  const travelCostsVerified = travel.verification === "Verified" || travel.verification === "Manual";
  const costComplete = vehicleOperating != null && compensableTravelLabor != null;
  const directValues = [directCosts.loadedCleaningLabor, directCosts.vehicleOperating, directCosts.compensableTravelLabor, directCosts.legacyTravelLogistics, directCosts.supplies, directCosts.equipment, directCosts.subcontractors, directCosts.other];
  const totalEstimatedDirectCost = costComplete
    ? money(directValues.reduce<number>((sum, value) => sum + (value ?? 0), 0))
    : null;
  const price = money(nonNegative(input.price));
  const grossProfit = totalEstimatedDirectCost == null ? null : money(price - totalEstimatedDirectCost);
  const grossMarginPercent = totalEstimatedDirectCost == null || price <= 0 ? null : money((grossProfit! / price) * 100);
  const recommendedMinimumPrice = totalEstimatedDirectCost == null || targetMarginRate == null || targetMarginRate >= 1
    ? null
    : money(totalEstimatedDirectCost / (1 - targetMarginRate));
  const differenceToRecommendedMinimum = recommendedMinimumPrice == null ? null : money(Math.max(0, recommendedMinimumPrice - price));
  return {
    version: 1,
    periodLabel: input.periodLabel?.trim() || "Per service visit",
    price,
    cleanerCount,
    hoursPerCleaner: money(hoursPerCleaner),
    estimatedLaborHours,
    hourlyWage: money(hourlyWage),
    employerBurdenRate: money(burdenRate * 100),
    loadedHourlyLaborCost,
    travel,
    directCosts,
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
  const recommendedMinimumPrice = total == null || targetRate >= 1 ? null : money(total / (1 - targetRate));
  return {
    ...projection,
    periodLabel: periodLabel?.trim() || projection.periodLabel,
    price: customerPrice,
    directCosts: { ...direct },
    grossProfit,
    grossMarginPercent,
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
