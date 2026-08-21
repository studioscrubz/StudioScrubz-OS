import type { Client } from "@/types/client";
import type { Property } from "@/types/property";
import type { CatalogAddonSnapshot } from "@/types/serviceCatalog";

export const ESTIMATE_DIVISIONS = ["Residential", "Commercial"] as const;
export type EstimateDivision = (typeof ESTIMATE_DIVISIONS)[number];
export type EstimateStatus = "Open" | "Archived";
export type Frequency = "One-Time" | "Daily" | "Weekly" | "Biweekly" | "Monthly";
export type Condition = "Light" | "Average" | "Heavy" | "Extreme";

export type CustomerInformation = {
  firstName: string;
  lastName: string;
  companyName: string;
  phone: string;
  email: string;
  address: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
};

export type PriceAdjustment = { label: string; amount: number; catalogAddonId?:string; description?:string|null; pricingModel?:string; unitLabel?:string|null };

export type ResidentialCalculatorInput = {
  division: "Residential";
  serviceType: string;
  frequency: Frequency;
  condition: Condition;
  squareFeet: number;
  bedrooms: number;
  bathrooms: number;
  occupied: boolean;
  pets: boolean;
  additionalDiscountPercent: number;
  taxRatePercent: number;
  addOns: string[];
  targetProjectDays?: number;
  workdayHours?: 8 | 10;
};

export type CommercialCalculatorInput = {
  division: "Commercial";
  commercialType: string;
  frequency: Frequency;
  squareFeet: number;
  floors: number;
  restrooms: number;
  kitchens: number;
  stations: number;
  units: number;
  condition: Condition;
  targetCompletionHours: number;
  workerHourlyPay: number;
  targetProfitMarginPercent: number;
  additionalDiscountPercent: number;
  taxRatePercent: number;
  additionalServices: string[];
  targetProjectDays?: number;
  workdayHours?: 8 | 10;
};

export type CalculatorInput = ResidentialCalculatorInput | CommercialCalculatorInput;

export type EstimateResult = {
  serviceName: string;
  serviceDescription: string | null;
  basePrice: number;
  adjustments: PriceAdjustment[];
  catalogAddons?: CatalogAddonSnapshot[];
  oneTimePrice: number;
  recurringDiscount: number;
  recurringDiscountPercent: number;
  manualDiscount: number;
  totalDiscount: number;
  taxes: number;
  finalPrice: number;
  monthlyPrice: number | null;
  visitsPerMonth: number;
  laborHours: number;
  crewSize: number;
  estimatedDuration: number;
  laborCost: number;
  supplyCost: number;
  estimatedProfit: number;
  scope: string[];
  calculatorInput: CalculatorInput;
};

export type Estimate = {
  id: string;
  estimate_number: string;
  client_id: string | null;
  property_id: string | null;
  division: EstimateDivision;
  customer_first_name: string | null;
  customer_last_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  frequency: Frequency;
  service_name: string | null;
  status: EstimateStatus;
  result: EstimateResult;
  notes: string | null;
  terms: string | null;
  sent_at: string | null;
  sent_to: string | null;
  sent_by: string | null;
  client_access_token: string | null;
  client_access_token_expires_at: string | null;
  client_delivery_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type EstimateInsert = Omit<Estimate, "id" | "created_at" | "updated_at" | "archived_at" | "sent_at" | "sent_to" | "sent_by" | "client_access_token" | "client_access_token_expires_at" | "client_delivery_snapshot"> & { archived_at?: string | null; sent_at?: string | null; sent_to?: string | null; sent_by?: string | null; client_access_token?: string | null; client_access_token_expires_at?: string | null; client_delivery_snapshot?: Record<string, unknown> | null };
export type EstimateUpdate = Partial<Omit<Estimate, "id" | "created_at" | "updated_at">>;
export type EstimateWithRelations = Estimate & { client: Client | null; property: Property | null };
