export const POST_CONSTRUCTION_SCOPE_OPTIONS = [
  "Kitchen", "Living Room / Great Room", "Dining Room", "Bedrooms", "Bathrooms", "Hallways", "Closets", "Stairways",
  "Laundry Room", "Garage", "Office / Study", "Basement", "Attic", "Balconies / Patios", "Exterior Areas",
  "Mechanical / Utility Rooms", "Common Areas", "Entire Property", "Other",
] as const;

const aliases: Record<string, string> = {
  "whole property": "Entire Property", "living areas": "Living Room / Great Room", "living room": "Living Room / Great Room",
  offices: "Office / Study", stairs: "Stairways", laundry: "Laundry Room", balconies: "Balconies / Patios", exterior: "Exterior Areas",
};

export function normalizePostConstructionScopeAreas(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [...new Set(entries.flatMap(item => typeof item === "string" ? item.split(/[\n,]/) : []).map(item => item.trim()).filter(Boolean).map(item => aliases[item.toLowerCase()] ?? item))];
}
