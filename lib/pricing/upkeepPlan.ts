export type UpkeepPlanPricing = {
  standardCleaningValue: number;
  adjustmentPercent: number;
  upkeepVisitValue: number;
  visitsIncluded: 3;
  monthlyPackage: number;
};

export function calculateUpkeepPlan(standardCleaningValue: number, adjustmentPercent: number): UpkeepPlanPricing {
  if (!Number.isFinite(standardCleaningValue) || standardCleaningValue < 0) throw new Error("Standard Cleaning Value must be zero or greater.");
  if (!Number.isFinite(adjustmentPercent) || adjustmentPercent < 0 || adjustmentPercent > 40) throw new Error("Upkeep Adjustment must be between 0% and 40%.");
  const upkeepVisitValue = standardCleaningValue * (1 - adjustmentPercent / 100);
  return {
    standardCleaningValue: money(standardCleaningValue),
    adjustmentPercent,
    upkeepVisitValue: money(upkeepVisitValue),
    visitsIncluded: 3,
    monthlyPackage: money(upkeepVisitValue * 3),
  };
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}
