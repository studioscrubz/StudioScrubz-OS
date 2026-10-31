import { getSupabaseClient } from "@/lib/supabase/client";
import { usesSalesPipelineProjection, readSalesPipeline } from "@/lib/services/salesPipeline";
import { createClient } from "@/lib/services/clients";
import { createProperty } from "@/lib/services/properties";
import type { Client, ClientInput } from "@/types/client";
import type { CustomerInformation, Estimate, EstimateDivision, EstimateInsert, EstimateUpdate, EstimateWithRelations } from "@/types/estimate";
import type { Property, PropertyInput } from "@/types/property";

const estimateSelect = "*, client:clients!estimates_client_id_fkey(*), property:properties!estimates_property_id_fkey(*)";

export async function getEstimates(): Promise<EstimateWithRelations[]> {
  if (await usesSalesPipelineProjection()) return readSalesPipeline<EstimateWithRelations>("read_sales_estimates");
  const { data, error } = await getSupabaseClient().from("estimates").select(estimateSelect).order("created_at", { ascending: false });
  if (error) throw error;
  return data as EstimateWithRelations[];
}

export async function getEstimateById(id: string): Promise<EstimateWithRelations> {
  if (await usesSalesPipelineProjection()) {
    const item = (await readSalesPipeline<EstimateWithRelations>("read_sales_estimates")).find(row=>row.id===id);
    if (!item) throw new Error("Estimate not found.");
    return item;
  }
  const { data, error } = await getSupabaseClient().from("estimates").select(estimateSelect).eq("id", id).single();
  if (error) throw error;
  return data as EstimateWithRelations;
}

export async function createEstimate(input: Omit<EstimateInsert, "estimate_number">): Promise<Estimate> {
  if (await usesSalesPipelineProjection()) return saveSalesEstimate(null, input);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const payload: EstimateInsert = { ...input, estimate_number: generateEstimateNumber() };
    const { data, error } = await getSupabaseClient().from("estimates").insert(payload).select().single();
    if (!error) return data;
    if (error.code !== "23505") throw error;
  }
  throw new Error("A unique estimate number could not be generated. Please try again.");
}

export async function updateEstimate(id: string, input: EstimateUpdate): Promise<Estimate> {
  if (await usesSalesPipelineProjection()) return saveSalesEstimate(id, input);
  const { data, error } = await getSupabaseClient().from("estimates").update(input).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function calculateSalesEstimatePreview(input: { calculatorInput: unknown; manualPrice: number | null; serviceDescription: string }): Promise<Record<string, unknown>> {
  const response = await fetch("/api/sales-pipeline/estimates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "calculate", ...input, calculatorInput: publicCalculatorInput(input.calculatorInput) }) });
  const body = await response.json() as { result?: Record<string, unknown>; error?: string };
  if (!response.ok || !body.result) throw new Error(body.error || "Sales pricing could not be calculated.");
  return body.result;
}

async function saveSalesEstimate(id: string | null, input: Omit<EstimateInsert, "estimate_number"> | EstimateUpdate): Promise<Estimate> {
  if (!input.result) throw new Error("Pricing is required before saving the Estimate.");
  const { result, ...estimate } = input;
  const response = await fetch("/api/sales-pipeline/estimates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save", estimateId: id, estimate, calculatorInput: publicCalculatorInput(result.calculatorInput), manualPrice: result.manualPrice ?? null, serviceDescription: result.serviceDescription }) });
  const body = await response.json() as { estimate?: Estimate; error?: string };
  if (!response.ok || !body.estimate) throw new Error(body.error || "The Estimate could not be saved.");
  return body.estimate;
}

function publicCalculatorInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = { ...(value as Record<string, unknown>) };
  delete input.workerHourlyPay;
  delete input.targetProfitMarginPercent;
  delete input.projectCosting;
  delete input.projectExpenses;
  return input;
}

