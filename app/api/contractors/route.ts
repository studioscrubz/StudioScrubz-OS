import "server-only";
import { contractorPropertyConditions, contractorScopeOptions, type ContractorJobOptions, type ContractorPropertyType } from "@/lib/contractors/jobOptions";
import { loadAuthoritativeCatalog, publicCatalog } from "@/lib/services/publicEstimateRequests";
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
async function activeOperationsManager(ctx:ContractorContext,managerId:string|null){
 if(!managerId)return null;
 const {data,error}=await ctx.admin.from("user_profiles").select("id,display_name")
  .eq("id",managerId).eq("is_active",true).in("role",["Manager","Master Admin"]).maybeSingle();
 if(error)throw error;
 return data;
}

async function privateThread(ctx:ContractorContext,companyId:string,partnerUserId:string){
 const {data:company,error}=await ctx.admin.from("contractor_companies").select("assigned_manager_id,status")
  .eq("id",companyId).maybeSingle();
 if(error)throw error;
 if(!company||company.status!=="Active")throw new ContractorAccessError("An active partner company is required.",404);
 const manager=await activeOperationsManager(ctx,company.assigned_manager_id);
 if(!manager)throw new ContractorAccessError("StudioScrubz must assign an Operations Manager before you can send messages.",409);
 if(ctx.type==="internal"&&manager.id!==ctx.userId)
  throw new ContractorAccessError("Only the assigned Operations Manager can access this conversation.");
 const {data:member,error:memberError}=await ctx.admin.from("contractor_members").select("user_id")
  .eq("company_id",companyId).eq("user_id",partnerUserId).eq("is_active",true).maybeSingle();
 if(memberError)throw memberError;
 if(!member)throw new ContractorAccessError("Select an active contractor profile.",404);
 return {company_id:companyId,partner_user_id:partnerUserId,manager_user_id:manager.id};
}

async function postPrivateMessage(ctx:ContractorContext,thread:Awaited<ReturnType<typeof privateThread>>,opportunityId:string|null,message:string){
 const {data,error}=await ctx.admin.from("contractor_private_messages").insert({...thread,
  opportunity_id:opportunityId,sender_side:ctx.type==="partner"?"Contractor":"StudioScrubz",body:message}).select("id").single();
 if(error)throw error;
 await audited(ctx,{companyId:thread.company_id,opportunityId:opportunityId??undefined,type:"Private Message Posted",detail:{messageId:data.id}});
 return data.id;
}

