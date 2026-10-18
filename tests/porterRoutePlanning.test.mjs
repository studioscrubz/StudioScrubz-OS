import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const target = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL("../lib/porterRoutePlanning.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { module: target, exports: target.exports, require: () => ({}) });
const { buildPorterCrewWorkloads } = target.exports;

const visit = (id, crewId = "crew-a", overrides = {}) => ({
  id,
  status: "Scheduled",
  scheduled_date: "2026-10-17",
  scheduled_start_time: "09:00:00",
  assigned_worker_crew_id: crewId,
  assigned_worker_employee_id: null,
  crew_name: crewId === "crew-a" ? "Alpha" : "Beta",
  property_label: `Property ${id}`,
  ...overrides,
});
const stop = (visitId, released_at = null) => ({ visit_id: visitId, released_at });
const route = (id, crewId, stops, overrides = {}) => ({
  id,
  assigned_crew_id: crewId,
  crew_name: crewId === "crew-a" ? "Alpha" : "Beta",
  route_date: "2026-10-17",
  status: "Planned",
  stops,
  ...overrides,
});

test("crew workloads use scheduled crew visits and active route reservations", () => {
  const rows = [
    visit("routed"),
    visit("unrouted"),
    visit("individual", "crew-a", { assigned_worker_employee_id: "employee", assigned_worker_crew_id: null }),
    visit("started", "crew-a", { status: "In Progress" }),
    visit("cancelled", "crew-a", { status: "Cancelled" }),
    visit("other-date", "crew-a", { scheduled_date: "2026-10-18" }),
  ];
  const result = buildPorterCrewWorkloads(rows, [route("route-a", "crew-a", [stop("routed")])], [{ id: "crew-a", crew_name: "Alpha" }], "2026-10-17");
  assert.equal(result.length, 1);
  assert.equal(result[0].totalScheduled, 2);
  assert.equal(result[0].routed, 1);
  assert.deepEqual(Array.from(result[0].unrouted, row => row.id), ["unrouted"]);
  assert.equal(result[0].routeCount, 1);
});

test("cancelled routes and released stops do not classify visits as routed", () => {
  const rows = [visit("cancelled-route"), visit("released")];
  const routes = [
    route("cancelled", "crew-a", [stop("cancelled-route")], { status: "Cancelled" }),
    route("active", "crew-a", [stop("released", "2026-10-17T10:00:00Z")]),
  ];
  const result = buildPorterCrewWorkloads(rows, routes, [], "2026-10-17")[0];
  assert.equal(result.routed, 0);
  assert.equal(result.routeCount, 1);
  assert.deepEqual(Array.from(result.unrouted, row => row.id), ["cancelled-route", "released"]);
});

test("duplicate start warnings ignore missing times and remain non-blocking data", () => {
  const rows = [visit("one"), visit("two"), visit("unknown", "crew-a", { scheduled_start_time: null }), visit("beta", "crew-b")];
  const result = buildPorterCrewWorkloads(rows, [], [{ id: "crew-a", crew_name: "Alpha" }, { id: "crew-b", crew_name: "Beta" }], "2026-10-17");
  const alpha = result.find(row => row.crewId === "crew-a");
  assert.equal(alpha.duplicateStarts.length, 1);
  assert.equal(alpha.duplicateStarts[0].startTime, "09:00");
  assert.deepEqual(Array.from(alpha.duplicateStarts[0].visits, row => row.id), ["one", "two"]);
  assert.equal(buildPorterCrewWorkloads(rows, [], [], "").length, 0);
});

test("routes UI exposes planning warnings, unrouted visits, progress, and manual planning", () => {
  const source = readFileSync(new URL("../components/properties/PorterRoutesPage.tsx", import.meta.url), "utf8");
  assert.match(source, /Crew workload for/);
  assert.match(source, /Duplicate start warning/);
  assert.match(source, /Outstanding unrouted visits/);
  assert.match(source, /Duration-based overlap warnings are not shown/);
  assert.match(source, /Planning warnings are informational/);
  assert.match(source, /Plan route/);
  assert.match(source, /progress\.percentage/);
  assert.doesNotMatch(source, /automatically assign|auto-assign/i);
});
