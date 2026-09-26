export const fieldTextKeys = ["overallCondition", "specialtyAreas", "accessRestrictions", "parkingLoading", "waterAccess", "powerAccess", "securityAlarm", "pets", "damageObserved", "hazardsObserved"] as const;
export const fieldNumberKeys = ["squareFeet", "bedrooms", "bathrooms", "floors", "restrooms", "kitchenAreas"] as const;
export type FieldWalkthroughAnswer = "Yes" | "No" | "Unknown / Confirm Later" | "";
export type PostConstructionFieldAssessment = {
  sectionConfirmations?: Record<string, FieldWalkthroughAnswer>;
  answers?: Record<string, string | number | string[] | boolean | null>;
};
export type FieldMeasurements = Partial<Record<(typeof fieldTextKeys)[number], string | null> & Record<(typeof fieldNumberKeys)[number], number | null> & {
  heavySoilBuildup: boolean;
  postConstructionAssessment: Record<string, unknown> & { fieldWalkthrough?: PostConstructionFieldAssessment };
}>;
export type FieldWalkthrough = { id: string; walkthrough_date: string; walkthrough_time: string; contact_name: string | null; company_name: string | null; phone: string | null; email: string | null; property: string; service: string | null; scope: Array<{id: string; label: string}>; measurements: FieldMeasurements };
