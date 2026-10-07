import type {
  CustomerPhotoAssessmentSubmission,
  WalkthroughMeasurements,
  WalkthroughScopeItem,
} from "@/types/walkthrough";

export const CUSTOMER_SCOPE_OPTIONS = [
  "Kitchen", "Living Room / Great Room", "Dining Room", "Bedrooms",
  "Bathrooms", "Hallways", "Closets", "Stairways", "Laundry Room",
  "Garage", "Office / Study", "Basement", "Attic", "Balconies / Patios",
  "Exterior Areas", "Mechanical / Utility Rooms", "Common Areas",
  "Entire Property", "Other",
] as const;

export const CONDITION_CONCERNS = [
  "Heavy buildup", "Grease", "Soap / mineral buildup", "Heavy dust",
  "Construction / remodel dust or debris", "Pet hair", "Stains / problem areas",
  "Unusually dirty areas",
] as const;

export type CustomerPhotoAssessmentInput = {
  propertyType: string;
  squareFeet: number | null;
  occupied: boolean | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areasInScope: string[];
  bedroomQuantity: number | null;
  bathroomQuantity: number | null;
  otherScope: string;
  areasExcluded: string;
  condition: WalkthroughMeasurements["overallCondition"];
  lastProfessionallyCleaned: string;
  conditionConcerns: string[];
  problemAreas: string;
  stairs: string;
  elevator: string;
  parkingAccess: string;
  gateAccessInstructions: string;
  pets: string;
  waterAvailable: string;
  powerAvailable: string;
  specialItems: string[];
  serviceAnswers: Record<string, string | boolean>;
  certificationAccepted: boolean;
};

export class CustomerPhotoAssessmentError extends Error {}

const text = (value: unknown, max = 2000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const count = (value: unknown, max = 100) => {
  if (value === null || value === "" || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= max ? number : null;
};
const uniqueStrings = (value: unknown, allowed?: readonly string[]) =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter((item) => item && (!allowed || allowed.includes(item))).slice(0, 50))]
    : [];

export function normalizeCustomerPhotoAssessment(value: unknown): CustomerPhotoAssessmentInput {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const condition = text(row.condition, 20);
  const serviceAnswers = Object.fromEntries(
    Object.entries(row.serviceAnswers && typeof row.serviceAnswers === "object" ? row.serviceAnswers as Record<string, unknown> : {})
      .filter(([, answer]) => typeof answer === "boolean" || typeof answer === "string")
      .slice(0, 30)
      .map(([key, answer]) => [text(key, 80), typeof answer === "string" ? text(answer, 1000) : answer]),
  ) as Record<string, string | boolean>;
  return {
    propertyType: text(row.propertyType, 100),
    squareFeet: count(row.squareFeet, 10000000),
    occupied: typeof row.occupied === "boolean" ? row.occupied : null,
    bedrooms: count(row.bedrooms),
    bathrooms: count(row.bathrooms),
    areasInScope: uniqueStrings(row.areasInScope, CUSTOMER_SCOPE_OPTIONS),
    bedroomQuantity: count(row.bedroomQuantity),
    bathroomQuantity: count(row.bathroomQuantity),
    otherScope: text(row.otherScope, 300),
    areasExcluded: text(row.areasExcluded),
    condition: (["Light", "Average", "Heavy", "Extreme"] as string[]).includes(condition) ? condition as CustomerPhotoAssessmentInput["condition"] : "",
    lastProfessionallyCleaned: text(row.lastProfessionallyCleaned, 200),
    conditionConcerns: uniqueStrings(row.conditionConcerns, CONDITION_CONCERNS),
    problemAreas: text(row.problemAreas),
    stairs: text(row.stairs, 300),
    elevator: text(row.elevator, 300),
    parkingAccess: text(row.parkingAccess, 1000),
    gateAccessInstructions: text(row.gateAccessInstructions, 1000),
    pets: text(row.pets, 500),
    waterAvailable: text(row.waterAvailable, 100),
    powerAvailable: text(row.powerAvailable, 100),
    specialItems: uniqueStrings(row.specialItems),
    serviceAnswers,
    certificationAccepted: row.certificationAccepted === true,
  };
}

