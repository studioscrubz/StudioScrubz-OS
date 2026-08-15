import { getSupabaseClient } from "@/lib/supabase/client";
import { getJobs } from "@/lib/services/jobs";
import { getUpcomingOccurrences } from "@/lib/services/serviceOccurrences";
import { getProperties } from "@/lib/services/properties";
import type { ClientCommunication, ClientCommunicationInput, CommunicationRecordFilter, UpcomingClientService } from "@/types/clientCommunication";

export async function getUpcomingServicesForClient(clientId: string): Promise<UpcomingClientService[]> {
  const start = localDate();
  const end = addDays(start, 365);
  const [jobsResult, occurrencesResult, propertiesResult] = await Promise.allSettled([
    getJobs(), getUpcomingOccurrences(start, end), getProperties(),
  ]);
  if (jobsResult.status === "rejected" && occurrencesResult.status === "rejected")
    throw new Error("Upcoming services could not be loaded for the current user.");
  const properties = propertiesResult.status === "fulfilled" ? propertiesResult.value : [];
  const propertyMap = new Map(properties.map((property) => [property.id, formatPropertyAddress(property)]));
  const jobs = jobsResult.status === "fulfilled" ? jobsResult.value : [];
  const upcomingJobs: UpcomingClientService[] = jobs
    .filter((job) => job.client_id === clientId && job.scheduled_date && job.scheduled_date >= start && !job.archived_at && !["Cancelled", "Completed", "Archived"].includes(job.status))
    .map((job) => ({
      source: "Job", sourceId: job.id, clientId, propertyId: job.property_id,
      serviceName: job.service_name || "Scheduled Service", scheduledDate: job.scheduled_date!, startTime: job.start_time,
      propertyAddress: job.property?.address ? formatPropertyAddress(job.property) : (job.property_id ? propertyMap.get(job.property_id) ?? null : null),
    }));
  const jobOccurrenceIds = new Set(jobs.map((job) => job.service_occurrence_id).filter((id): id is string => Boolean(id)));
  const occurrences = occurrencesResult.status === "fulfilled" ? occurrencesResult.value : [];
  const upcomingOccurrences: UpcomingClientService[] = occurrences
    .filter((occurrence) => occurrence.agreement.client_id === clientId && !jobOccurrenceIds.has(occurrence.id) && !["Cancelled", "Completed", "Skipped"].includes(occurrence.status))
    .map((occurrence) => ({
      source: "Service Occurrence", sourceId: occurrence.id, clientId,
      propertyId: occurrence.agreement.property_id, serviceName: occurrence.agreement.service_name || "Scheduled Service",
      scheduledDate: occurrence.scheduled_date, startTime: occurrence.scheduled_start_time,
      propertyAddress: occurrence.agreement.property_id ? propertyMap.get(occurrence.agreement.property_id) ?? null : null,
    }));
  return [...upcomingJobs, ...upcomingOccurrences].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || (a.startTime ?? "23:59").localeCompare(b.startTime ?? "23:59"));
}

export async function getClientCommunications(clientId: string, includeArchived = false): Promise<ClientCommunication[]> {
  let query = getSupabaseClient().from("client_communications").select("*").eq("client_id", clientId);
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(`Client communications could not be loaded: ${error.message}`);
  return data as ClientCommunication[];
}

export async function getAllClientCommunications(includeArchived = false): Promise<ClientCommunication[]> {
  let query = getSupabaseClient().from("client_communications").select("*");
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(`Client communications could not be loaded: ${error.message}`);
  return data as ClientCommunication[];
}

export async function getCommunicationsForRecord(filters: CommunicationRecordFilter, includeArchived = false): Promise<ClientCommunication[]> {
  const entries = Object.entries(filters).filter((entry): entry is [keyof CommunicationRecordFilter, string] => Boolean(entry[1]));
  if (!entries.length) throw new Error("A record identifier is required to load communications.");
  const columns: Record<keyof CommunicationRecordFilter, string> = { estimateId: "estimate_id", proposalId: "proposal_id", agreementId: "agreement_id", invoiceId: "invoice_id" };
  let query = getSupabaseClient().from("client_communications").select("*");
  if (!includeArchived) query = query.is("archived_at", null);
  for (const [key, value] of entries) query = query.eq(columns[key], value);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(`Record communications could not be loaded: ${error.message}`);
  return data as ClientCommunication[];
}

export async function createCommunication(input: ClientCommunicationInput): Promise<ClientCommunication> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await getSupabaseClient().from("client_communications").insert({
      ...input,
      communication_number: communicationNumber(),
      direction: input.direction ?? "Outbound",
      status: input.status ?? "Prepared",
      metadata: input.metadata ?? {},
    }).select().single();
    if (!error) return data as ClientCommunication;
    if (error.code !== "23505") throw new Error(`Communication could not be created: ${error.message}`);
  }
  throw new Error("A unique communication number could not be generated.");
}

export async function createCommunicationOnce(input: ClientCommunicationInput & { event_key: string }): Promise<ClientCommunication> {
  const existing = await findByEventKey(input.event_key);
  if (existing) return existing;
  try { return await createCommunication(input); }
  catch (cause) {
    const raced = await findByEventKey(input.event_key);
    if (raced) return raced;
    throw cause;
  }
}

