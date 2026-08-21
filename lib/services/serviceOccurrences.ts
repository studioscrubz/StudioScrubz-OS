import { getSupabaseClient } from "@/lib/supabase/client";
import { generateServiceDates } from "@/lib/scheduling/recurrence";
import { getAgreementById } from "@/lib/services/agreements";
import { getCrewById } from "@/lib/services/crews";
import { employeeName } from "@/types/employee";
import type { ServiceOccurrenceWithRelations } from "@/types/serviceOccurrence";
import type { JobWithRelations } from "@/types/job";
const select =
  "*, agreement:service_agreements!service_occurrences_agreement_id_fkey(*), crew:crews!service_occurrences_assigned_crew_id_fkey(*), job:jobs!service_occurrences_job_id_fkey(*)";
export async function getOccurrences() {
  const { data, error } = await getSupabaseClient()
    .from("service_occurrences")
    .select(select)
    .order("scheduled_date");
  if (error) throw error;
  return data as ServiceOccurrenceWithRelations[];
}
export async function getOccurrencesForAgreement(id: string) {
  const rows = await getOccurrences();
  return rows.filter((x) => x.agreement_id === id);
}
export async function getUpcomingOccurrences(start: string, end: string) {
  const { data, error } = await getSupabaseClient()
    .from("service_occurrences")
    .select(select)
    .gte("scheduled_date", start)
    .lte("scheduled_date", end)
    .order("scheduled_date");
  if (error) throw error;
  return data as ServiceOccurrenceWithRelations[];
}
export async function generateOccurrences(
  agreementId: string,
  horizonDays = 60,
) {
  const a = await getAgreementById(agreementId);
  if (a.status !== "Active")
    throw new Error("Only active agreements generate occurrences.");
  const windowStart = a.start_date > today() ? a.start_date : today(),
    end = add(today(), horizonDays),
    dates = generateServiceDates(
      a.start_date,
      end,
      a.frequency,
      {
        daysOfWeek: a.days_of_week,
        intervalWeeks: a.interval_weeks,
        dayOfMonth: a.day_of_month,
        customIntervalDays: a.custom_interval_days,
      },
      a.end_date,
      a.auto_renew,
    ).filter((date) => date >= windowStart);
  if (!dates.length) return [];
  const payload = dates.map((scheduled_date) => ({
    agreement_id: a.id,
    scheduled_date,
    scheduled_start_time: a.default_start_time,
    assigned_crew_id: a.assigned_crew_id,
    status: "Scheduled" as const,
  }));
  const { error } = await getSupabaseClient()
    .from("service_occurrences")
    .upsert(payload, {
      onConflict: "agreement_id,scheduled_date",
      ignoreDuplicates: true,
    });
  if (error) throw error;
  return getOccurrencesForAgreement(a.id);
}
export async function createJobFromOccurrence(
  id: string,
): Promise<JobWithRelations> {
  const db = getSupabaseClient();
  const { data: o, error } = await db
    .from("service_occurrences")
    .select(select)
    .eq("id", id)
    .single();
  if (error) throw error;
  const occurrence = o as ServiceOccurrenceWithRelations;
  if (occurrence.job_id) {
    const { getJobById } = await import("@/lib/services/jobs");
    return getJobById(occurrence.job_id);
  }
  if (["Skipped", "Cancelled"].includes(occurrence.status))
    throw new Error("Skipped or cancelled occurrences cannot create Jobs.");
  const a = await getAgreementById(occurrence.agreement_id);
  const jobAmount = ["Monthly", "Flat Contract"].includes(a.billing_type) ? 0 : a.billing_amount;
  if (!a.client_id || !a.property_id || !a.client || !a.property)
    throw new Error("This Agreement has a deleted Client or Property relationship and cannot create a Job.");
  const assignedCrew = a.assigned_crew_id ? await getCrewById(a.assigned_crew_id) : null;
  const existing = await db
    .from("jobs")
    .select("id")
    .eq("service_occurrence_id", id)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const { getJobById } = await import("@/lib/services/jobs");
    return getJobById(existing.data.id);
  }
  const jobNumber = `JOB-${today().replaceAll("-", "")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`,
    input = {
      job_number: jobNumber,
      proposal_id: a.proposal_id,
      estimate_id: null,
      walkthrough_id: null,
      service_occurrence_id: id,
      client_id: a.client_id,
      property_id: a.property_id,
      division: a.division,
      client_name:
        a.client.company_name ||
        [a.client.first_name, a.client.last_name].filter(Boolean).join(" "),
      property_name: a.property.property_name || a.property.address,
      service_name: a.service_name,
      frequency: a.frequency,
      status: a.assigned_crew_id
        ? ("Crew Assigned" as const)
        : ("Scheduled" as const),
      scheduled_date: occurrence.scheduled_date,
      start_time: occurrence.scheduled_start_time,
      estimated_duration: a.estimated_duration,
      assigned_crew_id: a.assigned_crew_id,
      assigned_crew_name: assignedCrew?.crew_name ?? null,
      crew_lead_name: assignedCrew?.crew_lead ? employeeName(assignedCrew.crew_lead) : null,
      assigned_team: assignedCrew?.members.map((member) => employeeName(member.employee)) ?? [],
      price: jobAmount,
      deposit: 0,
      balance: jobAmount,
      labor_hours: 0,
      recommended_crew_size: 1,
      scope: a.scope,
      checklist: [],
      photos: [],
      access_instructions: a.special_instructions,
      internal_notes: a.notes,
      completed_at: null,
    };
  const { data, error: je } = await db
    .from("jobs")
    .insert(input)
    .select(
      "*, proposal:proposals!jobs_proposal_id_fkey(*), client:clients!jobs_client_id_fkey(*), property:properties!jobs_property_id_fkey(*)",
    )
    .single();
  if (je?.code === "23505") {
    const old = await db
      .from("jobs")
      .select("id")
      .eq("service_occurrence_id", id)
      .limit(1)
      .single();
    if (old.error) throw je;
    const { getJobById } = await import("@/lib/services/jobs");
    return getJobById(old.data.id);
  }
  if (je) throw je;
  const { error: ue } = await db
    .from("service_occurrences")
    .update({ job_id: data.id, status: "Job Created" })
    .eq("id", id);
  if (ue) throw ue;
  return data as JobWithRelations;
}
export const skipOccurrence = (id: string) => update(id, { status: "Skipped" });
export const cancelOccurrence = (id: string) =>
  update(id, { status: "Cancelled" });
export const rescheduleOccurrence = (
  id: string,
  date: string,
  time: string | null,
) => update(id, { scheduled_date: date, scheduled_start_time: time });
async function update(id: string, input: Partial<import("@/types/serviceOccurrence").ServiceOccurrence>) {
  const { data, error } = await getSupabaseClient()
    .from("service_occurrences")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error?.code === "23505")
    throw new Error(
      "An occurrence already exists for this agreement on that date.",
    );
  if (error) throw error;
  return data;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function add(x: string, n: number) {
  const d = new Date(`${x}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
