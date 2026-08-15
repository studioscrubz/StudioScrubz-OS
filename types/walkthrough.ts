import type { Client } from "@/types/client";
import type { Estimate, EstimateDivision, EstimateWithRelations } from "@/types/estimate";
import type { Property } from "@/types/property";

export const WALKTHROUGH_STATUSES = ["New", "Scheduled", "Completed", "Proposal Ready", "Archived"] as const;
export type WalkthroughStatus = (typeof WALKTHROUGH_STATUSES)[number];
export type WalkthroughScopeItem = { id: string; label: string };
export type WalkthroughRecommendation = { id: string; text: string };
export type WalkthroughPhoto = { id: string; fileName: string; storagePath: string | null; caption: string | null };
export type WalkthroughMeasurements = {
  serviceType: string;
  serviceDescription: string;
  overallCondition: "" | "Light" | "Average" | "Heavy" | "Extreme";
  squareFeet: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  restrooms: number | null;
  kitchenAreas: number | null;
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

export type Walkthrough = {
  id: string;
  estimate_id: string | null;
  client_id: string | null;
  property_id: string | null;
  division: EstimateDivision;
  walkthrough_date: string | null;
  walkthrough_time: string | null;
  status: WalkthroughStatus;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  assigned_to: string | null;
  notes: string | null;
  scope: WalkthroughScopeItem[];
  measurements: WalkthroughMeasurements;
  recommendations: WalkthroughRecommendation[];
  photos: WalkthroughPhoto[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
export type WalkthroughInput = Omit<Walkthrough, "id" | "created_at" | "updated_at" | "archived_at"> & { archived_at?: string | null };
export type WalkthroughUpdate = Partial<Omit<Walkthrough, "id" | "created_at" | "updated_at">>;
export type WalkthroughWithRelations = Walkthrough & { client: Client | null; property: Property | null; estimate: Estimate | null };
export type AvailableEstimate = EstimateWithRelations;

export const EMPTY_MEASUREMENTS: WalkthroughMeasurements = { serviceType: "", serviceDescription: "", overallCondition: "", squareFeet: null, bedrooms: null, bathrooms: null, floors: null, restrooms: null, kitchenAreas: null, specialtyAreas: "", accessRestrictions: "", parkingLoading: "", waterAccess: "", powerAccess: "", securityAlarm: "", pets: "", heavySoilBuildup: false, damageObserved: "", hazardsObserved: "" };
