import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { calculateCommercialEstimate, calculateResidentialEstimate } from "@/lib/pricing/estimates";
import { getAvailableServiceAddons } from "@/lib/services/serviceCatalog";
import type { CommercialCalculatorInput, Condition, CustomerInformation, EstimateDivision, EstimateResult, Frequency, PreferredContactMethod, PreferredContactTime, ResidentialCalculatorInput } from "@/types/estimate";
import type { CatalogService, ServiceCatalogBundle } from "@/types/serviceCatalog";

export type PublicCatalog = { services: Array<{ name:string; description:string|null; division:EstimateDivision; recurring:boolean; fields:string[]; addons:Array<{name:string;description:string|null}> }> };
export type PublicRequest = { division:EstimateDivision; customer:CustomerInformation; preferredContactMethod:PreferredContactMethod; preferredContactTime:PreferredContactTime; service:string; frequency:Frequency; squareFeet:number; bedrooms?:number; bathrooms?:number; occupied?:boolean; pets?:boolean; floors?:number; restrooms?:number; kitchens?:number; stations?:number; units?:number; condition:Condition; addons:string[]; preferredDate?:string; notes?:string; website?:string };
export class PublicEstimateRequestError extends Error {}

export async function loadAuthoritativeCatalog():Promise<ServiceCatalogBundle>{
  const db=createSupabaseAdminClient();
  const [services,tiers,addons,addonLinks,recurringRules]=await Promise.all([
    db.from("services").select("*").eq("is_active",true).is("archived_at",null).order("display_order").order("service_name"),
    db.from("service_price_tiers").select("*").eq("is_active",true).order("display_order"),
    db.from("service_addons").select("*").eq("is_active",true).is("archived_at",null).order("display_order"),
    db.from("service_addon_links").select("service_id,addon_id"),
    db.from("recurring_pricing_rules").select("*").eq("is_active",true).order("frequency"),
  ]);
  for(const result of [services,tiers,addons,addonLinks,recurringRules])if(result.error)throw new Error("The active pricing catalog could not be loaded.");
  return{services:services.data!,tiers:tiers.data!,addons:addons.data!,addonLinks:addonLinks.data!,recurringRules:recurringRules.data!} as ServiceCatalogBundle;
}

export function publicCatalog(catalog:ServiceCatalogBundle):PublicCatalog{return{services:catalog.services.flatMap(service=>divisions(service).map(division=>({name:trimCleaning(service.service_name),description:service.description,division,recurring:service.is_recurring_available,fields:division==="Residential"?["bedrooms","bathrooms","occupied","pets"]:commercialFields(service),addons:getAvailableServiceAddons(catalog,service.id,division).map(addon=>({name:addon.addon_name,description:addon.description}))})))}}

export function calculatePublicRequest(input:PublicRequest,catalog:ServiceCatalogBundle):EstimateResult{
  validatePricingInput(input);
  const service=findService(catalog,input.division,input.service);
  const selected=new Set(getAvailableServiceAddons(catalog,service.id,input.division).map(x=>x.addon_name));
  if(input.addons.some(name=>!selected.has(name)))throw new PublicEstimateRequestError("One or more selected add-ons are unavailable.");
  if(input.division==="Residential"){
    const calculator:ResidentialCalculatorInput={division:"Residential",serviceType:trimCleaning(service.service_name),frequency:allowedFrequency(input.frequency,service),condition:input.condition,squareFeet:input.squareFeet,bedrooms:input.bedrooms??0,bathrooms:input.bathrooms??0,occupied:Boolean(input.occupied),pets:Boolean(input.pets),additionalDiscountPercent:0,taxRatePercent:0,addOns:input.addons};
    return calculateResidentialEstimate(calculator,catalog);
  }
  const config=service.pricing_config;
  const calculator:CommercialCalculatorInput={division:"Commercial",commercialType:trimCleaning(service.service_name),frequency:allowedFrequency(input.frequency,service),condition:input.condition,squareFeet:input.squareFeet,floors:input.floors??1,restrooms:input.restrooms??0,kitchens:input.kitchens??0,stations:input.stations??0,units:input.units??0,targetCompletionHours:number(config.default_target_completion_hours,4),workerHourlyPay:number(config.default_worker_hourly_pay,22),targetProfitMarginPercent:number(config.default_target_profit_margin_percent,35),additionalDiscountPercent:0,taxRatePercent:0,additionalServices:input.addons,targetProjectDays:3,workdayHours:8};
  return calculateCommercialEstimate(calculator,catalog);
}

