import type { EstimateResult } from "@/types/estimate";
import type { ProposalResult } from "@/types/proposal";
import type { Frequency } from "@/types/estimate";
import { estimatedMonthlyTotal } from "@/lib/scheduling/frequency";

export function withAuthoritativeEstimatePrice(result: EstimateResult, manualPrice: number | null): EstimateResult {
  const calculatedFinalPrice = result.calculatedFinalPrice ?? result.finalPrice;
  const finalPrice = manualPrice === null ? calculatedFinalPrice : money(manualPrice);
  return {
    ...result,
    calculatedFinalPrice,
    manualPrice,
    finalPrice,
    monthlyPrice: estimatedMonthlyTotal(finalPrice, result.calculatorInput.frequency),
    estimatedProfit: money(result.estimatedProfit + finalPrice - result.finalPrice),
  };
}

export function withAuthoritativeProposalPrice(result: ProposalResult, manualPrice: number | null, frequency: Frequency): ProposalResult {
  const calculatedPerVisitTotal = result.calculatedPerVisitTotal ?? result.perVisitTotal;
  const perVisitTotal = manualPrice === null ? calculatedPerVisitTotal : money(manualPrice);
  return {
    ...result,
    calculatedPerVisitTotal,
    manualPerVisitTotal: manualPrice,
    perVisitTotal,
    monthlyTotal: estimatedMonthlyTotal(perVisitTotal, frequency),
    estimatedProfit: money(result.estimatedProfit + perVisitTotal - result.perVisitTotal),
  };
}

export function withPreservedProposalPrice(result: ProposalResult, storedPrice: number, frequency: Frequency): ProposalResult {
  const perVisitTotal=money(storedPrice);
  return {
    ...result,
    calculatedPerVisitTotal: result.calculatedPerVisitTotal ?? result.perVisitTotal,
    manualPerVisitTotal: null,
    perVisitTotal,
    monthlyTotal: estimatedMonthlyTotal(perVisitTotal, frequency),
    estimatedProfit: money(result.estimatedProfit + perVisitTotal - result.perVisitTotal),
  };
}

function money(value: number) {
  return Math.round(Math.max(0, value) * 100) / 100;
}