export function validateCustomerPhotoAssessment(input: CustomerPhotoAssessmentInput) {
  if (!input.propertyType) throw new CustomerPhotoAssessmentError("Select the property type.");
  if (!input.squareFeet || input.squareFeet < 1) throw new CustomerPhotoAssessmentError("Enter the approximate square footage.");
  if (input.occupied === null) throw new CustomerPhotoAssessmentError("Select whether the property is occupied or vacant.");
  if (!input.areasInScope.length) throw new CustomerPhotoAssessmentError("Select at least one area in scope.");
  if (input.areasInScope.includes("Other") && !input.otherScope) throw new CustomerPhotoAssessmentError("Describe the other area in scope.");
  if (!input.condition) throw new CustomerPhotoAssessmentError("Describe the property's current condition.");
  if (!input.certificationAccepted) throw new CustomerPhotoAssessmentError("Confirm the submission acknowledgment before submitting.");
}

export function customerScope(input: CustomerPhotoAssessmentInput): WalkthroughScopeItem[] {
  return input.areasInScope.map((label) => {
    const quantity = label === "Bedrooms" ? input.bedroomQuantity : label === "Bathrooms" ? input.bathroomQuantity : null;
    const detail = label === "Other" ? input.otherScope : quantity ? `${label} (${quantity})` : label;
    return { id: `customer-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, label: detail };
  });
}

export function customerSubmission(input: CustomerPhotoAssessmentInput, now: string): CustomerPhotoAssessmentSubmission {
  return {
    version: 1, submittedAt: now, certifiedAt: now, certificationAccepted: true,
    propertyType: input.propertyType, areasInScope: input.areasInScope,
    bedroomQuantity: input.bedroomQuantity, bathroomQuantity: input.bathroomQuantity, otherScope: input.otherScope,
    areasExcluded: input.areasExcluded, lastProfessionallyCleaned: input.lastProfessionallyCleaned,
    conditionConcerns: input.conditionConcerns, problemAreas: input.problemAreas,
    stairs: input.stairs, elevator: input.elevator, parkingAccess: input.parkingAccess,
    gateAccessInstructions: input.gateAccessInstructions, pets: input.pets,
    waterAvailable: input.waterAvailable, powerAvailable: input.powerAvailable,
    specialItems: input.specialItems, serviceAnswers: input.serviceAnswers,
    reviewStatus: "Pending Review", reviewNote: null, reviewedAt: null, reviewedBy: null,
  };
}

export function guidedPhotoPrompts(serviceName: string, areas: string[], concerns: string[]) {
  const prompts = areas.flatMap((area) => {
    if (area === "Kitchen") return ["Kitchen overview, counters, appliances, and floor"];
    if (area === "Bathrooms") return ["Bathroom overview, shower/tub, fixtures, and floor"];
    if (area === "Bedrooms") return ["Representative bedroom overview photos"];
    return [`Clear overview of ${area.toLowerCase()}`];
  });
  if (concerns.length) prompts.push("Close-up of each heavy buildup or problem area");
  if (/post[- ]construction|construction/i.test(serviceName)) prompts.push("Representative dust/debris, floors, windows/glass, cabinetry, appliances, and residue");
  if (/pressure/i.test(serviceName)) prompts.push("Wide and close-up views of each exterior surface, plus water/access points");
  return [...new Set(prompts)].slice(0, 8);
}

export function serviceQuestionKind(serviceName: string) {
  if (/post[- ]construction|construction/i.test(serviceName)) return "post-construction";
  if (/move[- ]?in|move[- ]?out/i.test(serviceName)) return "move";
  if (/pressure/i.test(serviceName)) return "pressure";
  return "general";
}
