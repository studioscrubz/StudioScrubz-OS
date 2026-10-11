import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildServiceReminderTemplate, normalizeUpcomingClientServices, selectUpcomingServicesForClient } from "../lib/scheduling/upcomingClientService.ts";

const service = await readFile(new URL("../lib/services/clientCommunications.ts", import.meta.url), "utf8");
const scheduling = await readFile(new URL("../lib/scheduling/upcomingClientService.ts", import.meta.url), "utf8");
const modal = await readFile(new URL("../components/communications/LogCommunicationModal.tsx", import.meta.url), "utf8");
const timeline = await readFile(new URL("../components/communications/CommunicationTimeline.tsx", import.meta.url), "utf8");
const permissions = await readFile(new URL("../lib/auth/permissions.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261006210000_service_reminder_authoritative_schedule_lookup.sql", import.meta.url), "utf8");
const gpsMigration = await readFile(new URL("../supabase/migrations/20260915194754_expand_gps_mileage_to_management.sql", import.meta.url), "utf8");

test("scheduled service lookup uses authoritative Jobs and exact client relationship", () => {
  assert.match(service, /rpc\("get_upcoming_client_jobs"/);
  assert.match(service, /p_client_id: clientId/);
  assert.doesNotMatch(service, /getUpcomingOccurrences|getJobs\(\)|Promise\.allSettled/);
  assert.match(migration, /where job\.client_id = p_client_id/);
  assert.match(migration, /clock_timestamp\(\) at time zone v_timezone/);
  assert.match(migration, /job\.scheduled_date between v_now::date and v_now::date \+ p_days/);
  assert.match(migration, /job\.status in \('Ready to Schedule', 'Scheduled', 'Crew Assigned'\)/);
  assert.doesNotMatch(migration, /job\.status in \([^\n]*'In Progress'|'Completed'|'Cancelled'|'Archived'/);
  assert.match(migration, /left join public\.properties property on property\.id = job\.property_id/);
});

test("lookup returns correct Job, client, property, and service relationships", () => {
  assert.match(migration, /job\.id as source_id,[\s\S]*job\.client_id,[\s\S]*job\.property_id,[\s\S]*job\.service_name[\s\S]*job\.scheduled_date,[\s\S]*job\.start_time/);
  assert.match(service, /normalizeUpcomingClientServices\(data, clientId\)/);
  assert.match(scheduling, /sourceId: requiredString\(row\.source_id/);
  assert.match(scheduling, /clientId: requiredString\(row\.client_id/);
  assert.match(scheduling, /propertyId: nullableString\(row\.property_id/);
});

test("recurring generated occurrences without Jobs use the same lookup", () => {
  assert.match(migration, /from public\.service_occurrences occurrence/);
  assert.match(migration, /join public\.service_agreements agreement on agreement\.id = occurrence\.agreement_id/);
  assert.match(migration, /agreement\.client_id = p_client_id/);
  assert.match(migration, /agreement\.status = 'Active'/);
  assert.match(migration, /agreement\.archived_at is null/);
  assert.match(migration, /occurrence\.job_id is null/);
  assert.match(migration, /occurrence\.status = 'Scheduled'/);
  assert.match(migration, /'Service Occurrence'::text/);
});

test("nearest future service wins across direct Jobs and recurring occurrences", () => {
  assert.match(migration, /union all/);
  assert.match(migration, /order by service\.scheduled_date, service\.start_time nulls last, service\.created_at, service\.source_id/);
  assert.match(scheduling, /selectUpcomingServicesForClient\(services, clientId\)/);
  assert.match(modal, /const first = services\.find[\s\S]*\?\? services\[0\]/);
});

test("business timezone boundary excludes earlier-today work", () => {
  assert.match(migration, /clock_timestamp\(\) at time zone v_timezone/);
  assert.match(migration, /pg_catalog\.pg_timezone_names/);
  assert.match(migration, /job\.scheduled_date \+ coalesce\(job\.start_time, time '23:59:59'\) >= v_now/);
  assert.match(migration, /occurrence\.scheduled_date \+ coalesce\(occurrence\.scheduled_start_time, time '23:59:59'\) >= v_now/);
});

test("cancelled completed archived and cross-client services cannot be selected", () => {
  assert.match(migration, /job\.client_id = p_client_id/);
  assert.match(migration, /job\.archived_at is null/);
  const selected = selectUpcomingServicesForClient([
    { source: "Job", sourceId: "later-direct", clientId: "client-a", propertyId: null, serviceName: "Direct", scheduledDate: "2026-10-09", startTime: "09:00:00", propertyAddress: null },
    { source: "Service Occurrence", sourceId: "recurring", clientId: "client-a", propertyId: null, serviceName: "Recurring", scheduledDate: "2026-10-08", startTime: "12:00:00", propertyAddress: null },
    { source: "Job", sourceId: "earliest-normal", clientId: "client-a", propertyId: null, serviceName: "Normal", scheduledDate: "2026-10-08", startTime: "08:00:00", propertyAddress: null },
  ], "client-a");
  assert.deepEqual(selected.map((service) => service.sourceId), ["earliest-normal", "recurring", "later-direct"]);
  for (const status of ["In Progress", "Completed", "Cancelled", "Archived"]) assert.doesNotMatch(migration, new RegExp(`job\\.status in \\([^\\n]*'${status}'`));
});

test("an empty successful lookup remains distinct from a database failure", () => {
  assert.match(service, /if \(error\) throw new Error\(`Scheduled Job lookup failed: \$\{error\.message\}`\)/);
  assert.match(service, /normalizeUpcomingClientServices\(data, clientId\)/);
  assert.match(modal, /upcomingLookupState === "error" \|\| upcomingError/);
  assert.match(modal, /upcomingLookupState === "success" \? <p[^>]*>No upcoming scheduled service was found for this client\./);
  assert.doesNotMatch(modal, /\{upcomingError \|\| "No upcoming scheduled service/);
});

test("exact Rose Company production rows normalize and populate the nearest reminder", () => {
  const clientId = "fc70bf55-5b53-4890-856e-8ea7ce67894d";
  const rows = [
    {
      source_type: "Job", source_id: "ec5a29a5-8229-4360-9bd4-102322bf7fdd", client_id: clientId,
      property_id: "773c7a99-926e-4d09-bd09-1a2b67acdc6c", service_name: "Standard Cleaning",
      scheduled_date: "2026-10-08", start_time: "15:30:00", property_address: "2554 Olive Dr., #29, Palmdale, CA 93550",
    },
    {
      source_type: "Job", source_id: "1ee26a2f-3727-414d-9486-8f1db6f644da", client_id: clientId,
      property_id: "e705eba8-7a2b-4bec-811e-a5fd54a8e87a", service_name: "Standard Cleaning",
      scheduled_date: "2026-10-09", start_time: "13:00:00", property_address: "20235 Keswick St. #7, Winnetka, CA 91306",
    },
  ];
  const upcoming = normalizeUpcomingClientServices(rows, clientId);
  assert.equal(upcoming.length, 2);
  assert.equal(upcoming[0].sourceId, "ec5a29a5-8229-4360-9bd4-102322bf7fdd");
  assert.equal(upcoming[0].scheduledDate, "2026-10-08");
  assert.equal(upcoming[0].startTime, "15:30:00");
  const reminder = buildServiceReminderTemplate(upcoming[0], "Rose Company");
  assert.match(reminder.subject, /Standard Cleaning.*Thursday, October 8, 2026/);
  assert.match(reminder.message, /Hello Rose Company,/);
  assert.match(reminder.message, /Thursday, October 8, 2026 at 3:30 PM/);
  assert.match(reminder.message, /2554 Olive Dr\., #29, Palmdale, CA 93550/);
  assert.doesNotMatch(reminder.message, /October 9/);
});

test("malformed or cross-client RPC rows surface contract errors instead of false empty state", () => {
  assert.throws(() => normalizeUpcomingClientServices([{ source_type: "Job" }], "client-a"), /contract failed/);
  assert.throws(() => normalizeUpcomingClientServices([{
    source_type: "Job", source_id: "job-a", client_id: "client-b", property_id: null,
    service_name: "Cleaning", scheduled_date: "2026-10-08", start_time: null, property_address: null,
  }], "client-a"), /different client/);
  assert.match(modal, /setUpcomingLookupState\("error"\)/);
});

test("communication errors are rendered as useful strings", () => {
  assert.match(modal, /errorMessage\(caught, "Upcoming services could not be loaded\."\)/);
  assert.match(timeline, /errorMessage\(caught, "Communication history could not be loaded\."\)/);
  assert.doesNotMatch(modal, /setUpcomingError\(caught as/);
});

test("management and Sales may perform the narrow lookup while field roles remain denied", () => {
  assert.match(migration, /has_any_role\(array\['Master Admin', 'Administrator', 'Manager', 'Sales'\]\)/);
  assert.doesNotMatch(migration, /'Crew Lead'|'Scrub Technician'/);
  assert.match(permissions, /Sales:[\s\S]*"communications\.view"[\s\S]*"communications\.create"/);
});

test("existing communication history query and selected Job metadata remain intact", () => {
  assert.match(service, /from\("client_communications"\)\.select\("\*"\)\.eq\("client_id", clientId\)/);
  assert.match(modal, /property_id: selectedService\?\.propertyId/);
  assert.match(modal, /source_id: selectedService\.sourceId/);
  assert.match(modal, /service_name: selectedService\.serviceName/);
});

test("GPS On My Way still invokes communication once and creates no client communication duplicate", () => {
  assert.match(gpsMigration, /notification := public\.initiate_job_on_my_way\(p_job_id\)/);
  assert.equal((gpsMigration.match(/initiate_job_on_my_way\(p_job_id\)/g) ?? []).length, 1);
  assert.doesNotMatch(gpsMigration, /insert into public\.client_communications/);
});
