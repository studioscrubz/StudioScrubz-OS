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
  supplies: number;
  equipment: number;
  subcontractors: number;
  other: number;
};

export type ProfitabilityProjection = {
  version: 1;
  periodLabel: string;
  price: number;
  cleanerCount: number;
  hoursPerCleaner: number;
  estimatedLaborHours: number;
  hourlyWage: number;
  employerBurdenRate: number;
  loadedHourlyLaborCost: number;
  travel: TravelProjection;
  directCosts: ProfitabilityDirectCosts;
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
