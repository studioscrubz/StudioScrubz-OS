import type { Condition } from "@/types/estimate";
import type { CatalogAddonSnapshot, ServiceAddon } from "@/types/serviceCatalog";
import type { FieldMeasurements } from "@/types/fieldWalkthrough";

export const ASSESSMENT_PRICING_INTERPRETER_VERSION = 1 as const;
export type AssessmentPricingEvidence = { key: string; value: string; scope: "overall" | "local" };
export type AssessmentLaborPlan = { durationLabel: string | null; minimumHours: number | null; maximumHours: number | null; minimumCrew: number | null; crewOpenEnded: boolean; level: string | null };
export type AssessmentAddonSuggestion = { catalogAddonId: string; name: string; disposition: "Pending" | "Included" | "Not Included" };
export type AssessmentPricingInterpretation = {
  version: typeof ASSESSMENT_PRICING_INTERPRETER_VERSION;
  recommendedCondition: Condition | null;
  conditionEvidence: AssessmentPricingEvidence[];
  laborPlan: AssessmentLaborPlan;
  laborEvidence: string[];
  suggestedAddons: AssessmentAddonSuggestion[];
  explanation: string[];
};

const assessmentKeys = [
  "postConstructionAssessment", "standardResidentialAssessment", "deepCleaningAssessment", "moveInOutAssessment",
  "commercialJanitorialAssessment", "propertyManagementCommonAreasAssessment", "officeCleaningAssessment",
  "barbershopSalonAssessment", "retailCleaningAssessment", "eventVenueCleaningAssessment",
  "warehouseCleaningAssessment", "restaurantCleaningAssessment",
] as const;

export function interpretAssessmentPricing(measurements: FieldMeasurements, addons: ServiceAddon[] = [], prior?: AssessmentPricingInterpretation | null): AssessmentPricingInterpretation {
  const answers = assessmentAnswers(measurements);
  const evidence = conditionEvidence(answers);
  const recommendedCondition = rollUpCondition(evidence);
  const laborPlan = interpretLabor(answers);
  const selected = new Set((measurements.catalogAddons ?? []).map(item => item.catalogAddonId));
  const priorExcluded = new Set((prior?.suggestedAddons ?? []).filter(item => item.disposition === "Not Included").map(item => item.catalogAddonId));
  const requested = array(answers.recommendedServices);
  const suggestedAddons = addons.filter(addon => requested.some(value => normalize(value) === normalize(addon.addon_name))).map(addon => ({
    catalogAddonId: addon.id,
    name: addon.addon_name,
    disposition: selected.has(addon.id) ? "Included" as const : priorExcluded.has(addon.id) ? "Not Included" as const : "Pending" as const,
  }));
  const laborEvidence = [laborPlan.level && `Expected labor: ${laborPlan.level}`, laborPlan.durationLabel && `Estimated duration: ${laborPlan.durationLabel}`, laborPlan.minimumCrew && `Recommended crew: ${laborPlan.crewOpenEnded ? `${laborPlan.minimumCrew}+` : laborPlan.minimumCrew}`].filter((item): item is string => Boolean(item));
  return {
    version: ASSESSMENT_PRICING_INTERPRETER_VERSION,
    recommendedCondition,
    conditionEvidence: evidence,
    laborPlan,
    laborEvidence,
    suggestedAddons,
    explanation: [recommendedCondition ? `One ${recommendedCondition} condition input is recommended from ${evidence.length} condition finding${evidence.length === 1 ? "" : "s"}.` : "No assessment condition recommendation yet.", ...(laborEvidence.length ? ["Labor observations are advisory and do not create an arbitrary surcharge."] : [])],
  };
}

export function assessmentAnswers(measurements: FieldMeasurements): Record<string, unknown> {
  for (const key of assessmentKeys) {
    const assessment = measurements[key] as { fieldWalkthrough?: { answers?: Record<string, unknown> } } | undefined;
    if (assessment?.fieldWalkthrough?.answers) return assessment.fieldWalkthrough.answers;
  }
  return {};
}

export function rollUpCondition(evidence: AssessmentPricingEvidence[]): Condition | null {
  const overall = evidence.find(item => item.scope === "overall");
  let rank = overall ? severity(overall.value) : 0;
  const local = evidence.filter(item => item.scope === "local");
  const serious = local.filter(item => severity(item.value) >= 2);
  const extreme = local.filter(item => severity(item.value) >= 3);
  if (local.length >= 2 && serious.length >= 2 && serious.length / local.length >= 0.5) rank = Math.max(rank, 2);
  if (local.length >= 2 && extreme.length >= 2 && extreme.length / local.length >= 0.5) rank = Math.max(rank, 3);
  if (!overall && !local.length) return null;
  return (["Light", "Average", "Heavy", "Extreme"] as const)[rank];
}

function conditionEvidence(answers: Record<string, unknown>): AssessmentPricingEvidence[] {
  return Object.entries(answers).flatMap(([key, raw]) => {
    if (typeof raw !== "string" || severity(raw) < 0) return [];
    const conditionKey = key === "overallCondition" || /condition$/i.test(key) || /^(buildupLevel|dustCondition|debrisCondition)$/i.test(key);
    if (!conditionKey || /serviceSuitable/i.test(key) || raw === "Not applicable" || raw === "Not present") return [];
    return [{ key, value: raw, scope: key === "overallCondition" ? "overall" as const : "local" as const }];
  });
}

function severity(value: string): number {
  const normalized = normalize(value);
  if (normalized === "light") return 0;
  if (["average", "moderate"].includes(normalized)) return 1;
  if (normalized === "heavy") return 2;
  if (["extreme", "severe", "excessive", "restoration level attention"].includes(normalized)) return 3;
  return -1;
}

function interpretLabor(answers: Record<string, unknown>): AssessmentLaborPlan {
  const durationLabel = typeof answers.serviceDuration === "string" ? answers.serviceDuration : null;
  const duration = durationLabel ? durationRange(durationLabel) : [null, null] as const;
  const crewLabel = typeof answers.recommendedCrew === "string" ? answers.recommendedCrew : null;
  const minimumCrew = crewLabel && /^(1|2|3|4\+)$/.test(crewLabel) ? Number.parseInt(crewLabel, 10) : null;
  return { durationLabel, minimumHours: duration[0], maximumHours: duration[1], minimumCrew, crewOpenEnded: crewLabel === "4+", level: typeof answers.laborLevel === "string" ? answers.laborLevel : null };
}

function durationRange(value: string): readonly [number | null, number | null] {
  if (value === "Under 2 hours") return [null, 2];
  if (/^2[–-]4 hours$/.test(value)) return [2, 4];
  if (/^4[–-]6 hours$/.test(value)) return [4, 6];
  if (/^6[–-]8 hours$/.test(value)) return [6, 8];
  if (value === "8+ hours") return [8, null];
  return [null, null];
}
function normalize(value: string) { return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function array(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }

export function confirmedAddonSnapshot(addon: ServiceAddon, quantity = 1): CatalogAddonSnapshot {
  const pricingType = addon.pricing_config.pricing_type === "Per Unit" ? "Per Unit" : "Flat Price";
  const unitPrice = Number(addon.pricing_config.unit_price ?? addon.price);
  return { id: addon.id, catalogAddonId: addon.id, name: addon.addon_name, description: addon.description, price: addon.price, pricingModel: addon.pricing_model, unitLabel: addon.unit_label, pricingType, quantity, unitName: String(addon.pricing_config.unit_name ?? addon.unit_label ?? "").trim() || null, unitPrice, lineTotal: pricingType === "Per Unit" ? quantity * unitPrice : addon.price };
}
