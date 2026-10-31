export const PROFITABILITY_SETTINGS_VERSION = 1 as const;
export const PROFITABILITY_HOME_BASE = "9110 De Soto Ave, Chatsworth, CA 91311";

export type ProfitabilitySettings = {
  version: 1;
  cleanerHourlyWage: number;
  employerBurdenRate: number;
  targetGrossMarginRate: number;
  travelOrigin: string;
  defaultVehiclesPerJob: number;
  vehicleOperatingRatePerMile: number | null;
  companyRequiredTravelIsCompensable: boolean;
};

export type TravelVerification = "Verified" | "Manual" | "Unverified" | "Unavailable";

export type TravelProjection = {
  origin: string;
  destination: string;
  verification: TravelVerification;
  provider: "Geoapify" | "Manual" | null;
  roundTripMiles: number | null;
  roundTripMinutes: number | null;
  vehicleCount: number;
  travelingEmployeeCount: number;
  companyRequiredTravelIsCompensable: boolean;
  warning: string | null;
  calculatedAt: string | null;
};

export type ProfitabilityDirectCosts = {
  loadedCleaningLabor: number;
  vehicleOperating: number | null;
  compensableTravelLabor: number | null;
  legacyTravelLogistics: number;
  legacyProjectCosts: number;
  supplies: number;
  equipment: number;
  subcontractors: number;
  other: number;
  setupLabor: number;
  ownerLabor: number;
  parkingTolls: number;
  disposal: number;
};

export type ProfitabilityOperatingCosts = {
  paymentProcessingFees: number;
  salesCommissions: number;
  allocatedOverhead: number;
};

export type ProfitabilityAdjustments = {
  equipment: number;
  subcontractors: number;
  setupLabor: number;
  ownerLabor: number;
  parkingTolls: number;
  disposal: number;
  paymentProcessingFees: number;
  salesCommissions: number;
  allocatedOverhead: number;
  otherDirectExpenses: number;
};

export const emptyProfitabilityAdjustments = (): ProfitabilityAdjustments => ({
  equipment: 0, subcontractors: 0, setupLabor: 0, ownerLabor: 0,
  parkingTolls: 0, disposal: 0, paymentProcessingFees: 0,
  salesCommissions: 0, allocatedOverhead: 0, otherDirectExpenses: 0,
});

export type ProfitabilityProjection = {
  version: 1;
  periodLabel: string;
  visitsPerPeriod: number;
  legacyTravelIncludesDriving: boolean;
  price: number;
  cleanerCount: number;
  hoursPerCleaner: number;
  estimatedLaborHours: number;
  hourlyWage: number;
  employerBurdenRate: number;
  loadedHourlyLaborCost: number;
  travel: TravelProjection;
  directCosts: ProfitabilityDirectCosts;
  operatingCosts: ProfitabilityOperatingCosts;
  contributionProfit: number | null;
  contributionMarginPercent: number | null;
  operatingProfit: number | null;
  operatingMarginPercent: number | null;
  travelCostsVerified: boolean;
  costComplete: boolean;
  totalEstimatedDirectCost: number | null;
  grossProfit: number | null;
  grossMarginPercent: number | null;
  targetGrossMarginPercent: number;
  recommendedMinimumPrice: number | null;
  differenceToRecommendedMinimum: number | null;
  belowTargetMargin: boolean;
};

export const defaultProfitabilitySettings = (): ProfitabilitySettings => ({
  version: PROFITABILITY_SETTINGS_VERSION,
  cleanerHourlyWage: 30,
  employerBurdenRate: 0.2,
  targetGrossMarginRate: 0.35,
  travelOrigin: PROFITABILITY_HOME_BASE,
  defaultVehiclesPerJob: 1,
  vehicleOperatingRatePerMile: null,
  companyRequiredTravelIsCompensable: true,
});