async function list(ctx:ContractorContext){
 const db=ctx.admin;
 if(ctx.type==="internal"){
  const [companies,opportunities,offers,invitations,assessments,members,documents,managers,attempts,followups]=await Promise.all([
   db.from("contractor_companies").select("*").order("created_at",{ascending:false}).limit(500),
   db.from("contractor_opportunities").select("*").order("created_at",{ascending:false}).limit(500),
   db.from("contractor_offers").select("*").order("created_at",{ascending:false}).limit(500),
   db.from("contractor_invitations").select("id,company_id,invited_email,member_role,expires_at,status,delivery_status,created_at,redeemed_at").order("created_at",{ascending:false}).limit(500),
   db.from("contractor_profitability").select("*").limit(500),
   db.from("contractor_members").select("id,company_id,user_id,email,member_role,is_active,joined_at").limit(500),
   db.from("contractor_documents").select("id,company_id,opportunity_id,file_name,mime_type,file_size,category,created_at").limit(500),
   db.from("user_profiles").select("id,display_name,email,role").in("role",["Master Admin","Manager"]).eq("is_active",true).limit(50),
   db.from("contractor_contact_attempts").select("id,company_id,opportunity_id,method,outcome,notes,attempted_at").order("attempted_at",{ascending:false}).limit(500),
   db.from("contractor_followups").select("id,company_id,opportunity_id,assigned_manager_id,note,due_at,status,created_at").order("due_at",{ascending:true}).limit(500),
  ]);
  for(const item of [companies,opportunities,offers,invitations,assessments,members,documents,managers,attempts,followups])if(item.error)throw item.error;
  const managedCompanies=(companies.data??[]).filter(c=>c.assigned_manager_id===ctx.userId&&c.status==="Active").map(c=>c.id);
  const activeMembers=new Set((members.data??[]).filter(m=>m.is_active).map(m=>`${m.company_id}:${m.user_id}`));
  const {data:privateMessages,error:messagesError}=managedCompanies.length
   ?await db.from("contractor_private_messages").select("id,company_id,partner_user_id,opportunity_id,sender_side,body,created_at,read_at")
    .eq("manager_user_id",ctx.userId).in("company_id",managedCompanies).order("created_at",{ascending:false}).limit(500)
   :{data:[],error:null};
  if(messagesError)throw messagesError;
  const messages=(privateMessages??[]).filter(m=>activeMembers.has(`${m.company_id}:${m.partner_user_id}`));
  const linkedIds=(opportunities.data??[]).map(x=>x.linked_job_id).filter((x):x is string=>Boolean(x));
  const [jobs,invoices]=await Promise.all([
   linkedIds.length?db.from("jobs").select("id,status,scheduled_date,start_time,estimated_duration,completed_at,assigned_team,assigned_crew_id").in("id",linkedIds):Promise.resolve({data:[],error:null}),
   linkedIds.length?db.from("invoices").select("id,job_id,invoice_number,status,total,amount_paid,due_date,archived_at").in("job_id",linkedIds):Promise.resolve({data:[],error:null}),
  ]);
  if(jobs.error||invoices.error)throw jobs.error??invoices.error;
  return {role:ctx.role,companies:companies.data,opportunities:effectiveOpportunityStatuses(opportunities.data??[],jobs.data??[],invoices.data??[]),offers:offers.data,messages,
   invitations:invitations.data,assessments:assessments.data,members:members.data,documents:documents.data,managers:managers.data,
   viewerId:ctx.userId,attempts:attempts.data,followups:followups.data,
   jobs:jobs.data,invoices:invoices.data};
 }
 const companyId=ctx.companyId;
 const [company,opportunities,offers,documents]=await Promise.all([
  db.from("contractor_companies").select("id,contractor_code,name,contact_name,contact_email,phone,business_address,territories,service_types,payment_terms,status,assigned_manager_id")
   .eq("id",companyId).single(),
  db.from("contractor_opportunities").select("id,opportunity_number,company_id,service_type,property_address,property_type,square_feet,bedrooms,bathrooms,scope_of_work,property_condition,requested_date,requested_time,estimated_person_hours,cleaner_count,proposed_amount,pricing_basis,special_instructions,access_arrangements,status,final_scope,agreed_amount,partner_confirmed_at,linked_job_id,quality_approved_at,created_at").eq("company_id",companyId).order("created_at",{ascending:false}).limit(500),
  db.from("contractor_offers").select("id,opportunity_id,company_id,offered_by_side,amount,pricing_basis,scope_text,created_at").eq("company_id",companyId).order("created_at",{ascending:false}).limit(500),
  db.from("contractor_documents").select("id,opportunity_id,file_name,mime_type,file_size,category,created_at").eq("company_id",companyId).limit(500),
 ]);
 for(const item of [company,opportunities,offers,documents])if(item.error)throw item.error;
 if(!company.data)throw new ContractorAccessError("Company unavailable.",404);
 const {assigned_manager_id:managerId,...publicCompany}=company.data;
 const manager=await activeOperationsManager(ctx,managerId);
 const {data:messages,error:messagesError}=manager
  ?await db.from("contractor_private_messages").select("id,opportunity_id,sender_side,body,created_at,read_at")
   .eq("company_id",companyId).eq("partner_user_id",ctx.userId).eq("manager_user_id",manager.id)
   .order("created_at",{ascending:false}).limit(500)
  :{data:[],error:null};
 if(messagesError)throw messagesError;
 const linkedIds=(opportunities.data??[]).map(x=>x.linked_job_id).filter((x):x is string=>Boolean(x));
 const approvedJobIds=(opportunities.data??[]).filter(x=>Boolean(x.quality_approved_at))
  .map(x=>x.linked_job_id).filter((x):x is string=>Boolean(x));
 const [jobs,invoices]=await Promise.all([
  linkedIds.length?db.from("jobs").select("id,status,scheduled_date,start_time,completed_at").in("id",linkedIds):Promise.resolve({data:[],error:null}),
  approvedJobIds.length?db.from("invoices").select("id,job_id,invoice_number,status,total,amount_paid,due_date").in("job_id",approvedJobIds).is("archived_at",null).neq("status","Cancelled"):Promise.resolve({data:[],error:null}),
 ]);
 if(jobs.error||invoices.error)throw jobs.error??invoices.error;
 return {role:ctx.role,company:publicCompany,operationsManager:manager?{name:manager.display_name??"Operations Manager"}:null,opportunities:effectiveOpportunityStatuses(opportunities.data??[],jobs.data??[],invoices.data??[]),offers:offers.data,messages,
  documents:ctx.role==="Company Admin"?documents.data:(documents.data??[]).filter(x=>x.category!=="Tax"),
  jobs:jobs.data,invoices:invoices.data};
}
async function loadContractorJobOptions():Promise<ContractorJobOptions>{
 const {services}=publicCatalog(await loadAuthoritativeCatalog());
 return {services:services.map(({name,division,addons})=>({name,division,addons:[...new Set(addons.map(addon=>addon.name))]}))};
}
function validatedSelections(value:unknown,available:readonly string[],label:string){
 if(!Array.isArray(value)||value.length>available.length||
   value.some(item=>typeof item!=="string"||!available.includes(item)))
  throw new ContractorAccessError(`Select valid ${label} options.`,400);
 return [...new Set<string>(value)];
}
export async function GET(request:Request){
 try{
  const ctx=await contractorContext();
  if(new URL(request.url).searchParams.get("view")==="job-options"){
   requirePartner(ctx);
   return noCache(await loadContractorJobOptions());
  }
  return noCache(await list(ctx));
 }catch(error){return handleContractorError(error);}
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
   for(const [key,max] of [["contact_name",160],["phone",60],["business_address",500]] as const)
    if(Object.prototype.hasOwnProperty.call(input,key))changes[key]=optional(input[key],max)??(key==="contact_name"?"":null);
   if(input.contact_email!==undefined){
    const email=required(input.contact_email,"email",320).toLowerCase();
    if(!/^\S+@\S+\.\S+$/.test(email))throw new ContractorAccessError("Valid business email required.",400);
    changes.contact_email=email;
   }
   if(input.name!==undefined){
    const name=required(input.name,"company name",200);
    if(name.length<2)throw new ContractorAccessError("Enter at least two characters for the company name.",400);
    changes.name=name;
   }
   if(input.territories!==undefined){
    if(!Array.isArray(input.territories)||input.territories.length>30||
      !input.territories.every(x=>typeof x==="string"&&x.length<=100))
     throw new ContractorAccessError("Invalid service territory list.",400);
    changes.territories=input.territories;
   }
   if(input.service_types!==undefined){
    if(!Array.isArray(input.service_types)||input.service_types.length>30||
      !input.service_types.every(x=>typeof x==="string"&&x.length<=100))
     throw new ContractorAccessError("Invalid cleaning work types.",400);
    changes.service_types=input.service_types;
   }
   if(ctx.type==="internal"){
    if(input.payment_terms!==undefined)changes.payment_terms=optional(input.payment_terms,500);
    if(input.status!==undefined){
     const status=required(input.status,"status",30);
     if(!["Active","Pending","Suspended","Archived"].includes(status))throw new ContractorAccessError("Invalid company status.",400);
     if(ctx.role!=="Master Admin"&&!(current.status==="Pending"&&status==="Active"))
      throw new ContractorAccessError("Suspension, archiving, and reactivation require Master Admin authorization.");
     changes.status=status;
    }
    for(const key of ["proposed_rates","negotiated_rates"] as const){
     if(input[key]!==undefined){
      const value=input[key];
      if(!value||typeof value!=="object"||Array.isArray(value)||
        JSON.stringify(value).length>8000)
       throw new ContractorAccessError("Rates must be a small structured JSON object.",400);
      changes[key]=value;
     }
    }
    if(input.internal_notes!==undefined)changes.internal_notes=optional(input.internal_notes,10000);
    if(input.assigned_manager_id!==undefined){
     if(input.assigned_manager_id===null||input.assigned_manager_id==="")changes.assigned_manager_id=null;
     else{
      const managerId=uuid(input.assigned_manager_id);
      const {data:manager,error:managerError}=await db.from("user_profiles")
       .select("id").eq("id",managerId).in("role",["Manager","Master Admin"]).eq("is_active",true).maybeSingle();
      if(managerError||!manager)throw new ContractorAccessError("Select an active Operations Manager.",400);
      changes.assigned_manager_id=managerId;
     }
    }
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
   const serviceType=required(input.serviceType,"service type",160);
   const condition=optional(input.condition,250);
   let scope=input.scope;
   if(input.scopeItems!==undefined||input.addons!==undefined){
    const scopeItems=validatedSelections(input.scopeItems,contractorScopeOptions[type as ContractorPropertyType],"scope of work");
    if(!scopeItems.length)throw new ContractorAccessError("Select at least one scope of work option.",400);
    if(!condition||!contractorPropertyConditions.some(option=>option===condition))
     throw new ContractorAccessError("Select a property condition.",400);
    const {services}=await loadContractorJobOptions();
    const service=services.find(option=>option.division===type&&option.name===serviceType);
    if(!service)throw new ContractorAccessError("Select a service type for this property.",400);
    const addons=validatedSelections(input.addons??[],service.addons,"add-on");
    const details=scopeItems.includes("Other")?required(input.scopeDetails,"other scope details",2000):null;
    const areas=scopeItems.filter(item=>item!=="Other");
    scope=[areas.length&&`Scope of work: ${areas.join(", ")}`,details&&`Scope details: ${details}`,
     addons.length&&`Requested add-ons: ${addons.join(", ")}`].filter(Boolean).join("\n");
   }
   const hours=money(input.estimatedHours,"estimated person-hours");
   if(hours<=0)throw new ContractorAccessError("Estimated person-hours are required.",400);
   const proposed=money(input.amount,"proposed payment");
   // Require a stable submission key so browser retries cannot create duplicate jobs.
   const externalRef=uuid(input.externalReference);
   const {data,error}=await db.from("contractor_opportunities").insert({
    company_id:ctx.companyId,submitted_by:ctx.userId,service_type:serviceType,
    property_address:required(input.address,"property address",500),property_type:type,
    square_feet:input.squareFeet===null||input.squareFeet===""?null:money(input.squareFeet,"square footage"),
    bedrooms:input.bedrooms===null||input.bedrooms===""?null:money(input.bedrooms,"bedrooms"),
    bathrooms:input.bathrooms===null||input.bathrooms===""?null:money(input.bathrooms,"bathrooms"),
    scope_of_work:required(scope,"scope of work",10000),
    property_condition:condition,requested_date:date,
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
  if(action==="message"||action==="markMessagesRead"){
   const companyId=ctx.type==="partner"?ctx.companyId:uuid(input.companyId);
   const partnerUserId=ctx.type==="partner"?ctx.userId:uuid(input.partnerUserId);
   const thread=await privateThread(ctx,companyId,partnerUserId);
   if(action==="markMessagesRead"){
    const {error}=await db.from("contractor_private_messages").update({read_at:new Date().toISOString()})
     .match(thread).eq("sender_side",ctx.type==="partner"?"StudioScrubz":"Contractor").is("read_at",null);
    if(error)throw error;
    return noCache({ok:true});
   }
   const message=required(input.message,"message",10000);
   return noCache({messageId:await postPrivateMessage(ctx,thread,null,message)});
  }
  if(action==="requestInformation"||action==="markNegotiating"){
   requireInternal(ctx);
   const opp=await internalOpportunity(ctx,uuid(input.opportunityId));
   if(opp.linked_job_id||["Accepted","Declined","Cancelled","Paid","Disputed"].includes(opp.status))
    throw new ContractorAccessError("Opportunity cannot return to preacceptance workflow.",409);
   const reason=required(input.reason,"message to partner",2000);
   const thread=await privateThread(ctx,opp.company_id,uuid(opp.submitted_by));
   const status=action==="requestInformation"?"Information Requested":"Negotiating";
   const {data:updated,error}=await db.from("contractor_opportunities").update({
    status,updated_at:new Date().toISOString(),
   }).eq("id",opp.id).eq("status",opp.status).eq("updated_at",opp.updated_at).select("id").maybeSingle();
   if(error)throw error;
   if(!updated)throw new ContractorAccessError("Opportunity changed. Reload and try again.",409);
   await postPrivateMessage(ctx,thread,opp.id,reason);
   await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,type:status});
   return noCache({ok:true,status});
  }
  if(action==="offer"){
   const opp=ctx.type==="internal"?await internalOpportunity(ctx,uuid(input.opportunityId)):
    await partnerOpportunity(ctx,uuid(input.opportunityId));
   const amount=money(input.amount),scope=required(input.scope,"counteroffer scope",10000);
   const {data:offerId,error}=await db.rpc("record_contractor_offer",{
    p_opportunity_id:opp.id,p_actor:ctx.userId,p_amount:amount,p_scope:scope,
    p_basis:required(input.pricingBasis??opp.pricing_basis,"pricing basis",80),p_message:optional(input.message,5000),
   });
   if(error)throw new ContractorAccessError(error.message,409);
   await notify(ctx,"Contractor counteroffer",`A counteroffer was submitted for opportunity ${opp.opportunity_number}.`,opp.company_id,opp.id,
    ctx.type==="partner"?"internal":"contractor");
   return noCache({offerId});
  }
  if(action==="confirmOffer"){
   requirePartner(ctx);
   const opp=await partnerOpportunity(ctx,uuid(input.opportunityId));
   if(opp.linked_job_id||!["New Opportunity","Information Requested","Negotiating","Awaiting Approval"].includes(opp.status))
    throw new ContractorAccessError("Opportunity is already closed.",409);
   const amount=Number(opp.agreed_amount??opp.proposed_amount),scope=opp.final_scope??opp.scope_of_work;
   if(input.confirmed!==true||input.amount!==amount||input.scope!==scope)
    throw new ContractorAccessError("Terms changed. Reload the opportunity and confirm the current scope and compensation.",409);
   if(opp.partner_confirmed_at&&opp.status==="Awaiting Approval")return noCache({ok:true});
   const {data:confirmed,error}=await db.from("contractor_opportunities").update({
    agreed_amount:amount,final_scope:scope,partner_confirmed_at:new Date().toISOString(),
    status:"Awaiting Approval",updated_at:new Date().toISOString(),
   }).eq("id",opp.id).eq("status",opp.status).eq("updated_at",opp.updated_at).select("id").maybeSingle();
   if(error)throw error;
   if(!confirmed)throw new ContractorAccessError("Opportunity changed. Reload and confirm the current terms.",409);
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
    opportunity_id:opp.id,assessed_by:ctx.userId,assessed_amount:projection.price,
    assessed_scope:opp.final_scope??opp.scope_of_work,projection,
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
   if(action==="accept"&&opp.linked_job_id)return noCache({jobId:opp.linked_job_id});
   if(!["New Opportunity","Information Requested","Negotiating","Awaiting Approval"].includes(opp.status))
    throw new ContractorAccessError("Opportunity has already been decided.",409);
   const reason=optional(input.reason,2000);
   if(action==="decline"){
    if(!reason)throw new ContractorAccessError("Decline reason required.",400);
    const {data:updated,error}=await db.from("contractor_opportunities").update({
     status:"Declined",decision_reason:reason,decided_by:ctx.userId,decided_at:new Date().toISOString(),
    }).eq("id",opp.id).eq("status",opp.status).eq("updated_at",opp.updated_at).select("id").maybeSingle();
    if(error)throw error;
    if(!updated)throw new ContractorAccessError("Opportunity changed. Reload and try again.",409);
    await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,type:"Opportunity Declined",detail:{reason}});
    await notify(ctx,"Opportunity declined",`StudioScrubz declined opportunity ${opp.opportunity_number}.`,opp.company_id,opp.id,"contractor");
    return noCache({ok:true});
   }
   if(opp.status!=="Awaiting Approval"||!opp.partner_confirmed_at||!opp.final_scope||opp.agreed_amount==null)
    throw new ContractorAccessError("Contractor must confirm final scope and compensation in writing.",409);
   const {data:a,error:ae}=await db.from("contractor_profitability").select("*").eq("opportunity_id",opp.id).maybeSingle();
   if(ae||!a)throw new ContractorAccessError("Complete a profitability assessment first.",409);
   if(Number(a.assessed_amount)!==Number(opp.agreed_amount)||a.assessed_scope!==opp.final_scope)
    throw new ContractorAccessError("Final terms changed. Recalculate profitability and obtain any new override before acceptance.",409);
   const below=a.minimum_price===null||Number(opp.agreed_amount)<Number(a.minimum_price)||!a.cost_complete;
   if(below&&(!a.override_approved_by||!a.override_reason))
    throw new ContractorAccessError("Below minimum or unverified costs. Master Admin override is required.",409);
   // The database locks the opportunity and rechecks the approved terms before
   // creating the Job and recording acceptance in the same transaction.
   const session=await createSupabaseServerClient();
   const {data:jobId,error:je}=await session.rpc("convert_contractor_opportunity_to_job" as never,
    {p_opportunity_id:opp.id,p_decision_reason:reason,p_expected_updated_at:opp.updated_at} as never);
   if(je)throw new ContractorAccessError(je.message,409);
   await notify(ctx,"Subcontracted job accepted",`Opportunity ${opp.opportunity_number} was accepted.`,opp.company_id,opp.id,"contractor",`accepted:${jobId}`);
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
   const thread=await privateThread(ctx,opp.company_id,ctx.type==="partner"?ctx.userId:uuid(opp.submitted_by));
   const nextStatus=action==="cancelOpportunity"?"Cancelled":action==="disputeOpportunity"?"Disputed":null;
   if(nextStatus){
    const {data:updated,error}=await db.from("contractor_opportunities").update({
     status:nextStatus,updated_at:new Date().toISOString(),
     ...(nextStatus==="Cancelled"?{cancelled_at:new Date().toISOString()}:{}),
    }).eq("id",opp.id).eq("status",opp.status).eq("updated_at",opp.updated_at).select("id").maybeSingle();
    if(error)throw error;
    if(!updated)throw new ContractorAccessError("Opportunity changed. Reload and try again.",409);
   }
   await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,
    type:action==="cancelOpportunity"?"Opportunity Cancelled":action==="disputeOpportunity"?"Job Disputed":"Reschedule Requested",
    detail:{requestedBy:ctx.type}});
   await postPrivateMessage(ctx,thread,opp.id,reason);
   return noCache({ok:true});
  }
  if(action==="sendPaymentReminder"){
   requireInternal(ctx);
   const opp=await internalOpportunity(ctx,uuid(input.opportunityId));
   if(!opp.linked_job_id)throw new ContractorAccessError("This opportunity is not linked to a Job.",409);
   const invoiceId=uuid(input.invoiceId);
   const {data:invoice,error:ie}=await db.from("invoices")
    .select("id,invoice_number,total,amount_paid,due_date,status")
    .eq("id",invoiceId).eq("job_id",opp.linked_job_id)
    .is("archived_at",null).neq("status","Cancelled").maybeSingle();
   if(ie||!invoice)throw new ContractorAccessError("Invoice is not linked to this contractor Job.",404);
   const outstanding=Math.max(0,Number(invoice.total)-Number(invoice.amount_paid));
   if(outstanding<=0)throw new ContractorAccessError("There is no outstanding invoice balance.",409);
   const {data:company,error:ce}=await db.from("contractor_companies")
    .select("contact_email,name").eq("id",opp.company_id).single();
   if(ce||!company?.contact_email)throw new ContractorAccessError("Contractor email is unavailable.",409);
   const message=`Payment follow-up for invoice ${invoice.invoice_number}. Outstanding balance: ${outstanding.toFixed(2)}. Due date: ${invoice.due_date??"not specified"}. Please contact StudioScrubz Operations with payment questions.`;
   let sent;
   try{
    sent=await sendResendEmail({recipientEmail:company.contact_email,
      subject:`StudioScrubz payment follow-up | ${invoice.invoice_number}`,
      text:message,html:`<p>${message}</p>`,
      idempotencyKey:`contractor-invoice-reminder:${invoice.id}:${crypto.randomUUID()}`,
      replyTo:null});
   }catch(error){
    await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,
      type:"Contractor Payment Reminder Failed",detail:{invoiceId:invoice.id}});
    throw new ContractorAccessError("Email provider did not confirm reminder delivery.",503);
   }
   await audited(ctx,{companyId:opp.company_id,opportunityId:opp.id,
    type:"Contractor Payment Reminder Sent",
    detail:{invoiceId:invoice.id,providerMessageId:sent.id,outstanding}});
   return noCache({ok:true,providerMessageId:sent.id});
  }
  if(action==="setMemberAccess"){
   requireInternal(ctx);
   const memberId=uuid(input.memberId);
   if(typeof input.isActive!=="boolean")throw new ContractorAccessError("Active status must be specified.",400);
   const {data:member,error:me}=await db.from("contractor_members").select("id,company_id,user_id,member_role,is_active")
    .eq("id",memberId).maybeSingle();
   if(me||!member)throw new ContractorAccessError("Contractor member not found.",404);
   if(member.is_active===input.isActive)return noCache({ok:true,unchanged:true});
   if(input.isActive===false&&member.member_role==="Company Admin"){
    const {count,error:ce}=await db.from("contractor_members").select("id",{count:"exact",head:true})
      .eq("company_id",member.company_id).eq("member_role","Company Admin").eq("is_active",true);
    if(ce)throw ce;
    if((count??0)<=1)throw new ContractorAccessError("Assign another company administrator before deactivating the last one.",409);
   }
   const {error}=await db.from("contractor_members").update({is_active:input.isActive}).eq("id",member.id);
   if(error)throw error;
   await audited(ctx,{companyId:member.company_id,type:input.isActive?"Member Access Restored":"Member Access Deactivated",
     detail:{memberId:member.id}});
   return noCache({ok:true});
  }
  if(action==="logContactAttempt"||action==="createFollowup"){
   requireInternal(ctx);
   const companyId=uuid(input.companyId),oppId=input.opportunityId?uuid(input.opportunityId):null;
   const {data:company,error:ce}=await db.from("contractor_companies").select("id").eq("id",companyId).maybeSingle();
   if(ce||!company)throw new ContractorAccessError("Company not found.",404);
   if(oppId){
    const {data:op,error:oe}=await db.from("contractor_opportunities").select("id")
     .eq("id",oppId).eq("company_id",companyId).maybeSingle();
    if(oe||!op)throw new ContractorAccessError("Opportunity does not belong to this company.",404);
   }
   if(action==="logContactAttempt"){
    const method=required(input.method,"contact method",30);
    if(!["Phone","Email","SMS","Other"].includes(method))throw new ContractorAccessError("Invalid contact method.",400);
    const outcome=required(input.outcome,"contact outcome",200);
    const {data,error}=await db.from("contractor_contact_attempts").insert({
     company_id:companyId,opportunity_id:oppId,actor_id:ctx.userId,method,outcome,
     notes:optional(input.notes,3000),
    }).select("id").single();
    if(error)throw error;
    await audited(ctx,{companyId,opportunityId:oppId??undefined,type:"Contact Attempt Logged",
      detail:{attemptId:data.id,method}});
    return noCache({attemptId:data.id});
   }
   const note=required(input.note,"follow-up note",1000),due=required(input.dueAt,"follow-up date",40);
   if(!Number.isFinite(Date.parse(due)))throw new ContractorAccessError("Invalid follow-up date.",400);
   const managerId=input.managerId?uuid(input.managerId):ctx.userId;
   const {data:manager,error:managerError}=await db.from("user_profiles").select("id")
    .eq("id",managerId).in("role",["Manager","Master Admin"]).eq("is_active",true).maybeSingle();
   if(managerError||!manager)throw new ContractorAccessError("Select an active Operations Manager.",400);
   const {data,error}=await db.from("contractor_followups").insert({
    company_id:companyId,opportunity_id:oppId,created_by:ctx.userId,
    assigned_manager_id:managerId,note,due_at:new Date(due).toISOString(),
   }).select("id").single();
   if(error)throw error;
   await audited(ctx,{companyId,opportunityId:oppId??undefined,type:"Follow-up Scheduled",
    detail:{followupId:data.id,dueAt:due}});
   return noCache({followupId:data.id});
  }
  if(action==="resolveFollowup"){
   requireInternal(ctx);
   const id=uuid(input.followupId);
   const {data:followup,error:fe}=await db.from("contractor_followups")
    .select("id,company_id,opportunity_id,status").eq("id",id).maybeSingle();
   if(fe||!followup)throw new ContractorAccessError("Follow-up not found.",404);
   if(followup.status!=="Pending")return noCache({ok:true,unchanged:true});
   const {error}=await db.from("contractor_followups").update({
    status:"Completed",completed_at:new Date().toISOString(),
   }).eq("id",id).eq("status","Pending");
   if(error)throw error;
   await audited(ctx,{companyId:followup.company_id,opportunityId:followup.opportunity_id??undefined,
    type:"Follow-up Completed",detail:{followupId:id}});
   return noCache({ok:true});
  }
  throw new ContractorAccessError("Unknown contractor action.",400);
 } catch(error){return handleContractorError(error);}
}

async function notify(ctx:ContractorContext,subject:string,message:string,companyId:string,opportunityId:string|undefined,to:"internal"|"contractor",eventKey:string=crypto.randomUUID()){
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
   idempotencyKey:`contractor-event:${eventKey}`,replyTo:null});
  await audited(ctx,{companyId,opportunityId,type:"Email Notification Sent",
   detail:{recipient,providerId:response.id,subject}});
 }catch(error){
  console.error("Contractor notification delivery failed",error);
  try{await audited(ctx,{companyId,opportunityId,type:"Email Notification Failed",detail:{subject}});}catch{}
 }
}
