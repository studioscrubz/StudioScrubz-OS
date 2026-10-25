import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20261025164300_jobsite_gps_arrival_v1.sql","utf8");
const ui = readFileSync("components/jobs/JobsiteGpsVerification.tsx","utf8");
const geo = readFileSync("lib/geo/currentPosition.ts","utf8");
const jobs = readFileSync("components/jobs/JobsPage.tsx","utf8");

test("location is a one-time explicit user action, never background tracking", () => {
 assert.match(ui, /Verify my arrival using GPS/);
 assert.match(ui, /getCurrentPosition\(\)/);
 assert.doesNotMatch(ui, /watchPosition|setInterval|continuous tracking/i);
 assert.match(geo, /navigator\.geolocation\.getCurrentPosition/);
 assert.doesNotMatch(sql, /alter table public\.time_entries|create trigger .*time_entries/i);
});
test("GPS migration uses external transactions safely", () => {
 assert.doesNotMatch(sql, /^\s*(begin|commit|rollback)\s*;/gim);
 assert.doesNotMatch(sql, /concurrently/i);
});
test("server enforces staff assignments and management controls", () => {
 assert.match(sql, /private\.jobsite_employee_authorized/);
 assert.match(sql, /private\.jobsite_manager/);
 assert.match(sql, /approve_jobsite_arrival_exception/);
 assert.match(sql, /reported_accuracy_meters/);
 assert.match(sql, /enable row level security/g);
 assert.match(sql, /revoke all on function public\.set_jobsite_geofence/);
});
test("GPS result minimizes employee location retention", () => {
 const section = sql.match(/create table public\.jobsite_arrival_checks \(([\s\S]*?)\);/i)?.[1];
 assert.ok(section);
 assert.doesNotMatch(section, /latitude|longitude|raw_position/i);
 assert.match(section, /distance_meters/);
 assert.match(section, /accuracy/i);
});
test("job details connect GPS without gating original job lifecycle", () => {
 assert.match(jobs, /JobsiteGpsVerification/);
 assert.match(jobs, /startOperationalJob\(job\.id\)/);
 assert.match(jobs, /joinJob\(job\.id\)/);
});
