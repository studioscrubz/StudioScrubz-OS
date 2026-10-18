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
const { buildPorterCrewWorkloads, buildPorterRouteSuggestion, validatePorterRouteSuggestion } = target.exports;

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

const optimizationRoute = (overrides = {}) => ({
  id: "route-opt",
  updated_at: "version-1",
  route_date: "2026-10-18",
  assigned_crew_id: "crew-a",
  status: "Planned",
  stops: [
    { id: "s1", visit_id: "v1", stop_order: 1, visit: { property_label: "Start", scheduled_start_time: "08:00" } },
    { id: "s2", visit_id: "v2", stop_order: 2, visit: { property_label: "Far", scheduled_start_time: "09:00" } },
    { id: "s3", visit_id: "v3", stop_order: 3, visit: { property_label: "Near", scheduled_start_time: "09:00" } },
  ],
  ...overrides,
});
const locations = [
  { stopId: "s1", visitId: "v1", label: "Start", address: "1 Start St", scheduledStartTime: "08:00", visitStatus: "Scheduled", latitude: 34, longitude: -118 },
  { stopId: "s2", visitId: "v2", label: "Far", address: "2 Far St", scheduledStartTime: "09:00", visitStatus: "Scheduled", latitude: 35, longitude: -118 },
  { stopId: "s3", visitId: "v3", label: "Near", address: "3 Near St", scheduledStartTime: "09:00", visitStatus: "Scheduled", latitude: 34.1, longitude: -118 },
];

test("suggestion is deterministic, preserves stop identity, and compares straight-line distance", () => {
  const first = buildPorterRouteSuggestion(optimizationRoute(), locations);
  const second = buildPorterRouteSuggestion(optimizationRoute(), locations);
  assert.deepEqual(Array.from(first.suggestedOrder, stop => stop.stopId), ["s1", "s3", "s2"]);
  assert.deepEqual(Array.from(second.suggestedOrder, stop => stop.stopId), ["s1", "s3", "s2"]);
  assert.equal(first.method, "nearest_neighbor_straight_line_v1");
  assert.equal(first.changed, true);
  assert.ok(first.suggestedStraightLineMiles < first.currentStraightLineMiles);
  assert.deepEqual(Array.from(first.suggestedOrder, stop => stop.visitId).sort(), ["v1", "v2", "v3"]);
  assert.match(first.schedulingWarnings[0], /Duplicate scheduled start at 09:00/);
});

test("same-location ties preserve existing order", () => {
  const same = locations.map(location => ({ ...location, latitude: 34, longitude: -118 }));
  const suggestion = buildPorterRouteSuggestion(optimizationRoute(), same);
  assert.deepEqual(Array.from(suggestion.suggestedOrder, stop => stop.stopId), ["s1", "s2", "s3"]);
  assert.equal(suggestion.currentStraightLineMiles, 0);
  assert.equal(suggestion.suggestedStraightLineMiles, 0);
  assert.equal(suggestion.changed, false);
});

test("missing and invalid coordinates disable distances and safe application", () => {
  for (const patch of [{ latitude: null }, { latitude: 91 }, { longitude: -181 }, { latitude: Number.NaN }, { address: null }]) {
    const unavailable = locations.map((location, index) => index === 1 ? { ...location, ...patch } : location);
    const suggestion = buildPorterRouteSuggestion(optimizationRoute(), unavailable);
    assert.equal(suggestion.method, "unavailable");
    assert.equal(suggestion.currentStraightLineMiles, null);
    assert.equal(suggestion.suggestedStraightLineMiles, null);
    assert.equal(suggestion.unavailable.length, 1);
    assert.throws(() => validatePorterRouteSuggestion(optimizationRoute(), suggestion), /not available/);
  }
});

test("historical and active routes are recommendation-only and cannot apply", () => {
  for (const status of ["In Progress", "Completed", "Cancelled"]) {
    const route = optimizationRoute({ status });
    const suggestion = buildPorterRouteSuggestion(route, locations);
    assert.equal(suggestion.method, "unavailable");
    assert.throws(() => validatePorterRouteSuggestion(route, suggestion), /Only Planned/);
  }
});

test("completed and cancelled stops are never reordered", () => {
  for (const visitStatus of ["Completed", "Cancelled"]) {
    const withLockedStop = locations.map((location, index) => index === 1 ? { ...location, visitStatus } : location);
    const suggestion = buildPorterRouteSuggestion(optimizationRoute(), withLockedStop);
    assert.equal(suggestion.method, "unavailable");
    assert.equal(suggestion.lockedStops.length, 1);
    assert.deepEqual(Array.from(suggestion.suggestedOrder, stop => stop.stopId), ["s1", "s2", "s3"]);
    assert.throws(() => validatePorterRouteSuggestion(optimizationRoute(), suggestion), /not available/);
  }
});

test("application validation rejects stale versions, changed sets, duplicate stops, crew and date changes", () => {
  const route = optimizationRoute();
  const suggestion = buildPorterRouteSuggestion(route, locations);
  assert.doesNotThrow(() => validatePorterRouteSuggestion(route, suggestion));
  assert.throws(() => validatePorterRouteSuggestion(optimizationRoute({ updated_at: "version-2" }), suggestion), /Route changed/);
  assert.throws(() => validatePorterRouteSuggestion(optimizationRoute({ assigned_crew_id: "crew-b" }), suggestion), /identity, service date, or crew changed/);
  assert.throws(() => validatePorterRouteSuggestion(optimizationRoute({ route_date: "2026-10-19" }), suggestion), /identity, service date, or crew changed/);
  assert.throws(() => validatePorterRouteSuggestion(optimizationRoute({ stops: optimizationRoute().stops.slice(0, 2) }), suggestion), /stop set changed/);
  const duplicate = { ...suggestion, suggestedOrder: [suggestion.suggestedOrder[0], suggestion.suggestedOrder[0], suggestion.suggestedOrder[2]] };
  assert.throws(() => validatePorterRouteSuggestion(route, duplicate), /duplicate stops/);
});

test("dispatcher UI requires confirmation and re-fetches before one atomic existing edit mutation", () => {
  const source = readFileSync(new URL("../components/properties/PorterRoutesPage.tsx", import.meta.url), "utf8");
  assert.match(source, /window\.confirm\("Apply this suggested stop order/);
  assert.match(source, /const fresh = await getPorterRoute\(selected\.id\)/);
  assert.match(source, /validatePorterRouteSuggestion\(fresh, suggestion\)/);
  assert.match(source, /mutatePorterRoute\(fresh, \{ action: "edit"/);
  assert.match(source, /Review Suggestion/);
  assert.match(source, /Apply Suggested Order/);
  assert.match(source, /Travel time[\s\S]*Unavailable/);
});
