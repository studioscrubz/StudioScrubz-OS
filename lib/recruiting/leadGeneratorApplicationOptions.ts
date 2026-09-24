export const LEAD_GENERATOR_CONTACT_INTERESTS = [
  "Homeowners / Residential",
  "Property Management / Multifamily",
  "General Contractors / Construction Companies",
  "Commercial Offices",
  "Restaurants / Hospitality",
  "Salons / Barbershops",
  "Gyms / Spas",
  "Airbnb / Short-Term Rentals",
  "Recording / Production Facilities",
  "Luxury Estates",
  "Other Local Businesses",
] as const;

export type LeadGeneratorContactInterest = typeof LEAD_GENERATOR_CONTACT_INTERESTS[number];

export function isLeadGeneratorContactInterest(value: unknown): value is LeadGeneratorContactInterest {
  return typeof value === "string" && (LEAD_GENERATOR_CONTACT_INTERESTS as readonly string[]).includes(value);
}
