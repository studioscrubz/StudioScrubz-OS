export const MARKETING_MATERIAL_CATEGORIES=["Residential Cleaning","Commercial Offices","Property Management / Multifamily","Post-Construction","Airbnb / Short-Term Rentals","Restaurants / Hospitality","Salons / Barbershops","Gyms / Spas","Recording / Production Facilities","Pressure Washing","Luxury Property Care","Other"] as const;
export type MarketingMaterialCategory=(typeof MARKETING_MATERIAL_CATEGORIES)[number];
export type MarketingMaterial={identifier:string;title:string;description:string;category:MarketingMaterialCategory;internal_notes:string|null;current_version:number;is_active:boolean;created_by_user_id:string|null;created_by_name:string;updated_by_user_id:string|null;updated_by_name:string;created_at:string;updated_at:string};
export type MarketingMaterialVersion={id:string;material_identifier:string;version:number;media_type:"image/png"|"image/jpeg"|"image/webp"|"application/pdf";storage_path:string;original_filename:string;size_bytes:number;created_by_user_id:string|null;created_by_name:string;created_at:string};
export type MarketingMaterialCatalogItem=MarketingMaterial&{current:MarketingMaterialVersion;preview_url:string;download_url:string};
export type MarketingMaterialDelivery={id:string;material_identifier:string;material_version:number;material_version_id:string;material_title:string;media_type:string;storage_path:string;original_filename:string;client_id:string|null;recipient_kind:"Existing Client"|"New Prospect";recipient_name:string;recipient_company:string|null;recipient_email:string;recipient_phone:string|null;subject:string;message_body:string;status:"Prepared"|"Sent"|"Failed";provider:string;provider_message_id:string|null;failure_reason:string|null;sent_by_user_id:string;sent_by_name:string;client_communication_id:string|null;attempt_count:number;prepared_at:string;sent_at:string|null;updated_at:string};

/** Match prospect industry labels to approved flyer categories. Unmapped industries remain unfiltered. */
export function flyerCategoriesForIndustry(industry:string|null|undefined):string[]{
 const key=(industry??"").trim().toLowerCase();
 if(!key)return [];
 if(key.includes("property management")||key.includes("multifamily")||key.includes("real estate"))return ["Property Management / Multifamily","Luxury Property Care"];
 if(key.includes("airbnb")||key.includes("short-term")||key.includes("str management"))return ["Airbnb / Short-Term Rentals","Luxury Property Care"];
 if(key.includes("construct")||key.includes("contractor"))return ["Post-Construction"];
 if(key.includes("gym")||key.includes("fitness")||key.includes("spa"))return ["Gyms / Spas"];
 if(key.includes("recording")||key.includes("studio")||key.includes("production"))return ["Recording / Production Facilities"];
 if(key.includes("barber")||key.includes("salon"))return ["Salons / Barbershops"];
 if(key.includes("restaurant")||key.includes("hospitality")||key.includes("hotel"))return ["Restaurants / Hospitality"];
 if(key.includes("office")||key.includes("commercial"))return ["Commercial Offices"];
 if(key.includes("pressure wash"))return ["Pressure Washing"];
 if(key.includes("residential")||key.includes("home cleaning"))return ["Residential Cleaning"];
 if(key.includes("luxury"))return ["Luxury Property Care"];
 return [];
}
