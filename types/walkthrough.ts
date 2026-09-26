import type { Client } from "@/types/client";
import type {
  CalculatorInput,
  Estimate,
  EstimateDivision,
  EstimateResult,
  EstimateWithRelations,
  Frequency,
} from "@/types/estimate";
import type { Property } from "@/types/property";
import type { OperationalPhoto } from "@/types/photo";
import type { CatalogAddonSnapshot } from "@/types/serviceCatalog";
import type { PostConstructionFieldAssessment } from "@/types/fieldWalkthrough";

export const WALKTHROUGH_STATUSES = [
  "New",
  "Scheduled",
  "Completed",
  "Proposal Ready",
  "Archived",
] as const;

export type WalkthroughStatus = (typeof WALKTHROUGH_STATUSES)[number];

export type WalkthroughContactMethod = "Phone" | "Text" | "Email";

export type AssessmentMethod =
  | "On-Site Walkthrough"
  | "Customer Photo Submission"
  | "In-Person Walkthrough";

export const ASSESSMENT_SALES_STAGES = [
  "New",
  "Qualification",
  "Contacting",
  "Assessment Method Required",
  "Walkthrough Scheduled",
  "Awaiting Customer Photos",
  "Assessment In Progress",
  "Pricing Review",
  "Proposal Ready",
  "Proposal Created",
  "Closed / Not Proceeding",
] as const;

export type AssessmentSalesStage =
  (typeof ASSESSMENT_SALES_STAGES)[number];

export type PostConstructionAssessment = {
  projectType:
    | ""
    | "New Construction"
    | "Renovation / Remodel"
    | "Tenant Improvement"
    | "Restoration"
    | "Other";

  propertyUse: "" | "Residential" | "Commercial";

  projectPhase:
    | ""
    | "Planning"
    | "Active Construction"
    | "Punch List"
    | "Substantially Complete"
    | "Ready for Cleaning";

  expectedConstructionCompletionDate: string | null;
  desiredReadinessDate: string | null;

  occupancyStatus: "" | "Vacant" | "Partially Occupied" | "Occupied";

  dustLevel: "" | "Light" | "Average" | "Heavy" | "Extreme";

  debrisCondition: "" | "None" | "Light" | "Moderate" | "Heavy";

  utilities: {
    water: boolean;
    electricity: boolean;
    restroom: boolean;
  };

  decisionMakerStatus:
    | ""
    | "Decision Maker"
    | "Influencer"
    | "Awaiting Decision Maker"
    | "Unknown";

  contactStatus:
    | ""
    | "Not Contacted"
    | "Attempting Contact"
    | "Contacted"
    | "Qualified"
    | "Not Qualified";

  nextFollowUpAt: string | null;

  roomsAreas: string[];
  detailedScope: string[];
  surfaceMaterials: string[];
  residues: string[];

  lightDebrisInScope: boolean;

  exclusions: string[];

  applianceInteriors: boolean;
  interiorCabinets: boolean;

  workingHourRestrictions: string;
  readinessBlockers: string;
  siteSafetyConcerns: string;
  customerPriorities: string;
  internalObservations: string;

  recommendedExclusions: string[];

  proposalNotes: string;

  /**
   * Shared guided Post-Construction walkthrough.
   *
   * This is the single questionnaire payload used by both:
   * - Management / Sales Assessment
   * - Assigned Crew Lead / Scrub Technician walkthrough
   *
   * Keeping this inside postConstructionAssessment ensures both interfaces
   * read and write the same saved answers.
   */
  fieldWalkthrough?: PostConstructionFieldAssessment;
};

export type WalkthroughScopeItem = {
  id: string;
  label: string;
};

export type WalkthroughRecommendation = {
  id: string;
  text: string;
};

export type WalkthroughPhoto = OperationalPhoto;

