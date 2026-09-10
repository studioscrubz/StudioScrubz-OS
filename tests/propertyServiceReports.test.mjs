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
  }, Date, Set, Error });
  return target.exports;
}
const permissions = load("lib/auth/permissions.ts");
const { summarizePropertyServiceReport: summarize } = load("types/propertyServiceReport.ts");
const visit = { id: "v", status: "Completed", completed_at: "2026-09-09T12:00:00Z", property_label: "Historical property", plan_name: "Historical plan", areas: [{ id: "a", name: "Snapshot area", is_required: true, requires_photo: true, status: "Completed" }], photos: [{ id: "p", visit_area_id: "a", archived_at: null, storage_path: "private/path" }], issues: [] };
function api(role, visits = {}, context = {}) {
  return load("lib/services/propertyServiceReports.ts", {
    "@/lib/auth/permissions": permissions,
    "@/lib/services/auth": { getCurrentProfile: async () => ({ role, is_active: true }) },
    "@/lib/services/porterVisits": { listPorterVisits: async () => [visit], getPorterVisit: async () => visit, ...visits },
    "@/lib/services/propertyServicePlans": { getPropertyServicePlan: async () => ({ name: "Edited plan", frequency: "Weekly", areas: [] }), ...context.plan },
    "@/lib/services/clients": { getClientById: async () => ({ first_name: "Test", last_name: "Client" }), ...context.client },
  });
}
test("six-role report route and service access; denied roles never load visits", async () => {
  for (const role of ["Master Admin", "Administrator", "Manager", "Crew Lead", "Scrub Technician", "Sales"]) {
    const allowed = ["Master Admin", "Administrator", "Manager"].includes(role);
    let calls = 0;
    const service = api(role, { listPorterVisits: async () => { calls++; return []; }, getPorterVisit: async () => { calls++; return visit; } });
    assert.equal(permissions.hasPermission({ role, is_active: true }, permissions.permissionForPath("/properties/service-reports")), allowed);
    if (allowed) { await service.listPropertyServiceReports(); await service.getPropertyServiceReport("v"); }
    else { await assert.rejects(service.listPropertyServiceReports(), /access denied/); await assert.rejects(service.getPropertyServiceReport("v"), /access denied/); assert.equal(calls, 0); }
  }
});
test("only completed visits appear and detail rejects every unfinished/cancelled status", async () => {
  const rows = ["Completed", "Scheduled", "In Progress", "Cancelled"].map(status => ({ ...visit, status }));
  const result = await api("Manager", { listPorterVisits: async () => rows }).listPropertyServiceReports();
  assert.equal(result.length, 1); assert.equal(result[0].status, "Completed");
  for (const status of ["Scheduled", "In Progress", "Cancelled"]) await assert.rejects(api("Manager", { getPorterVisit: async () => ({ ...visit, status }) }).getPropertyServiceReport("v"), /only for Completed/);
});
test("deterministic metrics exclude archived evidence and count each disposition/severity", () => {
  const result = summarize({ ...visit, areas: [...visit.areas, { id: "b", status: "Unable to Complete" }, { id: "c", status: "Pending" }], photos: [...visit.photos, { archived_at: "archived", visit_area_id: "c" }], issues: [{ status: "Open", severity: "Urgent" }, { status: "Acknowledged", severity: "High" }, { status: "Resolved", severity: "Low" }] });
  assert.deepEqual(JSON.parse(JSON.stringify(result.metrics)), { totalAreas: 3, completedAreas: 1, unableAreas: 1, pendingAreas: 1, requiredAreas: 1, requiredCompleted: 1, photoRequiredAreas: 1, photoRequiredDocumented: 1, evidence: 1, issues: 3, openIssues: 1, acknowledgedIssues: 1, resolvedIssues: 1, highUrgentIssues: 2 });
});
test("status precedence includes acknowledged issues and unresolved areas/evidence", () => {
  assert.equal(summarize(visit).status, "Completed");
  for (const status of ["Open", "Acknowledged"]) assert.equal(summarize({ ...visit, issues: [{ status }] }).status, "Completed with Open Issues");
  assert.equal(summarize({ ...visit, issues: [{ status: "Resolved" }] }).status, "Completed");
  for (const status of ["Pending", "Unable to Complete"]) assert.equal(summarize({ ...visit, areas: [{ ...visit.areas[0], status }], issues: [{ status: "Open" }] }).status, "Completed with Unresolved Service Areas");
  assert.equal(summarize({ ...visit, photos: [] }).status, "Completed with Unresolved Service Areas");
});
test("plan edits preserve snapshots; refreshed issue resolution changes disposition", async () => {
  let issues = [{ status: "Open" }];
  const service = api("Manager", { getPorterVisit: async () => ({ ...visit, issues }) });
  const before = await service.getPropertyServiceReport("v");
  assert.equal(before.visit.plan_name, "Historical plan"); assert.equal(before.visit.areas[0].name, "Snapshot area");
  assert.equal(before.currentFrequency, "Weekly"); assert.equal(before.currentClientName, "Test Client");
  assert.equal(summarize(before.visit).status, "Completed with Open Issues");
  issues = [{ status: "Resolved" }];
  assert.equal(summarize((await service.getPropertyServiceReport("v")).visit).status, "Completed");
  assert.equal("signedUrl" in before.visit.photos[0], false);
});
test("authoritative errors propagate; optional context failure is explicit", async () => {
  const fail = async () => { throw Error("Connection failed"); };
  await assert.rejects(api("Manager", { listPorterVisits: fail }).listPropertyServiceReports(), /Connection failed/);
  await assert.rejects(api("Manager", { getPorterVisit: fail }).getPropertyServiceReport("v"), /Connection failed/);
  const result = await api("Manager", {}, { plan: { getPropertyServicePlan: fail } }).getPropertyServiceReport("v");
  assert.equal(result.contextUnavailable, true); assert.equal(result.currentFrequency, null); assert.equal(result.visit.id, "v");
});

test("report deletion invokes deletePorterVisit for management roles and rejects non-management roles", async () => {
  let deletedId = null;
  const managerService = api("Manager", { deletePorterVisit: async (id) => { deletedId = id; } });
  await managerService.deletePropertyServiceReport("report-v1");
  assert.equal(deletedId, "report-v1");

  const techService = api("Scrub Technician", { deletePorterVisit: async () => {} });
  await assert.rejects(techService.deletePropertyServiceReport("report-v1"), /access denied/);
});
