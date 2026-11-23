import type {Property} from "@/types/property";
type RoomCounts=Pick<Property,"bedrooms"|"bathrooms">|null|undefined;
export function jobBedBathLabel(property:RoomCounts):string{
 const beds=property?.bedrooms;
 const baths=property?.bathrooms;
 return `Bedrooms: ${beds==null?"Not recorded":beds} · Bathrooms: ${baths==null?"Not recorded":baths}`;
}
export function jobBedBathCompact(property:RoomCounts):string{
 const beds=property?.bedrooms;
 const baths=property?.bathrooms;
 return `${beds==null?"?":beds} bed / ${baths==null?"?":baths} bath`;
}
