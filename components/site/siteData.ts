export const ESTIMATE_URL = "https://estimate.studioscrubz.com/";

export const siteNavigation = [
  ["Home", "/"],
  ["Services", "/#services"],
  ["Commercial", "/commercial"],
  ["Residential", "/residential"],
  ["About", "/about"],
  ["Contact", "/contact"],
] as const;

export const services = [
  { title: "Residential Cleaning", description: "Thoughtful one-time and recurring cleaning for kitchens, bathrooms, living spaces, floors, and everyday surfaces. The service level is tailored to your home’s condition and priorities.", href: "/residential" },
  { title: "Commercial Cleaning", description: "Reliable cleaning plans for offices, managed properties, community spaces, and other professional environments. Service is shaped around the property, traffic, and operating needs.", href: "/commercial" },
  { title: "Post-Construction Cleaning", description: "Detailed removal of construction dust, fine particles, light debris, and surface residue after building or renovation work. Scope is tailored to the project phase and readiness goals.", href: "/post-construction" },
  { title: "Move-In / Move-Out Cleaning", description: "A thorough reset for empty or mostly empty homes, apartments, and properties between occupants. Cleaning may include cabinets, closets, fixtures, baseboards, floors, kitchens, and bathrooms.", href: "/residential#move-cleaning" },
  { title: "Airbnb / Turnover Cleaning", description: "Consistent turnover support designed around presentation, timing, and guest-ready details. Each plan is coordinated around the property and its confirmed turnover needs.", href: "/residential#turnovers" },
  { title: "Property Management / Unit Turns", description: "Flexible cleaning for vacant units, leasing spaces, common areas, and portfolio-wide property needs. Service may include unit turns and shared spaces where applicable.", href: "/commercial#property-management" },
  { title: "Pressure Washing", description: "Exterior surface cleaning for suitable walkways, patios, entry areas, concrete, and shared property spaces. Surface condition and access are reviewed before the scope is confirmed.", href: "/pressure-washing" },
] as const;
