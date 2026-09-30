export const METERS_PER_MILE=1609.344;
export const DISCOVERY_MIN_RADIUS_METERS=500;
export const DISCOVERY_MAX_RADIUS_MILES=250;
export const DISCOVERY_MIN_RADIUS_MILES=DISCOVERY_MIN_RADIUS_METERS/METERS_PER_MILE;
export const DISCOVERY_MAX_RADIUS_METERS=Math.round(DISCOVERY_MAX_RADIUS_MILES*METERS_PER_MILE);
export const DISCOVERY_PROVIDER_TILE_RADIUS_METERS=25_000;
export const DISCOVERY_MAX_RESULTS=100;
export const DISCOVERY_RADIUS_OPTIONS_MILES=[1,2.5,5,10,15,25,50,100,150,250] as const;
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
export function milesToMeters(miles:number){return Math.round(miles*METERS_PER_MILE);}
export function metersToMiles(meters:number){return meters/METERS_PER_MILE;}
export function buildOverpassQuery(category:DiscoveryCategory,latitude:number,longitude:number,radiusMeters:number,keyword?:string){const boundedRadius=Math.min(radiusMeters,DISCOVERY_PROVIDER_TILE_RADIUS_METERS);const nameFilter=keyword?`["name"~"${escapeOverpass(keyword)}",i]`:"";const selectors=DISCOVERY_CATEGORIES[category].flatMap(([key,value])=>["node","way","relation"].map(type=>`${type}(around:${boundedRadius},${latitude},${longitude})["${key}"${value==="*"?"":`="${value}"`}]${nameFilter};`)).join("");return`[out:json][timeout:20];(${selectors});out center tags ${DISCOVERY_MAX_RESULTS};`;}
export function buildDiscoverySearchPoints(latitude:number,longitude:number,radiusMeters:number){if(radiusMeters<=DISCOVERY_PROVIDER_TILE_RADIUS_METERS)return[{latitude,longitude}];const spacing=DISCOVERY_PROVIDER_TILE_RADIUS_METERS*1.65,points=[{latitude,longitude}],latStep=spacing/111_320,lonScale=Math.max(.2,Math.cos(latitude*Math.PI/180)),lonStep=spacing/(111_320*lonScale),rings=Math.ceil(radiusMeters/spacing);for(let y=-rings;y<=rings;y++){for(let x=-rings;x<=rings;x++){if(x===0&&y===0)continue;const lat=latitude+y*latStep,lon=longitude+x*lonStep;if(haversineMeters(latitude,longitude,lat,lon)<=radiusMeters)points.push({latitude:lat,longitude:lon});}}return points.sort((a,b)=>haversineMeters(latitude,longitude,a.latitude,a.longitude)-haversineMeters(latitude,longitude,b.latitude,b.longitude));}
export function normalizeDiscoveryLocation(value:string){return value.trim().replace(/\s+/g," ").replace(/\s*,\s*/g,",").toLocaleLowerCase();}
export function filterDiscoveryResults<T extends {businessName:string;classification?:string}>(results:T[],filter:DiscoveryResultFilter,search:string){const query=search.trim().toLocaleLowerCase();return results.filter(result=>(filter==="All results"||result.classification===filter)&&(!query||result.businessName.toLocaleLowerCase().includes(query)));}
export function safeOpenStreetMapSourceUrl(value:string|null){if(!value)return null;try{const url=new URL(value);return url.protocol==="https:"&&url.hostname==="www.openstreetmap.org"&&/^\/(?:node|way|relation)\/\d+$/.test(url.pathname)?url.toString():null;}catch{return null;}}
function escapeOverpass(value:string){return value.replace(/[\\"]/g,match=>`\\${match}`).slice(0,80);}
export function haversineMeters(lat1:number,lon1:number,lat2:number,lon2:number){const rad=(n:number)=>n*Math.PI/180;const a=Math.sin(rad(lat2-lat1)/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(rad(lon2-lon1)/2)**2;return Math.round(12_742_000*Math.asin(Math.sqrt(a)));}
