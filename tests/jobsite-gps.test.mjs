import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20261025164300_jobsite_gps_arrival_v1.sql","utf8");
const walkthroughSql = readFileSync("supabase/migrations/20261025194500_walkthrough_jobsite_gps.sql","utf8");
const ui = readFileSync("components/jobs/JobsiteGpsVerification.tsx","utf8");
const walkthroughUi = readFileSync("components/walkthroughs/WalkthroughGpsCapture.tsx","utf8");
const walkthroughPage = readFileSync("components/walkthroughs/FieldWalkthroughsPage.tsx","utf8");
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
 assert.doesNotMatch(walkthroughSql, /^\s*(begin|commit|rollback)\s*;/gim);
 assert.doesNotMatch(sql, /concurrently/i);
 assert.doesNotMatch(walkthroughSql, /concurrently/i);
});

test("walkthrough capture resolves the property server-side and cannot overwrite a GPS reference", () => {
 assert.match(walkthroughPage, /<WalkthroughGpsCapture walkthroughId=\{row\.id\} readOnly=\{readOnly\}/);
 assert.match(walkthroughUi, /capture_walkthrough_jobsite_gps/);
 assert.doesNotMatch(walkthroughUi, /propertyId/);
 assert.match(walkthroughSql, /select w\.property_id into v_property/);
 assert.match(walkthroughSql, /where w\.id=p_walkthrough_id and w\.archived_at is null/);
 assert.match(walkthroughSql, /on conflict\(property_id\) do nothing/);
 assert.match(walkthroughSql, /GPS already registered/);
});

test("walkthrough GPS RPCs preserve authenticated assignment authorization", () => {
 assert.match(walkthroughSql, /can_perform_scheduled_walkthrough\(p_walkthrough_id\)/g);
 assert.match(walkthroughSql, /security definer set search_path=''/g);
 assert.match(walkthroughSql, /revoke all on function[\s\S]*from public,anon,authenticated/);
 assert.match(walkthroughSql, /grant execute on function[\s\S]*to authenticated/);
 assert.doesNotMatch(walkthroughSql, /grant execute[\s\S]*to anon/);
});

test("configured properties hide GPS setup but retain management exceptions", () => {
 assert.match(ui, /\{!summary\.configured && <div[\s\S]*Manager: configure property GPS/);
 assert.match(ui, /Manager exception \(not GPS verified\)/);
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
