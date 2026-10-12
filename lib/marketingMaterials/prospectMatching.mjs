// Shared industry and service-interest matching for existing prospect records.
// A prospect can match multiple flyers without changing its primary industry.
const aliases = {
  "Residential Cleaning": ["residential","homeowner","housekeeping","maid"],
  "Commercial Offices": ["office","corporate","business park","commercial"],
  "Property Management / Multifamily": ["property management","property manager","multifamily","apartment","hoa","porter"],
  "Post-Construction": ["construction","contractor","builder","developer","renovation","post construction"],
  "Airbnb / Short-Term Rentals": ["airbnb","short term","vacation rental","hospitality"],
  "Restaurants / Hospitality": ["restaurant","food service","hospitality","cafe","bar"],
  "Salons / Barbershops": ["salon","barber","beauty","hair"],
  "Gyms / Spas": ["gym","fitness","spa","wellness"],
  "Recording / Production Facilities": ["recording","studio","production","film","entertainment","music"],
  "Pressure Washing": ["pressure washing","power washing","property management","exterior","commercial"],
  "Luxury Property Care": ["luxury","estate","property management","real estate","realtor"],
  "Other": [],
};

/**
 * @param {{industry?:string|null,company_type?:string|null,services?:string[]|null}} prospect
 * @param {{category:string,title?:string,identifier?:string}} flyer
 */
export function prospectMatchesFlyer(prospect, flyer) {
  if (flyer.category === "Other") return false;
  const terms = aliases[flyer.category] ?? [];
  const searchable = [prospect.industry, prospect.company_type, ...(prospect.services ?? [])]
    .filter(Boolean).join(" ").toLowerCase().replace(/[-/]/g," ");
  const normalizedCategory = flyer.category.toLowerCase().replace(/[-/]/g," ");
  return searchable.includes(normalizedCategory) || terms.some(term => searchable.includes(term));
}

export function flyerIndustryCategories() { return Object.keys(aliases); }
