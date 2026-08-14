import type { Client } from "@/types/client";

export const PROPERTY_TYPES = ["Residential", "Commercial"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export type Property = {
  id: string;
  client_id: string | null;
  property_name: string | null;
  property_type: PropertyType;
  address: string;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  square_feet: number | null;
  floors: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  access_instructions: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type PropertyInput = {
  client_id: string | null;
  property_name: string | null;
  property_type: PropertyType;
  address: string;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  square_feet: number | null;
  floors: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  access_instructions: string | null;
  notes: string | null;
};

export type PropertyWithClient = Property & { client: Client | null };
