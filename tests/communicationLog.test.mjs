import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const service = await readFile(new URL("../lib/services/clientCommunications.ts", import.meta.url), "utf8");
const modal = await readFile(new URL("../components/communications/LogCommunicationModal.tsx", import.meta.url), "utf8");
const timeline = await readFile(new URL("../components/communications/CommunicationTimeline.tsx", import.meta.url), "utf8");
const permissions = await readFile(new URL("../lib/auth/permissions.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260915201256_communication_log_job_lookup.sql", import.meta.url), "utf8");
const gpsMigration = await readFile(new URL("../supabase/migrations/20260915194754_expand_gps_mileage_to_management.sql", import.meta.url), "utf8");

test("scheduled service lookup uses authoritative Jobs and exact client relationship", () => {
  assert.match(service, /rpc\("get_upcoming_client_jobs"/);
  assert.match(service, /p_client_id: clientId/);
  assert.doesNotMatch(service, /getUpcomingOccurrences|getJobs\(\)|Promise\.allSettled/);
  assert.match(migration, /where j\.client_id = p_client_id/);
  assert.match(migration, /clock_timestamp\(\) at time zone coalesce/);
  assert.match(migration, /j\.scheduled_date between v_start and v_start \+ p_days/);
  assert.match(migration, /j\.status in \('Scheduled', 'Crew Assigned', 'In Progress'\)/);
  assert.doesNotMatch(migration, /j\.status in \([^\n]*'Ready to Schedule'/);
  assert.match(migration, /left join public\.properties p on p\.id = j\.property_id/);
});

test("lookup returns correct Job, client, property, and service relationships", () => {
  assert.match(migration, /j\.id,[\s\S]*j\.client_id,[\s\S]*j\.property_id,[\s\S]*j\.service_name,[\s\S]*j\.scheduled_date,[\s\S]*j\.start_time/);
  assert.match(migration, /join public\.properties p on p\.id = j\.property_id/);
  assert.match(service, /sourceId: job\.job_id/);
  assert.match(service, /clientId: job\.client_id/);
  assert.match(service, /propertyId: job\.property_id/);
});

test("an empty successful lookup remains distinct from a database failure", () => {
  assert.match(service, /if \(error\) throw new Error\(`Scheduled Job lookup failed: \$\{error\.message\}`\)/);
  assert.match(service, /return \(data \?\? \[\]\)\.map/);
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
