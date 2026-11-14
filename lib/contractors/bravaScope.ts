const standardScope = "Routine maintenance of accessible interior areas: dusting accessible surfaces; wiping counters, exterior cabinets, sinks, faucets, appliance exteriors and stovetop; cleaning bathrooms and mirrors; tidying accessible areas; vacuuming, sweeping, mopping, and emptying ordinary household trash. Limited dishes only as stated in BRAVA’s current checklist. Excludes heavy buildup, extensive dishes, interior appliances, interior windows, detailed blinds, balcony glass, hazardous materials, high-access work, and heavy furniture moving unless separately approved.";

const deepScope = "Standard Cleaning plus detailed attention to accessible buildup, baseboards, doors, frames, trim, fixtures, corners, and more intensive bathroom and kitchen cleaning. Interior windows and detailed blinds are included within the purchased package or tier. Exact blind counts, safe window access, exclusions, and appliance interiors follow the written job checklist. Exterior or high-rise window work requires separate written approval. The BRAVA-approved checklist and written job instructions govern each accepted appointment.";

export function bravaScopeHeading(service: string): string {
  switch (service.trim().toLowerCase()) {
    case "standard cleaning":
      return `BRAVA STANDARD CLEANING\n${standardScope}`;
    case "brazilian deep clean":
      return `BRAZILIAN DEEP CLEAN — INCLUDES INTERIOR WINDOW CLEANING AND DETAILED BLIND CLEANING\n${deepScope}`;
    default:
      return service.trim();
  }
}