export async function submitPublicRequest(input:PublicRequest,result:EstimateResult){
  validateSubmission(input);
  const db=createSupabaseAdminClient(); const email=normalize(input.customer.email); const phone=digits(input.customer.phone);
  const clients=await db.from("clients").select("*").is("archived_at",null);
  if(clients.error)throw new Error("Customer matching failed.");
  let client=clients.data.find(row=>(email&&normalize(row.email)===email)||(phone&&digits(row.phone)===phone));
  if(!client){const created=await db.from("clients").insert({client_type:input.division,first_name:clean(input.customer.firstName),last_name:clean(input.customer.lastName),company_name:input.division==="Commercial"?clean(input.customer.companyName):null,phone:clean(input.customer.phone),email:clean(input.customer.email),status:"Lead",notes:null}).select().single();if(created.error)throw new Error("Customer creation failed.");client=created.data}
  const properties=await db.from("properties").select("*").eq("client_id",client.id).is("archived_at",null);if(properties.error)throw new Error("Property matching failed.");
  const location=normalizedLocation(input.customer);let property=properties.data.find(row=>normalizedLocation({address:row.address,addressLine2:row.address_line_2??"",city:row.city??"",state:row.state??"",zip:row.zip??""})===location);
  if(!property){const created=await db.from("properties").insert({client_id:client.id,property_name:null,property_type:input.division,address:input.customer.address.trim(),address_line_2:clean(input.customer.addressLine2),city:clean(input.customer.city),state:clean(input.customer.state),zip:clean(input.customer.zip),square_feet:input.squareFeet,floors:input.division==="Commercial"?input.floors??1:null,bedrooms:input.division==="Residential"?input.bedrooms??0:null,bathrooms:input.division==="Residential"?input.bathrooms??0:null,access_instructions:null,notes:null}).select().single();if(created.error)throw new Error("Property creation failed.");property=created.data}
  const authoritativeResult:EstimateResult={...result,submission:{source:"Customer Self-Service",preferredServiceDate:clean(input.preferredDate??""),preferredContactMethod:input.preferredContactMethod,preferredContactTime:input.preferredContactTime,submittedAt:new Date().toISOString()}};
  for(let attempt=0;attempt<5;attempt++){const estimateNumber=numberForToday();const created=await db.from("estimates").insert({estimate_number:estimateNumber,client_id:client.id,property_id:property.id,division:input.division,customer_first_name:clean(input.customer.firstName),customer_last_name:clean(input.customer.lastName),customer_phone:clean(input.customer.phone),customer_email:clean(input.customer.email),customer_address:input.customer.address.trim(),frequency:result.calculatorInput.frequency,service_name:result.serviceName,status:"Open",result:authoritativeResult,notes:clean(input.notes??""),terms:null}).select("estimate_number").single();if(!created.error)return{estimateNumber,service:result.serviceName,price:result.finalPrice,customerName:[input.customer.firstName,input.customer.lastName].filter(Boolean).join(" "),address:[input.customer.address,input.customer.addressLine2,input.customer.city,input.customer.state,input.customer.zip].filter(Boolean).join(", ")};if(created.error.code!=="23505")throw new Error("Estimate creation failed.")}
  throw new Error("An estimate number could not be generated. Please try again.");
}