type SentDocumentInput = {
  id: string; number: string; clientId: string | null; propertyId: string | null;
  recipientEmail: string | null; subject: string; messageBody: string; sentAt: string;
  recipientPhone?: string | null;
  channel?: "Email" | "SMS";
  provider?: "mailto" | "device";
};

export const recordEstimateSent = (input: SentDocumentInput) => recordDocumentSent("Estimate", "estimate_id", "estimate_number", input);
export const recordProposalSent = (input: SentDocumentInput) => recordDocumentSent("Proposal", "proposal_id", "proposal_number", input);
export const recordAgreementSent = (input: SentDocumentInput) => recordDocumentSent("Service Agreement", "agreement_id", "agreement_number", input);
export const recordInvoiceSent = (input: SentDocumentInput) => recordDocumentSent("Invoice", "invoice_id", "invoice_number", input);
export const recordPaymentReminderSent = (input: SentDocumentInput) => recordDocumentSent("Payment Reminder", "invoice_id", "invoice_number", input);

export async function markCommunicationSent(id: string): Promise<ClientCommunication> {
  return updateDeliveryStatus(id, "Sent", null);
}

export async function markCommunicationFailed(id: string, reason: string): Promise<ClientCommunication> {
  if (!reason.trim()) throw new Error("A failure reason is required.");
  return updateDeliveryStatus(id, "Failed", reason.trim());
}

export async function archiveCommunication(id: string): Promise<ClientCommunication> {
  return updateCommunication(id, { status: "Archived", archived_at: new Date().toISOString() });
}

export function agreementCommunicationInput(input: Omit<ClientCommunicationInput, "communication_type" | "channel" | "direction">): ClientCommunicationInput {
  return { ...input, communication_type: "Service Agreement", channel: "Email", direction: "Outbound" };
}

export async function recordAgreementSigned(input: Omit<ClientCommunicationInput, "communication_type" | "channel" | "direction" | "status">): Promise<ClientCommunication> {
  return createCommunication({ ...agreementCommunicationInput(input), direction: "System", channel: "In App", status: "Sent", sent_at: input.sent_at ?? new Date().toISOString() });
}

async function recordDocumentSent(type: "Estimate" | "Proposal" | "Service Agreement" | "Invoice" | "Payment Reminder", linkColumn: "estimate_id" | "proposal_id" | "agreement_id" | "invoice_id", numberKey: string, input: SentDocumentInput) {
  return createCommunicationOnce({
    client_id: input.clientId, property_id: input.propertyId, [linkColumn]: input.id,
    communication_type: type, channel: input.channel ?? "Email", direction: "Outbound", status: "Sent", provider: input.provider ?? (input.channel === "SMS" ? "device" : "mailto"),
    recipient_email: input.recipientEmail, recipient_phone: input.recipientPhone ?? null, subject: input.subject, message_body: input.messageBody, sent_at: input.sentAt,
    metadata: { [numberKey]: input.number }, event_key: `${type.toLowerCase().replaceAll(" ", "-")}:${input.id}:sent:${input.sentAt}`,
  });
}

async function findByEventKey(eventKey: string): Promise<ClientCommunication | null> {
  const { data, error } = await getSupabaseClient().from("client_communications").select("*").eq("event_key", eventKey).maybeSingle();
  if (error) throw new Error(`Communication history could not be checked: ${error.message}`);
  return data as ClientCommunication | null;
}

async function updateCommunication(id: string, input: Partial<ClientCommunication>): Promise<ClientCommunication> {
  const { data, error } = await getSupabaseClient().from("client_communications").update(input).eq("id", id).select().single();
  if (error) throw new Error(`Communication could not be updated: ${error.message}`);
  return data as ClientCommunication;
}

type DeliveryStatusRpcResult = { data: ClientCommunication | null; error: { message: string } | null };
type DeliveryStatusRpc = (name: "mark_client_communication_delivery_status", args: { p_communication_id: string; p_status: "Sent" | "Failed"; p_failure_reason: string | null }) => PromiseLike<DeliveryStatusRpcResult>;
async function updateDeliveryStatus(id: string, status: "Sent" | "Failed", failureReason: string | null): Promise<ClientCommunication> {
  const rpc = getSupabaseClient().rpc as unknown as DeliveryStatusRpc;
  const { data, error } = await rpc("mark_client_communication_delivery_status", { p_communication_id: id, p_status: status, p_failure_reason: failureReason });
  if (error) throw new Error(`Communication delivery status could not be updated: ${error.message}`);
  if (!data) throw new Error("Communication delivery status was not updated.");
  return data;
}

function communicationNumber() {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `COMM-${date}-${suffix}`;
}

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function addDays(value: string, days: number) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return localDateFor(date); }
function localDateFor(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function formatPropertyAddress(property: { address: string; address_line_2: string | null; city: string | null; state: string | null; zip: string | null }) {
  const locality = [property.city, property.state].filter(Boolean).join(", ");
  return [property.address, property.address_line_2, [locality, property.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
}
