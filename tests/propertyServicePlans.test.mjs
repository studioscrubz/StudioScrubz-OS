import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual TypeScript modules with database calls replaced at the boundary.
function load(path, dependencies = {}) {
  const testModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module: testModule, exports: testModule.exports, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, Date, Set, Error });
  return testModule.exports;
}
const models = load("types/propertyServicePlan.ts");
const permissions = load("lib/auth/permissions.ts");
const input = {
  name: "Common area upkeep", client_id: "client", property_id: "property", agreement_id: null,
  service_id: null, status: "Active", start_date: "2026-09-09", end_date: null,
  frequency: "Weekly", service_days: [1], assigned_crew_id: null, notes: null,
};
const areas = [{ name: "Entryways", description: null, sort_order: 0, is_required: true, requires_photo: true, active: true }];
function service(role, rpc) {
  return load("lib/services/propertyServicePlans.ts", {
    "@/lib/auth/permissions": permissions,
    "@/lib/services/auth": { getCurrentProfile: async () => ({ role, is_active: true }) },
    "@/lib/supabase/client": { getSupabaseClient: () => ({ rpc, from: () => { throw new Error("Unexpected table access"); } }) },
    "@/types/propertyServicePlan": models,
  });
}

test("only management roles have plan access, including the nested route", async () => {
  for (const role of ["Master Admin", "Administrator", "Manager", "Sales", "Crew Lead", "Scrub Technician"]) {
    const permitted = ["Master Admin", "Administrator", "Manager"].includes(role);
    assert.equal(permissions.hasPermission({ role, is_active: true }, permissions.permissionForPath("/properties/service-plans")), permitted);
    assert.equal(permissions.hasPermission({ role, is_active: false }, "propertyServicePlans.manage"), false);
    let calls = 0;
    const api = service(role, async () => { calls++; return { data: { ...input, id: "new", areas }, error: null }; });
    if (permitted) await api.createPropertyServicePlan(input, areas);
    else {
      await assert.rejects(api.createPropertyServicePlan(input, areas), /access denied/);
      await assert.rejects(api.listPropertyServicePlans(), /access denied/);
      await assert.rejects(api.getPropertyServicePlan("other-plan"), /access denied/);
    }
    assert.equal(calls, permitted ? 1 : 0);
  }
});

test("frequencies, unique weekdays, dates and custom area validation", () => {
  for (const [frequency, service_days] of [["Daily", [1,2,3,4,5,6,7]], ["Multiple Days Per Week", [2,4]], ["Weekly", [7]], ["Custom", []]]) {
    assert.doesNotThrow(() => models.validatePropertyServicePlan({ ...input, frequency, service_days }, areas));
  }
  for (const patch of [
    { frequency: "Daily", service_days: [1] }, { frequency: "Weekly", service_days: [] },
    { frequency: "Multiple Days Per Week", service_days: [1] }, { service_days: [1,1] },
    { frequency: "Custom", service_days: [8] }, { service_days: [1.5] },
    { start_date: "2026-02-30" }, { end_date: "2026-09-08" }, { name: " " }, { property_id: "" },
  ]) assert.throws(() => models.validatePropertyServicePlan({ ...input, ...patch }, areas));
  assert.throws(() => models.validatePropertyServicePlan(input, [{ ...areas[0], name: " " }]));
  assert.throws(() => models.validatePropertyServicePlan(input, [{ ...areas[0], id: "same" }, { ...areas[0], id: "same" }]));
});

test("one atomic save carries area flags, IDs and optimistic concurrency token", async () => {
  const plan = { ...input, id: "plan", updated_at: "2026-09-09T01:00:00Z", areas: [{ ...areas[0], id: "area" }] };
  const calls = [];
  const api = service("Manager", async (name, args) => { calls.push({ name, args }); return { data: plan, error: null }; });
  await api.updatePropertyServicePlan(plan, input, plan.areas);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "save_property_service_plan");
  assert.equal(calls[0].args.p_expected_updated_at, plan.updated_at);
  assert.equal(calls[0].args.p_areas[0].id, "area");
  assert.equal(calls[0].args.p_areas[0].requires_photo, true);
  await api.archivePropertyServicePlan(plan);
  assert.equal(calls[1].args.p_archive, true);
  assert.equal(calls[1].args.p_plan.status, "Ended");
});

test("database rejection is surfaced and invalid input never invokes the write", async () => {
  let calls = 0;
  const api = service("Administrator", async () => { calls++; return { data: null, error: { message: "This plan changed. Refresh and reopen it before saving." } }; });
  await assert.rejects(api.createPropertyServicePlan({ ...input, service_days: [] }, areas), /Weekly requires one/);
  assert.equal(calls, 0);
  await assert.rejects(api.createPropertyServicePlan(input, areas), /This plan changed/);
  assert.equal(calls, 1);
});

test("permanent deletion invokes RPC for management roles and surfaces foreign key rejections", async () => {
  const plan = { ...input, id: "plan-to-delete", updated_at: "2026-09-09T01:00:00Z", areas: [{ ...areas[0], id: "area" }] };
  const calls = [];
  const api = service("Manager", async (name, args) => {
    calls.push({ name, args });
    if (args.p_id === "plan-with-visits") return { data: null, error: { message: "This Property Service Plan cannot be permanently deleted because it has 2 associated Porter Visit(s). Archive the plan instead." } };
    return { data: null, error: null };
  });

  // Non-management role rejection
  const nonMgmtApi = service("Sales", async () => ({ data: null, error: null }));
  await assert.rejects(nonMgmtApi.deletePropertyServicePlan(plan), /access denied/);

  // Management role success
  await api.deletePropertyServicePlan(plan);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "delete_property_service_plan");
  assert.equal(calls[0].args.p_id, "plan-to-delete");

  // Rejection when plan has associated visits
  const planWithVisits = { ...plan, id: "plan-with-visits" };
  await assert.rejects(api.deletePropertyServicePlan(planWithVisits), /associated Porter Visit/);
});

test("delete migration defines secure RPC with role authorization and visit protection", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260910000000_delete_property_service_plan.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function public\.delete_property_service_plan/);
  assert.match(sql, /security definer set search_path = ''/);
  assert.match(sql, /auth\.uid\(\) is null or not public\.has_any_role\(array\['Master Admin','Administrator','Manager'\]\)/);
  assert.match(sql, /select count\(\*\) into v_visits_count from public\.property_service_visits where service_plan_id = p_id/);
  assert.match(sql, /delete from public\.property_service_plan_areas where service_plan_id = p_id/);
  assert.match(sql, /delete from public\.property_service_plans where id = p_id/);
  assert.match(sql, /revoke all on function public\.delete_property_service_plan\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.delete_property_service_plan\(uuid\) to authenticated/);
});

test("common service area options constant is exported and includes standard options plus custom area", () => {
  assert.ok(Array.isArray(models.COMMON_SERVICE_AREA_OPTIONS));
  assert.ok(models.COMMON_SERVICE_AREA_OPTIONS.includes("Lobby / Entrance"));
  assert.ok(models.COMMON_SERVICE_AREA_OPTIONS.includes("Trash / Refuse Area"));
  assert.ok(models.COMMON_SERVICE_AREA_OPTIONS.includes("Other / Custom Area"));
  assert.equal(models.COMMON_SERVICE_AREA_OPTIONS.length, 26);
});
