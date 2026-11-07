import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calculateProfitability } from "@/lib/pricing/profitability";
import { validateProfitabilitySettings } from "@/lib/pricing/profitabilitySettings";
import type { TravelProjection } from "@/types/profitability";
import { sendResendEmail } from "@/lib/email/resend";
import { contractorContext,requireInternal,requireMaster,requirePartner,partnerOpportunity,internalOpportunity,
 audited,required,optional,money,uuid,handleContractorError,noCache,ContractorAccessError,
 type ContractorContext } from "@/lib/contractors/server";

type Input=Record<string,unknown>;
async function body(request:Request):Promise<Input>{
 const raw=await request.text();
 if(raw.length>30000)throw new ContractorAccessError("Request is too large.",413);
 const obj=JSON.parse(raw) as unknown;
 if(!obj||Array.isArray(obj)||typeof obj!=="object")throw new ContractorAccessError("Invalid request.",400);
 return obj as Input;
}
type LinkedJobStatus = {id:string;status:string;scheduled_date:string|null;start_time:string|null;completed_at?:string|null};
type LinkedInvoiceStatus = {id:string;job_id:string;status:string;total:number;amount_paid:number};
function effectiveOpportunityStatuses<T extends {id:string;status:string;linked_job_id:string|null;quality_approved_at?:string|null}>(
  opportunities:T[],jobs:LinkedJobStatus[],invoices:LinkedInvoiceStatus[],
):T[]{
 const jobsById=new Map(jobs.map(j=>[j.id,j]));
 const invoicesByJob=new Map<string,LinkedInvoiceStatus[]>();
 for(const invoice of invoices){
  const all=invoicesByJob.get(invoice.job_id)??[];
  all.push(invoice);invoicesByJob.set(invoice.job_id,all);
 }
 return opportunities.map(op=>{
  if(!op.linked_job_id||["Declined","Cancelled","Disputed"].includes(op.status))return op;
  const job=jobsById.get(op.linked_job_id);
  if(!job)return op;
  let status=op.status;
  if(job.status==="Cancelled"||job.status==="Archived")status="Cancelled";
  else if(job.status==="In Progress")status="In Progress";
  else if(job.status==="Scheduled"||job.status==="Crew Assigned")status="Scheduled";
  else if(job.status==="Ready to Schedule")status="Crew Assignment";
  else if(job.status==="Completed"){
   if(!op.quality_approved_at)status="Pending Quality Review";
   else{
    const linkedInvoices=invoicesByJob.get(job.id)??[];
    if(!linkedInvoices.length)status="Completed";
    else if(linkedInvoices.every(x=>Number(x.amount_paid)>=Number(x.total)&&Number(x.total)>0))status="Paid";
    else status="Invoiced";
   }
  }
  return {...op,status};
 });
}
async function list(ctx:ContractorContext){
 const db=ctx.admin;
 if(ctx.type==="internal"){
  const [companies,opportunities,offers,messages,invitations,assessments,members,documents]=await Promise.all([
   db.from("contractor_companies").select("*").order("created_at",{ascending:false}).limit(500),
   db.from("contractor_opportunities").select("*").order("created_at",{ascending:false}).limit(500),
   db.from("contractor_offers").select("*").order("created_at",{ascending:false}).limit(500),
   db.from("contractor_messages").select("*").order("created_at",{ascending:false}).limit(500),
   db.from("contractor_invitations").select("id,company_id,invited_email,member_role,expires_at,status,delivery_status,created_at,redeemed_at").order("created_at",{ascending:false}).limit(500),
   db.from("contractor_profitability").select("*").limit(500),
   db.from("contractor_members").select("id,company_id,email,member_role,is_active,joined_at").limit(500),
   db.from("contractor_documents").select("id,company_id,opportunity_id,file_name,mime_type,file_size,category,created_at").limit(500),
  ]);
  for(const item of [companies,opportunities,offers,messages,invitations,assessments,members,documents])if(item.error)throw item.error;
  const linkedIds=(opportunities.data??[]).map(x=>x.linked_job_id).filter((x):x is string=>Boolean(x));
  const [jobs,invoices]=await Promise.all([
   linkedIds.length?db.from("jobs").select("id,status,scheduled_date,start_time,completed_at,assigned_team,assigned_crew_id").in("id",linkedIds):Promise.resolve({data:[],error:null}),
   linkedIds.length?db.from("invoices").select("id,job_id,invoice_number,status,total,amount_paid,due_date,archived_at").in("job_id",linkedIds):Promise.resolve({data:[],error:null}),
  ]);
  if(jobs.error||invoices.error)throw jobs.error??invoices.error;
  return {role:ctx.role,companies:companies.data,opportunities:effectiveOpportunityStatuses(opportunities.data??[],jobs.data??[],invoices.data??[]),offers:offers.data,messages:messages.data,
   invitations:invitations.data,assessments:assessments.data,members:members.data,documents:documents.data,
   jobs:jobs.data,invoices:invoices.data};
 }
 const companyId=ctx.companyId;
 const [company,opportunities,offers,messages,members,documents]=await Promise.all([
  db.from("contractor_companies").select("id,contractor_code,name,contact_name,contact_email,phone,business_address,territories,service_types,payment_terms,status")
   .eq("id",companyId).single(),
  db.from("contractor_opportunities").select("id,opportunity_number,company_id,service_type,property_address,property_type,square_feet,bedrooms,bathrooms,scope_of_work,property_condition,requested_date,requested_time,estimated_person_hours,cleaner_count,proposed_amount,pricing_basis,special_instructions,access_arrangements,status,final_scope,agreed_amount,partner_confirmed_at,linked_job_id,quality_approved_at,decision_reason,created_at").eq("company_id",companyId).order("created_at",{ascending:false}).limit(500),
  db.from("contractor_offers").select("id,opportunity_id,company_id,offered_by_side,amount,pricing_basis,scope_text,message,created_at").eq("company_id",companyId).order("created_at",{ascending:false}).limit(500),
  db.from("contractor_messages").select("id,opportunity_id,sender_side,body,created_at").eq("company_id",companyId).order("created_at",{ascending:false}).limit(500),
  db.from("contractor_members").select("id,email,member_role,is_active").eq("company_id",companyId),
  db.from("contractor_documents").select("id,opportunity_id,file_name,mime_type,file_size,category,created_at").eq("company_id",companyId).limit(500),
 ]);
 for(const item of [company,opportunities,offers,messages,members,documents])if(item.error)throw item.error;
 const linkedIds=(opportunities.data??[]).map(x=>x.linked_job_id).filter((x):x is string=>Boolean(x));
 const [jobs,invoices]=await Promise.all([
  linkedIds.length?db.from("jobs").select("id,status,scheduled_date,start_time,completed_at").in("id",linkedIds):Promise.resolve({data:[],error:null}),
  linkedIds.length?db.from("invoices").select("id,job_id,invoice_number,status,total,amount_paid,due_date").in("job_id",linkedIds).is("archived_at",null):Promise.resolve({data:[],error:null}),
 ]);
 if(jobs.error||invoices.error)throw jobs.error??invoices.error;
 return {role:ctx.role,company:company.data,opportunities:effectiveOpportunityStatuses(opportunities.data??[],jobs.data??[],invoices.data??[]),offers:offers.data,messages:messages.data,
  members:members.data,documents:documents.data,jobs:jobs.data,invoices:invoices.data};
}
export async function GET(){
 try{return noCache(await list(await contractorContext()));}catch(error){return handleContractorError(error);}
}
export async function POST(request:Request){
 try {
  const ctx=await contractorContext(),input=await body(request),action=required(input.action,"action",50);
  const db=ctx.admin;
  if(action==="createCompany"){
   requireInternal(ctx);
   const name=required(input.name,"company name",200),email=required(input.email,"contact email",320).toLowerCase();
   if(!/^\S+@\S+\.\S+$/.test(email))throw new ContractorAccessError("Valid contact email required.",400);
   const {data,error}=await db.from("contractor_companies").insert({
    name,contact_email:email,contact_name:optional(input.contactName,160)??"",
    phone:optional(input.phone,60),business_address:optional(input.address,500),
    territories:Array.isArray(input.territories)?input.territories.filter(x=>typeof x==="string").slice(0,30):[],
    service_types:Array.isArray(input.serviceTypes)?input.serviceTypes.filter(x=>typeof x==="string").slice(0,30):[],
    assigned_manager_id:ctx.userId,payment_terms:optional(input.paymentTerms,500),
   }).select("id").single();
   if(error||!data)throw error??new Error("Company not saved.");
   await audited(ctx,{companyId:data.id,type:"Company Created"});
   return noCache({companyId:data.id});
  }
  if(action==="updateCompany"){
   const companyId=ctx.type==="internal"?uuid(input.companyId):ctx.companyId;
   const {data:current,error:ce}=await db.from("contractor_companies").select("id,status").eq("id",companyId).single();
   if(ce||!current)throw new ContractorAccessError("Company unavailable.",404);
   const changes:Record<string,unknown>={};
   for(const [key,max] of [["contact_name",160],["phone",60],["business_address",500],["payment_terms",500]] as const)
    if(Object.prototype.hasOwnProperty.call(input,key))changes[key]=optional(input[key],max);
   if(input.contact_email!==undefined)changes.contact_email=required(input.contact_email,"email",320).toLowerCase();
   if(ctx.type==="internal"){
    if(input.name!==undefined)changes.name=required(input.name,"name",200);
    if(input.status!==undefined){
     const status=required(input.status,"status",30);
     if(!["Active","Pending","Suspended","Archived"].includes(status))throw new ContractorAccessError("Invalid company status.",400);
     if(ctx.role!=="Master Admin"&&!(current.status==="Pending"&&status==="Active"))
      throw new ContractorAccessError("Suspension, archiving, and reactivation require Master Admin authorization.");
     changes.status=status;
    }
    if(input.internal_notes!==undefined)changes.internal_notes=optional(input.internal_notes,10000);
    if(input.assigned_manager_id!==undefined)changes.assigned_manager_id=input.assigned_manager_id===null?null:uuid(input.assigned_manager_id);
   }else{
    requirePartner(ctx);
    if(ctx.role!=="Company Admin")throw new ContractorAccessError("Company administrator access required.");
   }
   const {error}=await db.from("contractor_companies").update({...changes,updated_at:new Date().toISOString()}).eq("id",companyId);
   if(error)throw error;
   await audited(ctx,{companyId,type:"Company Updated",detail:{fields:Object.keys(changes)}});
   return noCache({ok:true});
  }
  if(action==="submitOpportunity"){
   requirePartner(ctx);
   const date=required(input.requestedDate,"service date",10);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new ContractorAccessError("Valid service date required.",400);
   const type=required(input.propertyType,"property type",30);
   if(!["Residential","Commercial"].includes(type))throw new ContractorAccessError("Property type must be Residential or Commercial.",400);
   const hours=money(input.estimatedHours,"estimated person-hours");
   if(hours<=0)throw new ContractorAccessError("Estimated person-hours are required.",400);
   const proposed=money(input.amount,"proposed payment");
   const externalRef=optional(input.externalReference,100);
   const {data,error}=await db.from("contractor_opportunities").insert({
    company_id:ctx.companyId,submitted_by:ctx.userId,service_type:required(input.serviceType,"service type",160),
    property_address:required(input.address,"property address",500),property_type:type,
    square_feet:input.squareFeet===null||input.squareFeet===""?null:money(input.squareFeet,"square footage"),
    bedrooms:input.bedrooms===null||input.bedrooms===""?null:money(input.bedrooms,"bedrooms"),
    bathrooms:input.bathrooms===null||input.bathrooms===""?null:money(input.bathrooms,"bathrooms"),
    scope_of_work:required(input.scope,"scope of work",10000),
    property_condition:optional(input.condition,250),requested_date:date,
    requested_time:optional(input.requestedTime,8),estimated_person_hours:hours,
    cleaner_count:Math.max(1,Math.min(100,Math.trunc(Number(input.cleaners)||1))),
    proposed_amount:proposed,pricing_basis:required(input.pricingBasis??"Flat Price","pricing basis",80),
    special_instructions:optional(input.instructions,5000),access_arrangements:optional(input.access,2500),
    external_reference:externalRef,
   }).select("id,opportunity_number").single();
   if(error){if(error.code==="23505")throw new ContractorAccessError("This external reference was already submitted.",409);throw error;}
   await audited(ctx,{companyId:ctx.companyId,opportunityId:data.id,type:"Opportunity Submitted"});
   await notify(ctx,"New contractor opportunity",`Opportunity ${data.opportunity_number} was submitted for review.`,ctx.companyId,data.id,"internal");
   return noCache({opportunity:data});
  }
  if(action==="message"){
   const oppId=input.opportunityId?uuid(input.opportunityId):null;
   const opportunity=oppId?ctx.type==="partner"?await partnerOpportunity(ctx,oppId):await internalOpportunity(ctx,oppId):null;
   const companyId=opportunity?.company_id??(ctx.type==="partner"?ctx.companyId:uuid(input.companyId));
   const message=required(input.message,"message",10000);
   const {data,error}=await db.from("contractor_messages").insert({company_id:companyId,opportunity_id:oppId,
    sender_id:ctx.userId,sender_side:ctx.type==="partner"?"Contractor":"StudioScrubz",body:message})
    .select("id").single();
   if(error)throw error;
   await audited(ctx,{companyId,opportunityId:oppId??undefined,type:"Message Posted",detail:{messageId:data.id}});
   await notify(ctx,"Contractor message",`A new message was posted to ${oppId?"an opportunity":"a contractor thread"}.`,companyId,oppId??undefined,
    ctx.type==="partner"?"internal":"contractor");
   return noCache({messageId:data.id});
  }
  if(action==="offer"){
   const opp=ctx.type==="internal"?await internalOpportunity(ctx,uuid(input.opportunityId)):
    await partnerOpportunity(ctx,uuid(input.opportunityId));
   if(["Accepted","Declined","Cancelled","Completed","Paid"].includes(opp.status))
    throw new ContractorAccessError("This opportunity is closed for negotiation.",409);
   const amount=money(input.amount),scope=required(input.scope,"counteroffer scope",10000);
   const {data,error}=await db.from("contractor_offers").insert({opportunity_id:opp.id,company_id:opp.company_id,
    offered_by:ctx.userId,offered_by_side:ctx.type==="internal"?"StudioScrubz":"Contractor",
    amount,scope_text:scope,pricing_basis:required(input.pricingBasis??opp.pricing_basis,"pricing basis",80),
    message:optional(input.message,5000)}).select("id").single();
   if(error)throw error;
   const {error:ue}=await db.from("contractor_opportunities").update({
    status:"Negotiating",final_scope:scope,agreed_amount:amount,partner_confirmed_at:null,
    internal_confirmed_at:null,updated_at:new Date().toISOString(),
   }).eq("id",opp.id);
   if(ue)throw ue;
   await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,type:"Counteroffer Submitted",detail:{offerId:data.id,amount}});
   await notify(ctx,"Contractor counteroffer",`A counteroffer was submitted for opportunity ${opp.opportunity_number}.`,opp.company_id,opp.id,
    ctx.type==="partner"?"internal":"contractor");
   return noCache({offerId:data.id});
  }
  if(action==="confirmOffer"){
   requirePartner(ctx);
   const opp=await partnerOpportunity(ctx,uuid(input.opportunityId));
   if(["Accepted","Declined","Cancelled"].includes(opp.status))throw new ContractorAccessError("Opportunity is already closed.",409);
   const {data:offers,error:oe}=await db.from("contractor_offers").select("amount,scope_text,id").eq("opportunity_id",opp.id)
    .order("created_at",{ascending:false}).limit(1);
   if(oe)throw oe;
   const latest=offers?.[0];
   const amount=latest?Number(latest.amount):Number(opp.proposed_amount),scope=latest?.scope_text??opp.scope_of_work;
   if(input.confirmed!==true)throw new ContractorAccessError("Written confirmation of final scope and compensation is required.",400);
   const {error}=await db.from("contractor_opportunities").update({
    agreed_amount:amount,final_scope:scope,partner_confirmed_at:new Date().toISOString(),
    status:"Awaiting Approval",updated_at:new Date().toISOString(),
   }).eq("id",opp.id);
   if(error)throw error;
   await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,type:"Partner Confirmed Scope and Price",detail:{amount}});
   await notify(ctx,"Contractor acceptance confirmation",`Partner confirmed scope and compensation for ${opp.opportunity_number}.`,opp.company_id,opp.id,"internal");
   return noCache({ok:true});
  }
  if(action==="assess"){
   requireInternal(ctx);
   const opp=await internalOpportunity(ctx,uuid(input.opportunityId));
   const settingsResult=await db.from("profitability_settings").select("settings").eq("singleton",true).single();
   if(settingsResult.error||!settingsResult.data)throw new ContractorAccessError("Profitability settings are unavailable.",503);
   const settings=validateProfitabilitySettings(settingsResult.data.settings);
   const crew=Number(input.cleaners??opp.cleaner_count),hours=Number(input.hoursPerCleaner??(Number(opp.estimated_person_hours)/crew));
   if(!Number.isInteger(crew)||crew<1||crew>100||!Number.isFinite(hours)||hours<=0||hours>10000)
    throw new ContractorAccessError("Valid crew and hours are required.",400);
   const routeMode=input.travelMode==="Manual"?"Manual":"Unavailable";
   const miles=routeMode==="Manual"?money(input.roundTripMiles,"round-trip miles"):null;
   const minutes=routeMode==="Manual"?money(input.roundTripMinutes,"round-trip minutes"):null;
   const travel:TravelProjection={
    origin:settings.travelOrigin,destination:opp.property_address,
    verification:routeMode,provider:routeMode==="Manual"?"Manual":null,
    roundTripMiles:miles,roundTripMinutes:minutes,
    vehicleCount:Math.max(1,Math.min(20,Math.trunc(Number(input.vehicles)||settings.defaultVehiclesPerJob))),
    travelingEmployeeCount:crew,
    companyRequiredTravelIsCompensable:settings.companyRequiredTravelIsCompensable,
    warning:routeMode==="Unavailable"?"Travel has not been verified.":null,
    calculatedAt:routeMode==="Manual"?new Date().toISOString():null,
   };
   const projection=calculateProfitability({
    settings,travel,price:Number(opp.agreed_amount??opp.proposed_amount),
    cleanerCount:crew,hoursPerCleaner:hours,
    supplies:money(input.supplies??0),equipment:money(input.equipment??0),
    otherDirectExpenses:money(input.otherDirectExpenses??0),
    allocatedOverhead:money(input.overhead??0),paymentProcessingFees:money(input.processingFees??0),
    salesCommissions:money(input.commissions??0),
   });
   const minimum=projection.recommendedMinimumPrice,valid=projection.costComplete&&projection.travelCostsVerified&&minimum!==null;
   const {error}=await db.from("contractor_profitability").upsert({
    opportunity_id:opp.id,assessed_by:ctx.userId,projection,
    minimum_price:minimum,projected_margin:projection.grossMarginPercent,
    cost_complete:valid,override_approved_by:null,override_reason:null,override_at:null,
    updated_at:new Date().toISOString(),
   },{onConflict:"opportunity_id"});
   if(error)throw error;
   await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,type:"Profitability Reassessed",
    detail:{belowMinimum:minimum!==null&&projection.price<minimum,complete:valid}});
   return noCache({projection,acceptanceBlocked:!valid||(minimum!==null&&projection.price<minimum)});
  }
  if(action==="approveOverride"){
   requireMaster(ctx);
   const opp=await internalOpportunity(ctx,uuid(input.opportunityId));
   const reason=required(input.reason,"override reason",2000);
   if(reason.length<12)throw new ContractorAccessError("Provide a detailed override reason (at least 12 characters).",400);
   const {data,error}=await db.from("contractor_profitability").update({
    override_approved_by:ctx.userId,override_reason:reason,override_at:new Date().toISOString(),
   }).eq("opportunity_id",opp.id).select("opportunity_id").maybeSingle();
   if(error||!data)throw new ContractorAccessError("Complete a profitability assessment before overriding.",409);
   await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,type:"Master Profitability Override",detail:{reason}});
   return noCache({ok:true});
  }
  if(action==="accept"||action==="decline"){
   requireInternal(ctx);
   const opp=await internalOpportunity(ctx,uuid(input.opportunityId));
   if(["Accepted","Declined","Cancelled","Crew Assignment","Scheduled","In Progress","Completed","Paid"].includes(opp.status))
    throw new ContractorAccessError("Opportunity has already been decided.",409);
   const reason=optional(input.reason,2000);
   if(action==="decline"){
    if(!reason)throw new ContractorAccessError("Decline reason required.",400);
    const {error}=await db.from("contractor_opportunities").update({
     status:"Declined",decision_reason:reason,decided_by:ctx.userId,decided_at:new Date().toISOString(),
    }).eq("id",opp.id);
    if(error)throw error;
    await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,type:"Opportunity Declined",detail:{reason}});
    await notify(ctx,"Opportunity declined",`StudioScrubz declined opportunity ${opp.opportunity_number}.`,opp.company_id,opp.id,"contractor");
    return noCache({ok:true});
   }
   if(!opp.partner_confirmed_at||!opp.final_scope||opp.agreed_amount==null)
    throw new ContractorAccessError("Contractor must confirm final scope and compensation in writing.",409);
   const {data:a,error:ae}=await db.from("contractor_profitability").select("*").eq("opportunity_id",opp.id).maybeSingle();
   if(ae||!a)throw new ContractorAccessError("Complete a profitability assessment first.",409);
   const below=a.minimum_price===null||Number(opp.agreed_amount)<Number(a.minimum_price)||!a.cost_complete;
   if(below&&(!a.override_approved_by||!a.override_reason))
    throw new ContractorAccessError("Below minimum or unverified costs. Master Admin override is required.",409);
   const {error}=await db.from("contractor_opportunities").update({
    status:"Accepted",internal_confirmed_at:new Date().toISOString(),decided_by:ctx.userId,
    decided_at:new Date().toISOString(),decision_reason:reason??"Accepted within approved terms",
   }).eq("id",opp.id);
   if(error)throw error;
   await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,type:"Opportunity Accepted",detail:{agreedAmount:opp.agreed_amount}});
   // Atomic, idempotent, authorization-checked SQL handoff. Retains existing job completion triggers.
   const session=await createSupabaseServerClient();
   const {data:jobId,error:je}=await session.rpc("convert_contractor_opportunity_to_job" as never,
    {p_opportunity_id:opp.id} as never);
   if(je)throw new ContractorAccessError("Opportunity accepted, but operational Job creation needs review. "+je.message,409);
   await notify(ctx,"Subcontracted job accepted",`Opportunity ${opp.opportunity_number} was accepted.`,opp.company_id,opp.id,"contractor");
   return noCache({jobId});
  }
  if(action==="retryJobConversion"){
   requireInternal(ctx);
   const opp=await internalOpportunity(ctx,uuid(input.opportunityId));
   if(opp.status!=="Accepted"&&opp.status!=="Crew Assignment")throw new ContractorAccessError("Opportunity not ready for conversion.",409);
   const session=await createSupabaseServerClient();
   const {data,error}=await session.rpc("convert_contractor_opportunity_to_job" as never,{p_opportunity_id:opp.id} as never);
   if(error)throw error;
   return noCache({jobId:data});
  }
  if(action==="approveQuality"){
   requireInternal(ctx);
   const opp=await internalOpportunity(ctx,uuid(input.opportunityId));
   if(!opp.linked_job_id)throw new ContractorAccessError("This opportunity has no linked operational Job.",409);
   const {data:job,error:je}=await db.from("jobs").select("id,status,completed_at").eq("id",opp.linked_job_id).single();
   if(je||!job||job.status!=="Completed"||!job.completed_at)
    throw new ContractorAccessError("Complete the existing Job workflow before quality approval.",409);
   if(opp.quality_approved_at)return noCache({ok:true,alreadyApproved:true});
   const {data,error}=await db.from("contractor_opportunities").update({
    quality_approved_at:new Date().toISOString(),quality_approved_by:ctx.userId,
    status:"Completed",updated_at:new Date().toISOString(),
   }).eq("id",opp.id).is("quality_approved_at",null).select("id").maybeSingle();
   if(error)throw error;
   if(!data)return noCache({ok:true,alreadyApproved:true});
   await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,type:"Quality Review Approved",
    detail:{jobId:job.id}});
   await notify(ctx,"Job quality review completed",`Job ${opp.opportunity_number} passed StudioScrubz quality review.`,
    opp.company_id,opp.id,"contractor");
   return noCache({ok:true});
  }
  if(action==="invoiceJob"){
   requireInternal(ctx);
   const opp=await internalOpportunity(ctx,uuid(input.opportunityId));
   if(!opp.linked_job_id||!opp.quality_approved_at)
    throw new ContractorAccessError("Quality-approved completed contractor Job is required for invoicing.",409);
   const {data:job,error:je}=await db.from("jobs").select("id,status").eq("id",opp.linked_job_id).single();
   if(je||job?.status!=="Completed")throw new ContractorAccessError("Job must be completed before invoicing.",409);
   // Reuse the existing authenticated, duplicate-aware invoicing RPC; do not
   // insert a separate invoice or bypass its financial authorization checks.
   const session=await createSupabaseServerClient();
   const {data:result,error}=await session.rpc("create_completed_job_invoice",{p_job_id:job.id});
   if(error)throw new ContractorAccessError("Existing invoice workflow rejected the request: "+error.message,409);
   await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,type:"Existing Job Invoice Reconciled",
    detail:{jobId:job.id,created:result?.created===true,invoiceId:result?.invoice_id}});
   return noCache({invoice:result});
  }
  if(action==="cancelOpportunity"||action==="disputeOpportunity"||action==="requestReschedule"){
   const opp=ctx.type==="internal"?await internalOpportunity(ctx,uuid(input.opportunityId)):
    await partnerOpportunity(ctx,uuid(input.opportunityId));
   const reason=required(input.reason,"reason",2000);
   if(reason.length<8)throw new ContractorAccessError("Provide a meaningful reason.",400);
   if(action==="cancelOpportunity"&&opp.linked_job_id)
    throw new ContractorAccessError("Accepted Jobs must be cancelled through the protected StudioScrubz Job workflow.",409);
   if(action==="cancelOpportunity"&&["Declined","Paid","Cancelled"].includes(opp.status))
    throw new ContractorAccessError("This opportunity can no longer be cancelled.",409);
   const nextStatus=action==="cancelOpportunity"?"Cancelled":action==="disputeOpportunity"?"Disputed":null;
   if(nextStatus){
    const {error}=await db.from("contractor_opportunities").update({
     status:nextStatus,updated_at:new Date().toISOString(),
     ...(nextStatus==="Cancelled"?{cancelled_at:new Date().toISOString()}:{}),
    }).eq("id",opp.id);
    if(error)throw error;
   }
   await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,
    type:action==="cancelOpportunity"?"Opportunity Cancelled":action==="disputeOpportunity"?"Job Disputed":"Reschedule Requested",
    detail:{reason,requestedBy:ctx.type}});
   const {error:me}=await db.from("contractor_messages").insert({
    company_id:opp.company_id,opportunity_id:opp.id,sender_id:ctx.userId,
    sender_side:ctx.type==="internal"?"StudioScrubz":"Contractor",body:reason,
   });
   if(me)throw me;
   await notify(ctx,action==="cancelOpportunity"?"Opportunity cancelled":action==="disputeOpportunity"?"Job dispute":"Reschedule request",
    `A partner workflow action needs review for ${opp.opportunity_number}.`,opp.company_id,opp.id,
    ctx.type==="internal"?"contractor":"internal");
   return noCache({ok:true});
  }
  if(action==="requestStaff"){
   requirePartner(ctx);
   if(ctx.role!=="Company Admin")throw new ContractorAccessError("Only your company administrator may request staff access.");
   const email=required(input.email,"staff email",320);
   const message=`Additional authorized contractor staff access requested: ${email}. Requires StudioScrubz approval.`;
   const {error}=await db.from("contractor_messages").insert({company_id:ctx.companyId,sender_id:ctx.userId,
    sender_side:"Contractor",body:message});
   if(error)throw error;
   await audited(ctx,{companyId:ctx.companyId,type:"Staff Access Requested",detail:{email}});
   await notify(ctx,"Contractor staff access request",message,ctx.companyId,undefined,"internal");
   return noCache({ok:true});
  }
  throw new ContractorAccessError("Unknown contractor action.",400);
 } catch(error){return handleContractorError(error);}
}

