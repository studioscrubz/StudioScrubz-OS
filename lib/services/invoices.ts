import { getSupabaseClient } from "@/lib/supabase/client";
import { getJobById } from "@/lib/services/jobs";
import type { Invoice, InvoiceLineItem, InvoiceStatus, InvoiceUpdate, InvoiceWithRelations, StandaloneInvoiceInput } from "@/types/invoice";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import { getAgreementById, getAgreementFinancialSummary } from "@/lib/services/agreements";
import { clientTokenExpiration, generateSecureClientToken, validClientToken } from "@/lib/secureClientToken";

const select = "*, job:jobs!invoices_job_id_fkey(*, proposal:proposals!jobs_proposal_id_fkey(*), client:clients!jobs_client_id_fkey(*), property:properties!jobs_property_id_fkey(*)), agreement:service_agreements!invoices_service_agreement_id_fkey(*), proposal:proposals!invoices_proposal_id_fkey(*), client:clients!invoices_client_id_fkey(*), property:properties!invoices_property_id_fkey(*)";

export async function getInvoices():Promise<InvoiceWithRelations[]>{const{data,error}=await getSupabaseClient().from("invoices").select(select).order("created_at",{ascending:false});if(error)throw error;return data as unknown as InvoiceWithRelations[]}
export async function getInvoiceById(id:string):Promise<InvoiceWithRelations>{const{data,error}=await getSupabaseClient().from("invoices").select(select).eq("id",id).single();if(error)throw error;return data as unknown as InvoiceWithRelations}
export async function ensureInvoicePublicAccess(invoice:InvoiceWithRelations):Promise<{token:string;expiresAt:string|null}>{
  if(validClientToken(invoice.client_access_token,invoice.client_access_token_expires_at)&&invoice.client_access_token.length>=40){
    return{token:invoice.client_access_token,expiresAt:invoice.client_access_token_expires_at};
  }
  const token=generateSecureClientToken(),expiresAt=clientTokenExpiration();
  let update=getSupabaseClient().from("invoices")
    .update({client_access_token:token,client_access_token_expires_at:expiresAt})
    .eq("id",invoice.id);
  update=invoice.client_access_token===null?update.is("client_access_token",null):update.eq("client_access_token",invoice.client_access_token);
  const{data,error}=await update
    .select("id,client_access_token,client_access_token_expires_at")
    .maybeSingle();
  if(error)throw new Error(`Public Invoice link could not be saved: ${error.message}`);
  if(!data){
    const{data:current,error:readError}=await getSupabaseClient().from("invoices")
      .select("id,client_access_token,client_access_token_expires_at")
      .eq("id",invoice.id)
      .maybeSingle();
    if(readError)throw new Error(`Public Invoice link could not be verified: ${readError.message}`);
    if(current&&validClientToken(current.client_access_token,current.client_access_token_expires_at)&&current.client_access_token.length>=40){
      return{token:current.client_access_token,expiresAt:current.client_access_token_expires_at};
    }
    throw new Error("Public Invoice link could not be saved. Your account may not have permission to update this Invoice.");
  }
  if(data.id!==invoice.id||data.client_access_token!==token||!data.client_access_token_expires_at||Date.parse(data.client_access_token_expires_at)!==Date.parse(expiresAt)){
    throw new Error("Public Invoice link could not be verified after saving.");
  }
  return{token:data.client_access_token,expiresAt:data.client_access_token_expires_at};
}
export async function getInvoiceForJob(jobId:string):Promise<InvoiceWithRelations|null>{const{data,error}=await getSupabaseClient().from("invoices").select(select).eq("job_id",jobId).is("archived_at",null).neq("status","Cancelled").maybeSingle();if(error)throw error;return data as unknown as InvoiceWithRelations|null}
export async function canCreateJobInvoice(jobId:string){const job=await getJobById(jobId);return !(await isContractOccurrence(job.service_occurrence_id))}
export async function getFinanciallyResolvedJobIds():Promise<string[]>{const db=getSupabaseClient();const[invoicesResult,paymentsResult]=await Promise.all([db.from("invoices").select("id,job_id,status,archived_at,amount_paid,balance_due").not("job_id","is",null),db.from("payments").select("invoice_id").not("invoice_id","is",null)]);if(invoicesResult.error)throw invoicesResult.error;if(paymentsResult.error)throw paymentsResult.error;const paidInvoiceIds=new Set((paymentsResult.data??[]).map(row=>row.invoice_id).filter((id):id is string=>Boolean(id)));return[...new Set((invoicesResult.data??[]).filter(invoice=>invoice.job_id&&((invoice.archived_at===null&&!['Cancelled','Archived'].includes(invoice.status))||paidInvoiceIds.has(invoice.id)||(Number(invoice.amount_paid)>0&&Number(invoice.balance_due)<=0))).map(invoice=>invoice.job_id).filter((id):id is string=>Boolean(id)))]}
export const getInvoicedJobIds=getFinanciallyResolvedJobIds;
export async function createInvoiceFromJob(jobId:string):Promise<InvoiceWithRelations>{const[job,settings]=await Promise.all([getJobById(jobId),getBusinessSettings()]);if(job.service_occurrence?.agreement.billing_type&&job.service_occurrence.agreement.billing_type!=="Per Visit")throw new Error("This occurrence is billed through its Service Agreement, not through an individual Job invoice.");if(job.status!=="Completed")throw new Error("Only completed Jobs can be invoiced.");const existing=await getInvoiceForJob(jobId);if(existing)return existing;const amount=Math.max(job.price,0);const item:InvoiceLineItem={id:crypto.randomUUID(),description:job.service_name||"StudioScrubz service",quantity:1,rate:amount,amount};const issue=localDate();const input={job_id:job.id,service_agreement_id:null,contract_billing_type:null,billing_period_start:null,proposal_id:job.proposal_id,client_id:job.client_id,property_id:job.property_id,client_name:job.client_name,property_name:job.property_name,customer_phone:job.client?.phone?.trim()||job.proposal?.customer_phone?.trim()||null,customer_email:job.client?.email?.trim()||job.proposal?.customer_email?.trim()||null,service_name:job.service_name,status:"Open" as InvoiceStatus,issue_date:issue,due_date:addDays(issue,settings.default_invoice_due_days),line_items:[item],subtotal:amount,discount:0,tax:0,total:amount,amount_paid:0,balance_due:amount,notes:job.internal_notes,terms:settings.default_invoice_terms??settings.default_payment_terms};for(let attempt=0;attempt<5;attempt++){const{data,error}=await getSupabaseClient().from("invoices").insert({...input,invoice_number:invoiceNumber()}).select(select).single();if(!error)return data as InvoiceWithRelations;if(error.code==="23505"){const duplicate=await getInvoiceForJob(jobId);if(duplicate)return duplicate;continue}throw error}throw new Error("A unique invoice number could not be generated.")}
export async function createStandaloneInvoice(input:StandaloneInvoiceInput):Promise<InvoiceWithRelations>{
  const clientName=input.client_name.trim(),propertyName=input.property_name.trim(),serviceName=input.service_name.trim();
  if(!input.client_id||!clientName)throw new Error("Select a Client and provide a customer name.");
  if(!input.property_id||!propertyName)throw new Error("Select a Property or service location.");
  if(!serviceName)throw new Error("A service name is required.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.issue_date)||input.due_date&&!/^\d{4}-\d{2}-\d{2}$/.test(input.due_date))throw new Error("Enter valid Invoice dates.");
  if(input.due_date&&input.due_date<input.issue_date)throw new Error("Due date cannot be before the issue date.");
  if(input.customer_email&&!/^\S+@\S+\.\S+$/.test(input.customer_email.trim()))throw new Error("Enter a valid customer email address or leave it blank.");
  const [{data:client,error:clientError},{data:property,error:propertyError}]=await Promise.all([
    getSupabaseClient().from("clients").select("id").eq("id",input.client_id).is("archived_at",null).maybeSingle(),
    getSupabaseClient().from("properties").select("id,client_id").eq("id",input.property_id).is("archived_at",null).maybeSingle(),
  ]);
  if(clientError)throw clientError;if(propertyError)throw propertyError;
  if(!client)throw new Error("The selected Client is unavailable.");
  if(!property||property.client_id!==client.id)throw new Error("Select an active Property belonging to this Client.");
  const calculated=calculateInvoiceAmounts(input.line_items,input.discount,input.tax);
  if(calculated.total<=0)throw new Error("Invoice total must be greater than zero.");
  const record={job_id:null,service_agreement_id:null,contract_billing_type:null,billing_period_start:null,proposal_id:null,
    client_id:client.id,property_id:property.id,client_name:clientName,property_name:propertyName,
    customer_phone:input.customer_phone?.trim()||null,customer_email:input.customer_email?.trim().toLowerCase()||null,
    service_name:serviceName,status:"Open" as InvoiceStatus,issue_date:input.issue_date,due_date:input.due_date,
    ...calculated,amount_paid:0,balance_due:calculated.total,notes:input.notes?.trim()||null,
    customer_notes:input.customer_notes?.trim()||null,terms:input.terms?.trim()||null};
  for(let attempt=0;attempt<5;attempt++){
    const{data,error}=await getSupabaseClient().from("invoices").insert({...record,invoice_number:invoiceNumber()}).select(select).single();
    if(!error)return data as unknown as InvoiceWithRelations;
    if(error.code!=="23505")throw error;
  }
  throw new Error("A unique Invoice number could not be generated.");
}
export type CompletedJobInvoiceResult={invoice_id:string|null;invoice_number:string|null;created:boolean;skipped:boolean};
export async function createCompletedJobInvoice(jobId:string):Promise<CompletedJobInvoiceResult>{const{data,error}=await getSupabaseClient().rpc("create_completed_job_invoice",{p_job_id:jobId});if(error)throw error;if(!data||typeof data!=="object")throw new Error("The completed Job invoice result was invalid.");return data as CompletedJobInvoiceResult}
export async function getAgreementInvoices(agreementId:string):Promise<InvoiceWithRelations[]>{const{data,error}=await getSupabaseClient().from("invoices").select(select).eq("service_agreement_id",agreementId).order("issue_date",{ascending:false});if(error)throw error;return data as unknown as InvoiceWithRelations[]}
export const createWeeklyContractInvoice=(input:{agreementId:string;billingPeriodStart:string})=>createContractAgreementInvoice(input.agreementId,input.billingPeriodStart,null);
export const createBiweeklyContractInvoice=(input:{agreementId:string;billingPeriodStart:string})=>createContractAgreementInvoice(input.agreementId,input.billingPeriodStart,null);
export async function createMonthlyContractInvoice(input:{agreementId:string;billingMonth:string}){return createContractAgreementInvoice(input.agreementId,normalizeMonth(input.billingMonth),null)}
export async function createFlatContractInvoice(input:{agreementId:string;amount:number}){const agreement=await getAgreementById(input.agreementId),amount=round(input.amount);if(agreement.billing_type!=="Flat Contract")throw new Error("This Agreement does not use Flat Contract billing.");const summary=await getAgreementFinancialSummary(agreement.id);if(summary.remaining===null||amount<=0||amount>round(summary.remaining))throw new Error("Invoice amount must be greater than zero and cannot exceed the remaining contract value.");return createContractAgreementInvoice(agreement.id,null,amount)}
async function createContractAgreementInvoice(agreementId:string,period:string|null,flatAmount:number|null){const{data,error}=await getSupabaseClient().rpc("create_contract_agreement_invoice",{p_agreement_id:agreementId,p_billing_period_start:period,p_flat_contract_amount:flatAmount});if(error)throw error;return getInvoiceById(data.id)}
function normalizeMonth(value:string){const match=/^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value);if(!match||Number(match[2])<1||Number(match[2])>12)throw new Error("Choose a valid billing month.");return`${match[1]}-${match[2]}-01`}
async function isContractOccurrence(occurrenceId:string|null){if(!occurrenceId)return false;const{data,error}=await getSupabaseClient().from("service_occurrences").select("agreement:service_agreements!service_occurrences_agreement_id_fkey(billing_type)").eq("id",occurrenceId).maybeSingle();if(error)throw error;const type=(data?.agreement as {billing_type:string}|null)?.billing_type;return Boolean(type&&type!=="Per Visit")}
export async function updateInvoice(id:string,input:InvoiceUpdate):Promise<Invoice>{const{data,error}=await getSupabaseClient().from("invoices").update(input).eq("id",id).select().single();if(error)throw error;return data as Invoice}
export async function saveInvoice(id:string,input:{line_items:InvoiceLineItem[];discount:number;issue_date:string;due_date:string|null;notes:string|null;customer_notes:string|null;terms:string|null}){const current=await getInvoiceById(id);if(current.contract_billing_type)throw new Error("Contract invoice pricing is managed from its Service Agreement.");const calculated=calculateInvoiceAmounts(input.line_items,input.discount,current.tax);return updateInvoice(id,{...input,...calculated,balance_due:Math.max(round(calculated.total-current.amount_paid),0),status:paymentStatus(current.status,current.amount_paid,calculated.total),paid_at:current.amount_paid>=calculated.total&&calculated.total>0?current.paid_at??new Date().toISOString():null})}
export async function sendInvoice(id:string,via:"Text"|"Email"){const invoice=await getInvoiceById(id);if(via==="Text"&&!invoice.customer_phone)throw new Error("This invoice does not have a customer phone number.");if(via==="Email"&&!invoice.customer_email)throw new Error("This invoice does not have a customer email address.");return updateInvoice(id,{status:"Sent",sent_at:new Date().toISOString()})}
export const cancelInvoice=(id:string)=>updateInvoice(id,{status:"Cancelled"});
export const archiveInvoice=(id:string)=>updateInvoice(id,{status:"Archived",archived_at:new Date().toISOString()});
export async function markPastDueInvoices(rows:InvoiceWithRelations[]){const due=rows.filter(x=>x.due_date&&x.due_date<localDate()&&x.balance_due>0&&!(["Paid","Cancelled","Archived","Past Due"] as InvoiceStatus[]).includes(x.status));if(!due.length)return false;const{error}=await getSupabaseClient().from("invoices").update({status:"Past Due"}).in("id",due.map(x=>x.id));if(error)throw error;return true}
function paymentStatus(current:InvoiceStatus,paid:number,total:number):InvoiceStatus{if(paid>=total&&total>0)return"Paid";if(paid>0)return"Partially Paid";return current==="Draft"?"Draft":current==="Sent"?"Sent":"Open"}
function invoiceNumber(){const d=new Date();return`INV-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}-${String(Math.floor(Math.random()*10000)).padStart(4,"0")}`}
function localDate(d=new Date()){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function addDays(date:string,n:number){const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+n);return localDate(d)}
const round=(n:number)=>Math.round(n*100)/100;
export function calculateInvoiceAmounts(items:InvoiceLineItem[],discountValue:number,taxValue:number){
  return calculateInvoiceAmountsInternal(items,discountValue,taxValue,true);
}
export function previewInvoiceAmounts(items:InvoiceLineItem[],discountValue:number,taxValue:number){
  return calculateInvoiceAmountsInternal(items,discountValue,taxValue,false);
}
function calculateInvoiceAmountsInternal(items:InvoiceLineItem[],discountValue:number,taxValue:number,strict:boolean){
  if(strict&&!items.length)throw new Error("At least one line item is required.");
  const line_items=items.map(item=>{const description=item.description.trim(),rawQuantity=Number(item.quantity),rawRate=Number(item.rate),quantity=round(Number.isFinite(rawQuantity)?rawQuantity:0),rate=round(Number.isFinite(rawRate)?rawRate:0);if(strict&&!description)throw new Error("Every line item requires a description.");if(strict&&(!Number.isFinite(rawQuantity)||quantity<=0))throw new Error("Line item quantities must be greater than zero.");if(strict&&!Number.isFinite(rawRate))throw new Error("Every line item requires a valid rate.");if(strict&&rate<0)throw new Error("Line item rates cannot be negative.");return{...item,description,quantity:Math.max(quantity,0),rate:Math.max(rate,0),amount:round(Math.max(quantity,0)*Math.max(rate,0))}});
  const subtotal=round(line_items.reduce((sum,item)=>sum+item.amount,0));
  const discount=round(Math.min(Math.max(Number(discountValue)||0,0),subtotal));
  const tax=round(Math.max(Number(taxValue)||0,0));
  return{line_items,subtotal,discount,tax,total:round(Math.max(subtotal-discount+tax,0))};
}
