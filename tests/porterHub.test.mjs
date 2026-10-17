import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}) {
  const target = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: target, exports: target.exports, require: name => {
    if (!(name in dependencies)) throw Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, Date, Intl, Math, Set, Error });
  return target.exports;
}

const hub = load("lib/porterHub.ts");
const permissions = load("lib/auth/permissions.ts");
const component = readFileSync(new URL("../components/properties/PorterHubPage.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../components/layout/Sidebar.tsx", import.meta.url), "utf8");

const area = (status = "Pending") => ({ id: crypto.randomUUID(), status });
const visit = (overrides = {}) => ({
  id: crypto.randomUUID(), status: "Scheduled", scheduled_date: "2026-10-17", scheduled_start_time: "10:00:00",
  property_label: "Property", plan_name: "Plan", worker_name: "Tech", crew_name: null, manager_name: null,
  areas: [area(), area("Completed")], issues: [], ...overrides,
});

test("Porter Hub permission is available to management and field roles but denied to unauthorized roles", () => {
  for (const role of ["Master Admin", "Administrator", "Manager", "Crew Lead", "Scrub Technician"]) {
    assert.equal(permissions.hasPermission({ role, is_active: true }, permissions.permissionForPath("/properties/porter")), true);
  }
  for (const role of ["Sales", "Lead Representative"]) assert.equal(permissions.hasPermission({ role, is_active: true }, permissions.permissionForPath("/properties/porter")), false);
  assert.equal(permissions.hasPermission({ role: "Master Admin", is_active: false }, "porterVisits.view"), false);
});

test("business clock honors the configured timezone and daylight-independent calendar date", () => {
  const instant = new Date("2026-10-18T06:30:00.000Z");
  assert.deepEqual(JSON.parse(JSON.stringify(hub.getPorterBusinessClock(instant, "America/Los_Angeles"))), {
    date: "2026-10-17", time: "23:30", timezone: "America/Los_Angeles",
  });
});

test("status summaries distinguish upcoming, in-progress, completed, and overdue visits", () => {
  const clock = { date: "2026-10-17", time: "09:30", timezone: "America/Los_Angeles" };
  const rows = [
    visit({ id: "upcoming", scheduled_start_time: "10:00:00" }),
    visit({ id: "late-today", scheduled_start_time: "08:00:00" }),
    visit({ id: "missed", scheduled_date: "2026-10-16" }),
    visit({ id: "started", status: "In Progress", scheduled_date: "2026-10-16" }),
    visit({ id: "done", status: "Completed" }),
    visit({ id: "cancelled", status: "Cancelled" }),
  ];
  const summary = hub.summarizePorterHub(rows, clock);
  assert.deepEqual(Array.from(summary.todayScheduled, row => row.id), ["upcoming"]);
  assert.deepEqual(Array.from(summary.overdue, row => row.id), ["late-today", "missed"]);
  assert.deepEqual(Array.from(summary.inProgress, row => row.id), ["started"]);
  assert.deepEqual(Array.from(summary.completed, row => row.id), ["done"]);
});

test("progress calculations and urgent unresolved issue indicators use existing visit evidence", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(hub.porterVisitProgress({ areas: [area("Completed"), area("Unable to Complete"), area()] }))), { addressed: 2, total: 3, percent: 67 });
  const rows = [visit({ issues: [
    { id: "urgent", severity: "Urgent", status: "Open" },
    { id: "ack", severity: "High", status: "Acknowledged" },
    { id: "resolved", severity: "Urgent", status: "Resolved" },
  ] })];
  const summary = hub.summarizePorterHub(rows, { date: "2026-10-17", time: "09:00", timezone: "America/Los_Angeles" });
  assert.equal(summary.activeIssues.length, 2);
  assert.equal(summary.urgentIssues.length, 1);
});

test("dashboard includes role-aware links and graceful loading, empty, error, and denied states", () => {
  for (const text of ["Loading Porter Hub", "No Porter Visits are available", "Porter Hub could not be loaded", "Porter Hub access denied"]) assert.match(component, new RegExp(text));
  assert.match(component, /management && <Link[^>]+service-plans/);
  assert.match(component, /management && <Link[^>]+service-reports/);
  assert.match(component, /href="\/properties\/porter-visits"/);
  assert.match(component, /href="\/properties\/porter-routes"/);
  assert.match(sidebar, /label: "Overview"[\s\S]*href: "\/properties\/porter"[\s\S]*permission: "porterVisits\.view"/);
});

test("dashboard reads only existing authorized services and does not mutate Porter records", () => {
  assert.match(component, /listPorterVisits\(\)/);
  assert.match(component, /getBusinessIdentitySettings\(\)/);
  assert.doesNotMatch(component, /createPorterVisit|mutatePorterVisit|service_role|\.from\(/);
});
