import { getSupabaseClient } from "@/lib/supabase/client";
import { generateServiceDates } from "@/lib/scheduling/recurrence";
import { getAgreementById } from "@/lib/services/agreements";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import type { ServiceOccurrence, ServiceOccurrenceWithRelations } from "@/types/serviceOccurrence";
import type { JobWithRelations } from "@/types/job";
import { requestPendingJobCalendarSync } from "@/lib/google-calendar/client";

const deletedOccurrenceMarker = "[Deleted upcoming service — retained to prevent schedule regeneration]";
const reconciledOccurrenceMarker = "[Cancelled by Agreement schedule reconciliation]";
const select = "*, agreement:service_agreements!service_occurrences_agreement_id_fkey(*), crew:crews!service_occurrences_assigned_crew_id_fkey(*), job:jobs!service_occurrences_job_id_fkey(*)";

export function isDeletedOccurrence(occurrence: Pick<ServiceOccurrence, "notes">) { return occurrence.notes?.includes(deletedOccurrenceMarker) ?? false; }
export async function getOccurrences() { const { data, error } = await getSupabaseClient().from("service_occurrences").select(select).order("scheduled_date"); if (error) throw error; return data as ServiceOccurrenceWithRelations[]; }
export async function getOccurrencesForAgreement(id: string) { const rows = await getOccurrences(); return rows.filter((row) => row.agreement_id === id); }
export async function getUpcomingOccurrences(start: string, end: string) { const { data, error } = await getSupabaseClient().from("service_occurrences").select(select).gte("scheduled_date", start).lte("scheduled_date", end).order("scheduled_date"); if (error) throw error; return data as ServiceOccurrenceWithRelations[]; }

export async function generateOccurrences(agreementId: string, horizonDays = 60) {
  const agreement = await getAgreementById(agreementId);
  if (agreement.status !== "Active") throw new Error("Only active agreements generate occurrences.");
  await reconcileFutureOccurrences(agreementId, horizonDays);
  return getOccurrencesForAgreement(agreementId);
}

export async function reconcileFutureOccurrences(agreementId: string, horizonDays = 60) {
  const db = getSupabaseClient();
  const [agreement, settings, existing] = await Promise.all([getAgreementById(agreementId), getBusinessSettings(), getOccurrencesForAgreement(agreementId)]);
  const currentDate = businessDate(settings.timezone), end = add(currentDate, horizonDays), windowStart = agreement.start_date > currentDate ? agreement.start_date : currentDate;
  const desired = agreement.status === "Active"
    ? new Set(generateServiceDates(agreement.start_date, end, agreement.frequency, { daysOfWeek: agreement.days_of_week, intervalWeeks: agreement.interval_weeks, dayOfMonth: agreement.day_of_month, secondDayOfMonth: agreement.second_day_of_month, thirdDayOfMonth: agreement.third_day_of_month, customIntervalDays: agreement.custom_interval_days }, agreement.end_date, agreement.auto_renew).filter((date) => date >= windowStart))
    : new Set<string>();
  const future = existing.filter((row) => row.scheduled_date >= currentDate), byDate = new Map(future.map((row) => [row.scheduled_date, row]));
  for (const row of future) {
    if (row.job_id) continue;
    const reconciliationCancellation = row.status === "Cancelled" && row.notes?.includes(reconciledOccurrenceMarker);
    if (desired.has(row.scheduled_date)) {
      if (row.status === "Scheduled" || reconciliationCancellation) {
        const notes = reconciliationCancellation ? removeMarker(row.notes, reconciledOccurrenceMarker) : row.notes;
        const { error } = await db.from("service_occurrences").update({ status: "Scheduled", scheduled_start_time: agreement.default_start_time, assigned_crew_id: agreement.assigned_crew_id, notes }).eq("id", row.id);
        if (error) throw error;
      }
    } else if (row.status === "Scheduled") {
      const { error } = await db.from("service_occurrences").update({ status: "Cancelled", notes: appendMarker(row.notes, reconciledOccurrenceMarker) }).eq("id", row.id);
      if (error) throw error;
    }
  }
  const payload = [...desired].filter((date) => !byDate.has(date)).map((scheduled_date) => ({ agreement_id: agreement.id, scheduled_date, scheduled_start_time: agreement.default_start_time, assigned_crew_id: agreement.assigned_crew_id, status: "Scheduled" as const }));
  if (payload.length) { const { error } = await db.from("service_occurrences").upsert(payload, { onConflict: "agreement_id,scheduled_date", ignoreDuplicates: true }); if (error) throw error; }
  return getOccurrencesForAgreement(agreement.id);
}

export async function createJobFromOccurrence(id: string): Promise<JobWithRelations> {
  const { data, error } = await getSupabaseClient().rpc("create_job_from_service_occurrence", { p_occurrence_id: id });
  if (error) throw error;
  const { getJobById } = await import("@/lib/services/jobs");
  const job=await getJobById(data.id);
  await requestPendingJobCalendarSync(job.id);
  return job;
}

export const skipOccurrence = (id: string) => update(id, { status: "Skipped" });
export const cancelOccurrence = (id: string) => update(id, { status: "Cancelled" });
export async function deleteOccurrence(id: string) {
  const db = getSupabaseClient(), { data, error } = await db.from("service_occurrences").select("id,scheduled_date,status,job_id,notes").eq("id", id).single();
  if (error) throw error;
  if (data.job_id) throw new Error("This service already has a Job. Cancel the Job or occurrence instead.");
  if (data.status !== "Scheduled") throw new Error("Only an upcoming Scheduled service with no operational history can be deleted.");
  if (data.scheduled_date < today()) throw new Error("Past or completed service occurrences cannot be deleted.");
  const linkedJob = await db.from("jobs").select("id").eq("service_occurrence_id", id).limit(1).maybeSingle();
  if (linkedJob.error) throw linkedJob.error;
  if (linkedJob.data) throw new Error("This service generated a Job and must remain in operational history.");
  const tombstone = await db.from("service_occurrences").update({ status: "Cancelled", notes: appendMarker(data.notes, deletedOccurrenceMarker) }).eq("id", id).is("job_id", null).eq("status", "Scheduled").gte("scheduled_date", today()).select().maybeSingle();
  if (tombstone.error) throw tombstone.error;
  if (!tombstone.data) throw new Error("This service changed and is no longer eligible for deletion.");
  return tombstone.data;
}
export const rescheduleOccurrence = (id: string, date: string, time: string | null) => update(id, { scheduled_date: date, scheduled_start_time: time });
async function update(id: string, input: Partial<ServiceOccurrence>) { const { data, error } = await getSupabaseClient().from("service_occurrences").update(input).eq("id", id).select().single(); if (error?.code === "23505") throw new Error("An occurrence already exists for this agreement on that date."); if (error) throw error; return data; }
function today() { return new Date().toISOString().slice(0, 10); }
function add(value: string, days: number) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return localDate(date); }
function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function businessDate(timeZone: string | null) { const now = new Date(); if (!timeZone) return today(); try { const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now), get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""; return `${get("year")}-${get("month")}-${get("day")}`; } catch { return today(); } }
function appendMarker(notes: string | null, marker: string) { return notes?.includes(marker) ? notes : notes ? `${notes}\n${marker}` : marker; }
function removeMarker(notes: string | null, marker: string) { const value = (notes ?? "").split("\n").filter((line) => line.trim() !== marker).join("\n").trim(); return value || null; }