function validatePricingInput(input:PublicRequest){if(!input||!["Residential","Commercial"].includes(input.division))throw new PublicEstimateRequestError("Choose Residential or Commercial.");if(!validNumber(input.squareFeet,100,1000000))throw new PublicEstimateRequestError("Enter at least 100 square feet to see pricing.");const counts=input.division==="Residential"?[input.bedrooms,input.bathrooms]:[input.floors,input.restrooms,input.kitchens,input.stations,input.units];if(counts.some(value=>!validNumber(value??0,0,10000)))throw new PublicEstimateRequestError("Enter valid property details to see pricing.");if(input.division==="Commercial"&&!validNumber(input.floors??1,1,1000))throw new PublicEstimateRequestError("Enter at least one floor to see pricing.");if(!["Light","Average","Heavy","Extreme"].includes(input.condition))throw new PublicEstimateRequestError("Choose a property condition to see pricing.");if(!Array.isArray(input.addons)||input.addons.length>30||input.addons.some(value=>typeof value!=="string"||value.length>200))throw new PublicEstimateRequestError("Invalid add-on selection.")}
function validateSubmission(input:PublicRequest){const c=input.customer;if(!c?.firstName?.trim()||!c.lastName?.trim()||!c.phone?.trim()||!/^\S+@\S+\.\S+$/.test(c.email??"")||!c.address?.trim()||!c.city?.trim()||!c.state?.trim()||!/^\d{5}(?:-\d{4})?$/.test(c.zip??""))throw new PublicEstimateRequestError("Complete the required contact and service-address fields.");if(!(["Call","Text","Email"] as unknown[]).includes(input.preferredContactMethod))throw new PublicEstimateRequestError("Choose a valid preferred contact method.");if(!(["Anytime","Morning","Afternoon","Evening"] as unknown[]).includes(input.preferredContactTime))throw new PublicEstimateRequestError("Choose a valid best time to contact.");if(input.division==="Commercial"&&!c.companyName?.trim())throw new PublicEstimateRequestError("Company name is required for commercial estimates.");if(typeof input.notes!=="undefined"&&(typeof input.notes!=="string"||input.notes.length>2000))throw new PublicEstimateRequestError("Special requests must be 2,000 characters or less.")}
function findService(catalog:ServiceCatalogBundle,division:EstimateDivision,name:string){const service=catalog.services.find(x=>(x.division===division||x.division==="Both")&&trimCleaning(x.service_name).toLowerCase()===name?.trim().toLowerCase());if(!service)throw new PublicEstimateRequestError("The selected service is unavailable.");return service}
function allowedFrequency(value:Frequency,service:CatalogService):Frequency{const allowed:Frequency[]=service.is_recurring_available?["One-Time","Daily","Weekly","Biweekly","Monthly"]:["One-Time"];if(!allowed.includes(value))throw new PublicEstimateRequestError("The selected frequency is unavailable for this service.");return value}
function commercialFields(service:CatalogService){const c=service.pricing_config;return [["floors","additional_floor_hours"],["restrooms","restroom_hours"],["kitchens","kitchen_hours"],["stations","station_hours"],["units","unit_hours"]].filter(([,key])=>number(c[key],0)>0).map(([field])=>field)}
function divisions(service:CatalogService):EstimateDivision[]{return service.division==="Both"?["Residential","Commercial"]:[service.division]}
function trimCleaning(value:string){return value.replace(/ Cleaning$/i,"").trim()} function number(value:unknown,fallback:number){const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?parsed:fallback}
function validNumber(value:unknown,min:number,max:number){return typeof value==="number"&&Number.isFinite(value)&&value>=min&&value<=max}
function clean(value:string){return value.trim()||null} function normalize(value:string|null){return value?.trim().toLowerCase().replace(/\s+/g," ")??""} function digits(value:string|null){return value?.replace(/\D/g,"")??""}
function normalizedLocation(value:{address:string;addressLine2:string;city:string;state:string;zip:string}){return[value.address,value.addressLine2,value.city,value.state,value.zip].map(x=>normalize(x).replace(/[^a-z0-9]/g,"")).join("|")}
function numberForToday(){const d=new Date(),day=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;return`EST-${day}-${String(Math.floor(Math.random()*10000)).padStart(4,"0")}`}
