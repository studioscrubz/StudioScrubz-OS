import { defaultProfitabilitySettings, type ProfitabilitySettings } from "@/types/profitability";

export function validateProfitabilitySettings(value: unknown): ProfitabilitySettings {
  const defaults = defaultProfitabilitySettings();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Profitability settings are invalid.");
  const row = value as Record<string, unknown>;
  const number = (key: keyof ProfitabilitySettings, min: number, max: number, fallback: number) => {
    const parsed = Number(row[key]);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
    return parsed;
  };
  const rate = row.vehicleOperatingRatePerMile == null || row.vehicleOperatingRatePerMile === "" ? null : number("vehicleOperatingRatePerMile", 0, 1000, -1);
  if (rate === -1) throw new Error("Vehicle operating cost per mile must be a valid nonnegative amount.");
  const travelOrigin = typeof row.travelOrigin === "string" && row.travelOrigin.trim().length >= 12 && row.travelOrigin.trim().length <= 300
    ? row.travelOrigin.trim()
    : defaults.travelOrigin;
  return {
    version: 1,
    cleanerHourlyWage: number("cleanerHourlyWage", 0, 10_000, defaults.cleanerHourlyWage),
    employerBurdenRate: number("employerBurdenRate", 0, 0.95, defaults.employerBurdenRate),
    targetGrossMarginRate: number("targetGrossMarginRate", 0, 0.95, defaults.targetGrossMarginRate),
    travelOrigin,
    defaultVehiclesPerJob: Math.trunc(number("defaultVehiclesPerJob", 1, 20, defaults.defaultVehiclesPerJob)),
    vehicleOperatingRatePerMile: rate,
    companyRequiredTravelIsCompensable: row.companyRequiredTravelIsCompensable === true,
  };
}
