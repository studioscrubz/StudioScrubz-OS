import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}) {
  const target = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: target, exports: target.exports, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, Date, Set, Error });
  return target.exports;
}
const models = load("types/porterVisit.ts");
const permissions = load("lib/auth/permissions.ts");
const visit = { id: "visit", status: "Scheduled", updated_at: "version-1", areas: [{ id: "area", is_required: true, status: "Pending" }] };
const input = { plan_id: "plan", scheduled_date: "2026-09-09", assigned_crew_id: null, visit_notes: null };
function api(role, rpc, active = true) {
  return load("lib/services/porterVisits.ts", {
    "@/lib/auth/permissions": permissions, "@/types/porterVisit": models,
    "@/lib/services/auth": { getCurrentProfile: async () => ({ role, is_active: active }) },
    "@/lib/supabase/client": { getSupabaseClient: () => ({ rpc }) },
  });
}
test("six-role read/create permissions and no broad field permissions", async () => {
  for (const role of ["Master Admin", "Administrator", "Manager", "Sales", "Crew Lead", "Scrub Technician"]) {
    const manager = ["Master Admin", "Administrator", "Manager"].includes(role);
    const calls = [];
    const service = api(role, async (name, args) => { calls.push({ name, args }); return { data: name === "create_porter_visit" ? "visit" : [], error: null }; });
    assert.equal(permissions.hasPermission({ role, is_active: true }, permissions.permissionForPath("/properties/porter-visits")), role !== "Sales");
    if (role === "Sales") await assert.rejects(service.listPorterVisits(), /access denied/);
    else await service.listPorterVisits();
    if (manager) await service.createPorterVisit(input);
    else await assert.rejects(service.createPorterVisit(input), /access denied/);
    assert.equal(calls.some(call => call.name === "create_porter_visit"), manager);
    if (["Crew Lead", "Scrub Technician"].includes(role)) for (const permission of ["propertyServicePlans.manage", "agreements.view", "invoices.view", "proposals.view"]) assert.equal(permissions.hasPermission({ role, is_active: true }, permission), false);
  }
  await assert.rejects(api("Manager", () => { throw Error("must not call"); }, false).listPorterVisits(), /access denied/);
});
test("reads use scoped RPC without caller-controlled identity; absent record fails closed", async () => {
  const calls = [];
  const service = api("Crew Lead", async (name, args) => { calls.push({ name, args }); return { data: [], error: null }; });
  await service.listPorterVisits();
  await assert.rejects(service.getPorterVisit("unassigned"), /not found or access denied/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ name: "get_porter_visits", args: {} }, { name: "get_porter_visits", args: { p_id: "unassigned" } }]);
});
test("creation only sends plan, schedule, crew and notes, never client/property/snapshots", async () => {
  let payload;
  await api("Manager", async (_, args) => { payload = args; return { data: "visit", error: null }; }).createPorterVisit({ ...input, client_id: "forged", property_id: "forged", areas: [] });
  assert.deepEqual(Object.keys(payload).sort(), ["p_assigned_crew_id", "p_notes", "p_plan_id", "p_scheduled_date"]);
  for (const date of ["", "2026-02-30", "2026-13-01"]) assert.throws(() => models.validateVisitDate(date));
});
test("lifecycle rules and required checklist completion", () => {
  const validate = models.validateVisitMutation;
  assert.doesNotThrow(() => validate(visit, { action: "start" }, false));
  assert.doesNotThrow(() => validate(visit, { action: "cancel" }, true));
  assert.throws(() => validate(visit, { action: "cancel" }, false));
  assert.throws(() => validate(visit, { action: "complete" }, true));
  const started = { ...visit, status: "In Progress" };
  assert.throws(() => validate(started, { action: "start" }, true));
  assert.throws(() => validate(started, { action: "edit", data: input }, true));
  assert.throws(() => validate(started, { action: "complete" }, false), /Pending/);
  for (const status of ["Completed", "Unable to Complete"]) assert.doesNotThrow(() => validate({ ...started, areas: [{ ...visit.areas[0], status }, { id: "optional", is_required: false, status: "Pending" }] }, { action: "complete" }, false));
  assert.throws(() => validate(started, { action: "area", data: { area_id: "other", status: "Completed", notes: null } }, false));
  for (const status of ["Completed", "Cancelled"]) for (const action of ["start", "cancel", "complete", "notes", "edit", "area"]) assert.throws(() => validate({ ...visit, status }, { action, data: {} }, true), /read-only/);
});
test("every write sends expected version and propagates relationship/stale/provider failures", async () => {
  let payload;
  const service = api("Crew Lead", async (_, args) => { payload = args; return { data: null, error: { message: "Visit changed. Refresh and reopen it before saving." } }; });
  await assert.rejects(service.mutatePorterVisit(visit, { action: "start" }), /Visit changed/);
  assert.equal(payload.p_expected_updated_at, "version-1");
  assert.equal(payload.p_id, "visit");
  await assert.rejects(api("Manager", async () => ({ data: null, error: { message: "Plan property/client relationship is no longer valid." } })).createPorterVisit(input), /relationship/);
  await assert.rejects(api("Manager", async () => ({ data: null, error: { message: "Connection unavailable" } })).listPorterVisits(), /Connection unavailable/);
});
