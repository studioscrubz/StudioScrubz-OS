import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { selectUpcomingServicesForClient } from "../lib/scheduling/upcomingClientService.ts";

const service = await readFile(new URL("../lib/services/clientCommunications.ts", import.meta.url), "utf8");
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
  assert.match(service, /sourceId: service\.source_id/);
  assert.match(service, /clientId: service\.client_id/);
  assert.match(service, /propertyId: service\.property_id/);
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
  assert.match(service, /selectUpcomingServicesForClient/);
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
    { source: "Job", sourceId: "other-client", clientId: "client-b", propertyId: null, serviceName: "Wrong Client", scheduledDate: "2026-10-07", startTime: "08:00:00", propertyAddress: null },
    { source: "Job", sourceId: "earliest-normal", clientId: "client-a", propertyId: null, serviceName: "Normal", scheduledDate: "2026-10-08", startTime: "08:00:00", propertyAddress: null },
  ], "client-a");
  assert.deepEqual(selected.map((service) => service.sourceId), ["earliest-normal", "recurring", "later-direct"]);
  for (const status of ["In Progress", "Completed", "Cancelled", "Archived"]) assert.doesNotMatch(migration, new RegExp(`job\\.status in \\([^\\n]*'${status}'`));
});

test("an empty successful lookup remains distinct from a database failure", () => {
  assert.match(service, /if \(error\) throw new Error\(`Scheduled Job lookup failed: \$\{error\.message\}`\)/);
  assert.match(service, /selectUpcomingServicesForClient\(\(data \?\? \[\]\)\.map/);
  assert.match(modal, /upcomingError \? <p role="alert"/);
  assert.match(modal, /No upcoming scheduled service was found for this client\./);
  assert.doesNotMatch(modal, /\{upcomingError \|\| "No upcoming scheduled service/);
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
