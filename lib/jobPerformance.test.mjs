import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { filterPerformanceRows, formatDuration, getJobPerformanceRange, groupByClientProperty, performanceChange, summarizeDurations } from "./jobPerformance.ts";

const base = (id, seconds, date = "2026-08-01", overrides = {}) => ({ id, job_number: `JOB-${id}`, client_id: "client-1", client_name: "Client One", property_id: "property-1", property_name: "Property One", service_name: "Deep Clean", division: "Residential", scheduled_date: date, operational_started_at: `${date}T16:00:00Z`, operational_ended_at: `${date}T17:00:00Z`, ended_business_date: date, duration_seconds: seconds, ...overrides });
const filters = { service: "", clientId: "", propertyId: "", division: "" };

test("average, odd median, fastest, and slowest", () => assert.deepEqual(summarizeDurations([base("1", 60), base("2", 180), base("3", 300)]), { count: 3, average: 180, median: 180, fastest: 60, slowest: 300 }));
test("even median", () => assert.equal(summarizeDurations([base("1", 60), base("2", 180)]).median, 120));
test("missing and invalid master durations are excluded", () => assert.deepEqual(filterPerformanceRows([base("1", 60), base("2", 60, "2026-08-01", { operational_started_at: "" }), base("3", -1)], null, null, filters).map((x) => x.id), ["1"]));
test("date, service, client, property, and division filters compose", () => {
  const rows = [base("1", 60), base("2", 60, "2026-07-01", { service_name: "Other" }), base("3", 60, "2026-08-02", { client_id: "c2" })];
  assert.deepEqual(filterPerformanceRows(rows, "2026-08-01", "2026-08-31", { service: "Deep Clean", clientId: "client-1", propertyId: "property-1", division: "Residential" }).map((x) => x.id), ["1"]);
});
test("performance change labels faster and slower", () => {
  assert.deepEqual(performanceChange(summarizeDurations([base("1", 80)]), summarizeDurations([base("2", 100)])), { percentage: 20, direction: "faster" });
  assert.deepEqual(performanceChange(summarizeDurations([base("1", 120)]), summarizeDurations([base("2", 100)])), { percentage: -20, direction: "slower" });
});
test("comparison without data or with zero previous average is unavailable", () => {
  assert.equal(performanceChange(summarizeDurations([base("1", 10)]), summarizeDurations([])), null);
  assert.equal(performanceChange(summarizeDurations([base("1", 10)]), summarizeDurations([base("2", 0)])), null);
});
test("repeat trend requires two jobs", () => {
  assert.equal(groupByClientProperty([base("1", 100)])[0].trend, null);
  assert.equal(groupByClientProperty([base("1", 100), base("2", 80, "2026-08-02")])[0].trend?.direction, "faster");
});
test("multi-day duration", () => assert.equal(formatDuration(98_400), "1d 3h 20m"));
test("preset includes equivalent previous period", () => assert.deepEqual(getJobPerformanceRange("Last 30 Days", "2026-08-30"), { start: "2026-08-01", end: "2026-08-30", previousStart: "2026-07-02", previousEnd: "2026-07-31" }));
test("month presets clamp safely at month end", () => assert.equal(getJobPerformanceRange("Last 6 Months", "2026-08-31").start, "2026-02-28"));
test("read-only RPC enforces the measured population and has no labor or financial dependency", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260831031011_add_job_performance_report.sql", import.meta.url), "utf8");
  assert.match(sql, /job\.status = 'Completed'/); assert.match(sql, /job\.archived_at is null/);
  assert.match(sql, /operational_started_at is not null/); assert.match(sql, /operational_ended_at is not null/);
  assert.match(sql, /operational_ended_at >= job\.operational_started_at/);
  assert.match(sql, /operational_ended_at - job\.operational_started_at/);
  assert.doesNotMatch(sql, /time_entries|invoices|payments/);
  assert.match(sql, /Master Admin','Administrator','Manager/);
});