async function notify(ctx:ContractorContext,subject:string,message:string,companyId:string,opportunityId:string|undefined,to:"internal"|"contractor"){
 try{
  const db=ctx.admin;
  const {data:company}=await db.from("contractor_companies").select("name,contact_email,assigned_manager_id").eq("id",companyId).single();
  if(!company)return;
  let recipient=company.contact_email as string;
  if(to==="internal"){
   const {data:manager}=company.assigned_manager_id?await db.from("user_profiles").select("email").eq("id",company.assigned_manager_id).maybeSingle():{data:null};
   if(manager?.email)recipient=manager.email;
   else{
    const {data:master}=await db.from("user_profiles").select("email").eq("role","Master Admin").eq("is_active",true).limit(1).maybeSingle();
    if(!master?.email)return;
    recipient=master.email;
   }
  }
  const safeMessage=message.replaceAll("<","&lt;").replaceAll(">","&gt;");
  const response=await sendResendEmail({recipientEmail:recipient,subject:`StudioScrubz | ${subject}`,
   text:message,html:`<p>${safeMessage}</p><p>Sign in to your authorized StudioScrubz dashboard for details.</p>`,
   idempotencyKey:`contractor-event:${crypto.randomUUID()}`,replyTo:null});
  await audited(ctx,{companyId,opportunityId,type:"Email Notification Sent",
   detail:{recipient,providerId:response.id,subject}});
 }catch(error){
  console.error("Contractor notification delivery failed",error);
  try{await audited(ctx,{companyId,opportunityId,type:"Email Notification Failed",detail:{subject}});}catch{}
 }
}