export type WalkthroughMeasurements = {
  serviceType: string;
  serviceDescription: string;

  catalogAddons?: CatalogAddonSnapshot[];

  requestSource: "Public Estimate" | null;
  requestedAt: string | null;

  preferredContactMethod: WalkthroughContactMethod | null;

  assessmentMethod?: AssessmentMethod | null;

  postConstructionAssessment?: PostConstructionAssessment;

  currentCleaningSituation?: string;
  majorServiceConcerns?: string;
  propertyContext?: string;
  desiredServiceDate?: string | null;
  salesNotes?: string;

  photoSubmissionStatus?: "Not Sent" | "Sent" | "Submitted";
  photoSubmittedAt?: string | null;

  estimateNumber: string | null;

  frequency?: Frequency | null;
  customIntervalDays?: number | null;

  overallCondition: "" | "Light" | "Average" | "Heavy" | "Extreme";

  squareFeet: number | null;
  bedrooms: number | null;
  bathrooms: number | null;

  occupied?: boolean | null;

  floors: number | null;
  restrooms: number | null;
  kitchenAreas: number | null;

  stations?: number | null;
  units?: number | null;

  targetCompletionHours?: number | null;
  workerHourlyPay?: number | null;
  targetProfitMarginPercent?: number | null;
  targetProjectDays?: number | null;
  workdayHours?: 8 | 10 | null;

  specialtyAreas: string;

  accessRestrictions: string;
  parkingLoading: string;
  waterAccess: string;
  powerAccess: string;
  securityAlarm: string;

  pets: string;

  heavySoilBuildup: boolean;

  damageObserved: string;
  hazardsObserved: string;
};

export type WalkthroughPricingReview = {
  version: 1;

  calculatorInput: CalculatorInput;
  estimateResult: EstimateResult;

  serviceId: string;
  serviceName: string;
  serviceDescription: string | null;

  frequency: Frequency;

  catalogAddons: CatalogAddonSnapshot[];

  scope: string[];

  finalReviewedPrice: number;

  reviewedAt: string;

  reviewedBy: {
    id: string;
    displayName: string;
  };
};

export type Walkthrough = {
  id: string;

  estimate_id: string | null;
  client_id: string | null;
  property_id: string | null;

  division: EstimateDivision;

  walkthrough_date: string | null;
  walkthrough_time: string | null;

  status: WalkthroughStatus;

  sales_stage?: AssessmentSalesStage;

  contact_name: string | null;
  phone: string | null;
  email: string | null;

  assigned_to: string | null;
  assigned_employee_id?: string | null;

  notes: string | null;

  scope: WalkthroughScopeItem[];

  measurements: WalkthroughMeasurements;

  recommendations: WalkthroughRecommendation[];

  photos: WalkthroughPhoto[];

  pricing_review: WalkthroughPricingReview | null;
  pricing_reviewed_at: string | null;
  pricing_reviewed_by: string | null;

  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type WalkthroughInput = Omit<
  Walkthrough,
  | "id"
  | "created_at"
  | "updated_at"
  | "archived_at"
  | "pricing_review"
  | "pricing_reviewed_at"
  | "pricing_reviewed_by"
> & {
  archived_at?: string | null;
};

export type WalkthroughUpdate = Partial<
  Omit<
    Walkthrough,
    | "id"
    | "created_at"
    | "updated_at"
    | "pricing_review"
    | "pricing_reviewed_at"
    | "pricing_reviewed_by"
    | "photos"
  >
>;

export type WalkthroughWithRelations = Walkthrough & {
  client: Client | null;
  property: Property | null;
  estimate: Estimate | null;
};

export type AvailableEstimate = EstimateWithRelations;

export const EMPTY_MEASUREMENTS: WalkthroughMeasurements = {
  serviceType: "",
  serviceDescription: "",

  requestSource: null,
  requestedAt: null,

  preferredContactMethod: null,

  assessmentMethod: null,

  currentCleaningSituation: "",
  majorServiceConcerns: "",
  propertyContext: "",
  desiredServiceDate: null,
  salesNotes: "",

  photoSubmissionStatus: "Not Sent",
  photoSubmittedAt: null,

  estimateNumber: null,

  overallCondition: "",

  squareFeet: null,
  bedrooms: null,
  bathrooms: null,
  floors: null,
  restrooms: null,
  kitchenAreas: null,

  specialtyAreas: "",

  accessRestrictions: "",
  parkingLoading: "",
  waterAccess: "",
  powerAccess: "",
  securityAlarm: "",

  pets: "",

  heavySoilBuildup: false,

  damageObserved: "",
  hazardsObserved: "",
};