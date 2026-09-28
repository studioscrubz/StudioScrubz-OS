export const fieldTextKeys = ["overallCondition", "specialtyAreas", "accessRestrictions", "parkingLoading", "waterAccess", "powerAccess", "securityAlarm", "pets", "damageObserved", "hazardsObserved"] as const;
export const fieldNumberKeys = ["squareFeet", "bedrooms", "bathrooms", "floors", "restrooms", "kitchenAreas"] as const;
export type FieldWalkthroughAnswer = "Yes" | "No" | "Unknown / Confirm Later" | "";
export type PostConstructionFieldAssessment = {
  sectionConfirmations?: Record<string, FieldWalkthroughAnswer>;
  answers?: Record<string, string | number | string[] | boolean | null>;
};
export type StandardResidentialFieldAssessment = {
  answers?: Record<string, string | string[] | boolean | null>;
};
export type DeepCleaningFieldAssessment = {
  answers?: Record<string, string | string[] | boolean | null>;
};
export type MoveInOutFieldAssessment = {
  answers?: Record<string, string | string[] | boolean | null>;
};
export type CommercialJanitorialFieldAssessment = {
  answers?: Record<string, string | string[] | number | boolean | null>;
};
export type PropertyManagementCommonAreasFieldAssessment = {
  answers?: Record<string, string | string[] | number | boolean | null>;
};
export type OfficeCleaningFieldAssessment = {
  answers?: Record<string, string | string[] | number | boolean | null>;
};
export type BarbershopSalonFieldAssessment = {
  answers?: Record<string, string | string[] | number | boolean | null>;
};
export type RetailCleaningFieldAssessment = {
  answers?: Record<string, string | string[] | number | boolean | null>;
};
export type EventVenueCleaningFieldAssessment = {
  answers?: Record<string, string | string[] | number | boolean | null>;
};
export type StandardResidentialContext = {
  customerProperty?: string | null;
  service?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  squareFeet?: number | null;
  pets?: string | null;
  currentCleanerVendor?: string | null;
  majorConcerns?: string | null;
  propertyContext?: string | null;
  accessConsiderations?: string | null;
  customerNotes?: string | null;
  walkthroughDateTime?: string | null;
  walkthroughMethod?: string | null;
};
export type FieldMeasurements = Partial<Record<(typeof fieldTextKeys)[number], string | null> & Record<(typeof fieldNumberKeys)[number], number | null> & {
  heavySoilBuildup: boolean;
  postConstructionAssessment: Record<string, unknown> & { fieldWalkthrough?: PostConstructionFieldAssessment };
  standardResidentialAssessment: Record<string, unknown> & { fieldWalkthrough?: StandardResidentialFieldAssessment };
  deepCleaningAssessment: Record<string, unknown> & { fieldWalkthrough?: DeepCleaningFieldAssessment };
  moveInOutAssessment: Record<string, unknown> & { fieldWalkthrough?: MoveInOutFieldAssessment };
  commercialJanitorialAssessment: Record<string, unknown> & { fieldWalkthrough?: CommercialJanitorialFieldAssessment };
  propertyManagementCommonAreasAssessment: Record<string, unknown> & { fieldWalkthrough?: PropertyManagementCommonAreasFieldAssessment };
  officeCleaningAssessment: Record<string, unknown> & { fieldWalkthrough?: OfficeCleaningFieldAssessment };
  barbershopSalonAssessment: Record<string, unknown> & { fieldWalkthrough?: BarbershopSalonFieldAssessment };
  retailCleaningAssessment: Record<string, unknown> & { fieldWalkthrough?: RetailCleaningFieldAssessment };
  eventVenueCleaningAssessment: Record<string, unknown> & { fieldWalkthrough?: EventVenueCleaningFieldAssessment };
}>;
export type FieldWalkthrough = { id: string; walkthrough_date: string; walkthrough_time: string; contact_name: string | null; company_name: string | null; phone: string | null; email: string | null; property: string; service: string | null; scope: Array<{id: string; label: string}>; included_addons: string[]; standard_residential_context: StandardResidentialContext; measurements: FieldMeasurements };
