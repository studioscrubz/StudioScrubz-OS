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
  { title: "Residential Cleaning", description: "Thoughtful recurring and one-time cleaning tailored to the way your household lives.", href: "/residential" },
  { title: "Commercial Cleaning", description: "Reliable janitorial and specialty cleaning plans for workplaces, properties, and community spaces.", href: "/commercial" },
  { title: "Post-Construction Cleaning", description: "Detailed dust, surface, fixture, and floor cleaning that helps turn active projects into ready spaces.", href: "/post-construction" },
  { title: "Move-In / Move-Out Cleaning", description: "A thorough reset for homes, apartments, and properties between chapters or occupants.", href: "/residential#move-cleaning" },
  { title: "Airbnb / Turnover Cleaning", description: "Consistent turnover support designed around presentation, timing, and guest-ready details.", href: "/residential#turnovers" },
  { title: "Property Management / Unit Turns", description: "Flexible service for vacant units, common areas, and portfolio-wide cleaning needs.", href: "/commercial#property-management" },
  { title: "Pressure Washing", description: "Exterior surface cleaning for walkways, patios, storefront areas, and shared property spaces.", href: "/pressure-washing" },
] as const;