export async function archiveEstimate(id: string): Promise<Estimate> {
  const { data, error } = await getSupabaseClient().from("estimates").update({ archived_at: new Date().toISOString(), status: "Archived" }).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function declineEstimate(id: string, reason?: string | null): Promise<Estimate> {
  const { data, error } = await getSupabaseClient().from("estimates").update({ status: "Declined", declined_at: new Date().toISOString(), decline_reason: reason?.trim() || null }).eq("id", id).eq("status", "Open").is("archived_at", null).select().single();
  if (error) throw error;
  return data;
}

export async function markEstimateSent(id: string, input: { recipient: string; sender: string; token: string; expiresAt: string; snapshot: Record<string, unknown> }): Promise<{ sent_at: string }> {
  const { data, error } = await getSupabaseClient().rpc("mark_estimate_sent_for_delivery", { p_estimate_id:id, p_recipient:input.recipient.trim(), p_sender:input.sender, p_token:input.token, p_token_expires_at:input.expiresAt, p_snapshot:input.snapshot });
  if (error) throw error;
  return data;
}

export type EstimateApprovalHistoryRow = {
  id: string; estimate_id: string; version: number;
  action: "Submitted" | "Approved" | "Changes Requested" | "Revision Required";
  actor_id: string; from_status: string; to_status: string; notes: string | null; created_at: string;
};

type ApprovalRpcClient = {rpc:(functionName:string,args:Record<string,unknown>)=>Promise<{data:unknown,error:{message:string}|null}>};
const approvalRpc = () => getSupabaseClient() as unknown as ApprovalRpcClient;

export async function submitEstimateForApproval(id: string): Promise<Estimate> {
  const { data, error } = await approvalRpc().rpc("submit_estimate_for_approval", { p_estimate_id: id });
  if (error) throw error;
  return data as Estimate;
}

export async function reviewEstimateApproval(id: string, decision: "Approved" | "Changes Requested", notes: string | null): Promise<Estimate> {
  const { data, error } = await approvalRpc().rpc("review_estimate_approval", {
    p_estimate_id: id, p_decision: decision, p_notes: notes,
  });
  if (error) throw error;
  return data as Estimate;
}

export async function getEstimateApprovalHistory(id: string): Promise<EstimateApprovalHistoryRow[]> {
  const { data, error } = await approvalRpc().rpc("get_estimate_approval_history",{p_estimate_id:id});
  if (error) throw error;
  return (data ?? []) as EstimateApprovalHistoryRow[];
}

export async function findOrCreateEstimateClient(customer: CustomerInformation, division: EstimateDivision): Promise<Client> {
  const { data, error } = await getSupabaseClient().from("clients").select("*");
  if (error) throw new Error(`Client lookup failed: ${error.message}`);
  const email = normalize(customer.email); const phone = digits(customer.phone); const name = normalize(`${customer.firstName} ${customer.lastName}`);
  const match = data.find((client) =>
    (email && normalize(client.email) === email) ||
    (phone && digits(client.phone) === phone) ||
    (name && normalize(`${client.first_name ?? ""} ${client.last_name ?? ""}`) === name),
  );
  if (match) return match;
  const input: ClientInput = { client_type: division, first_name: clean(customer.firstName), last_name: clean(customer.lastName), company_name: division === "Commercial" ? clean(customer.companyName) : null, phone: clean(customer.phone), email: clean(customer.email), status: "Lead", notes: null };
  try { return await createClient(input); } catch (caught) { throw new Error(`Client creation failed: ${message(caught)}`); }
}

export async function findOrCreateEstimateProperty(clientId: string, customer: CustomerInformation, division: EstimateDivision): Promise<Property> {
  const { data, error } = await getSupabaseClient().from("properties").select("*").eq("client_id", clientId);
  if (error) throw new Error(`Property lookup failed: ${error.message}`);
  const location = normalizedLocation(customer);
  const match = data.find((property) => normalizedLocation({ address: property.address, addressLine2: property.address_line_2 ?? "", city: property.city ?? "", state: property.state ?? "", zip: property.zip ?? "" }) === location);
  if (match) return match;
  const input: PropertyInput = { client_id: clientId, property_name: null, property_type: division, address: customer.address.trim(), address_line_2: clean(customer.addressLine2), city: clean(customer.city), state: clean(customer.state), zip: clean(customer.zip), square_feet: null, floors: null, bedrooms: null, bathrooms: null, access_instructions: null, notes: null };
  try { return await createProperty(input); } catch (caught) { throw new Error(`Property creation failed: ${message(caught)}`); }
}

export async function updateEstimateRelationships(estimate: EstimateWithRelations, customer: CustomerInformation, division: EstimateDivision): Promise<{ client: Client; property: Property }> {
  if (!estimate.client_id || !estimate.property_id || !estimate.client) throw new Error("This historical Estimate has a deleted Client or Property relationship.");
  const clientInput: ClientInput = { client_type: division, first_name: clean(customer.firstName), last_name: clean(customer.lastName), company_name: division === "Commercial" ? clean(customer.companyName) : null, phone: clean(customer.phone), email: clean(customer.email), status: estimate.client.status, notes: estimate.client.notes };
  const { data: client, error: clientError } = await getSupabaseClient().from("clients").update(clientInput).eq("id", estimate.client_id).select().single();
  if (clientError) throw new Error(`Client update failed: ${clientError.message}`);
  const propertyInput: Partial<PropertyInput> = { property_type: division, address: customer.address.trim(), address_line_2: clean(customer.addressLine2), city: clean(customer.city), state: clean(customer.state), zip: clean(customer.zip) };
  const { data: property, error: propertyError } = await getSupabaseClient().from("properties").update(propertyInput).eq("id", estimate.property_id).select().single();
  if (propertyError) throw new Error(`Property update failed: ${propertyError.message}`);
  return { client, property };
}

function generateEstimateNumber(): string { const date = new Date(); const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`; const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, "0"); return `EST-${day}-${suffix}`; }
function normalize(value: string | null): string { return value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") ?? ""; }
function digits(value: string | null): string { return value?.replace(/\D/g, "") ?? ""; }
function clean(value: string): string | null { return value.trim() || null; }
function normalizedLocation(value: { address: string; addressLine2: string; city: string; state: string; zip: string }): string { return [value.address, value.addressLine2, value.city, value.state, value.zip].map((part) => normalize(part).replace(/[^a-z0-9]/g, "")).join("|"); }
function message(error: unknown): string { return error instanceof Error ? error.message : "Unknown Supabase error"; }
