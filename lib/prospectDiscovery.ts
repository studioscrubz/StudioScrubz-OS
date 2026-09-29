export const DISCOVERY_MAX_RADIUS_METERS=25_000;
export const DISCOVERY_MAX_RESULTS=100;
export const DISCOVERY_CATEGORIES={
  "Property Management / Multifamily":[["building","apartments"],["office","property_management"]],
  "Commercial Offices":[["office","*"]],
  "Post-Construction / Contractors":[["craft","*"]],
  "Airbnb / Short-Term Rentals":[["tourism","guest_house"],["tourism","apartment"],["tourism","chalet"]],
  "Restaurants / Hospitality":[["amenity","restaurant"],["amenity","cafe"],["amenity","bar"],["amenity","fast_food"],["tourism","hotel"]],
  "Salons / Barbershops":[["shop","hairdresser"],["shop","beauty"]],
  "Gyms / Spas":[["leisure","fitness_centre"],["leisure","sports_centre"],["shop","massage"]],
  "Recording / Production Facilities":[["studio","audio"],["amenity","studio"]],
  "Luxury Property Care":[["tourism","resort"],["building","hotel"]],
  "Pressure Washing Opportunities":[["amenity","car_wash"],["craft","cleaning"]],
  "Other Commercial":[["shop","*"]],
} as const;
export type DiscoveryCategory=keyof typeof DISCOVERY_CATEGORIES;
export type DiscoveryResultFilter="All results"|"New"|"Possible Duplicate"|"Exact Duplicate";
export const discoveryCategories=(Object.keys(DISCOVERY_CATEGORIES) as DiscoveryCategory[]).map(key=>({key,label:key}));
export const discoveryResultFilters:DiscoveryResultFilter[]=["All results","New","Possible Duplicate","Exact Duplicate"];
export function isDiscoveryCategory(value:string):value is DiscoveryCategory{return value in DISCOVERY_CATEGORIES;}
export function buildOverpassQuery(category:DiscoveryCategory,latitude:number,longitude:number,radius:number,keyword?:string){const nameFilter=keyword?`["name"~"${escapeOverpass(keyword)}",i]`:"";const selectors=DISCOVERY_CATEGORIES[category].flatMap(([key,value])=>["node","way","relation"].map(type=>`${type}(around:${radius},${latitude},${longitude})["${key}"${value==="*"?"":`="${value}"`}]${nameFilter};`)).join("");return`[out:json][timeout:20];(${selectors});out center tags ${DISCOVERY_MAX_RESULTS};`;}
export function normalizeDiscoveryLocation(value:string){return value.trim().replace(/\s+/g," ").replace(/\s*,\s*/g,",").toLocaleLowerCase();}
export function filterDiscoveryResults<T extends {businessName:string;classification?:string}>(results:T[],filter:DiscoveryResultFilter,search:string){const query=search.trim().toLocaleLowerCase();return results.filter(result=>(filter==="All results"||result.classification===filter)&&(!query||result.businessName.toLocaleLowerCase().includes(query)));}
export function safeOpenStreetMapSourceUrl(value:string|null){if(!value)return null;try{const url=new URL(value);return url.protocol==="https:"&&url.hostname==="www.openstreetmap.org"&&/^\/(?:node|way|relation)\/\d+$/.test(url.pathname)?url.toString():null;}catch{return null;}}
function escapeOverpass(value:string){return value.replace(/[\\"]/g,match=>`\\${match}`).slice(0,80);}
export function haversineMeters(lat1:number,lon1:number,lat2:number,lon2:number){const rad=(n:number)=>n*Math.PI/180;const a=Math.sin(rad(lat2-lat1)/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(rad(lon2-lon1)/2)**2;return Math.round(12_742_000*Math.asin(Math.sqrt(a)));}
