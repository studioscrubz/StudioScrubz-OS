import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}) {
  const target = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: target, exports: target.exports, require: name => {
    if (!(name in dependencies)) throw Error(`Unexpected dependency: ${name}`); return dependencies[name];
  }, Date, Set, Error, crypto: { randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });
  return target.exports;
}
const models = load("types/porterReporting.ts");
const visitModels = load("types/porterVisit.ts", { "@/types/porterReporting": models });
const permissions = load("lib/auth/permissions.ts");
const photoTypes = load("types/photo.ts");
const photoHelpers = load("lib/services/photoStorage.ts", { "@/types/photo": photoTypes, "@/lib/supabase/client": {} });
const file = { name: "../../untrusted.jpg", type: "image/jpeg", size: 2048 };
const issueInput = { visit_area_id: "area", category: "Maintenance", severity: "High", title: "Observed damage", description: "Visual observation" };
const issue = { ...issueInput, id: "issue", visit_id: "visit", updated_at: "version-1", status: "Open" };
function api(role, overrides = {}) {
  const calls = [];
  const storage = {
    upload: async (...args) => { calls.push(["upload", ...args]); return { error: null }; },
    remove: async paths => { calls.push(["remove", paths]); return { error: null }; },
    createSignedUrls: async (...args) => { calls.push(["signed", ...args]); return { data: [{ signedUrl: "https://signed.invalid/short-lived" }], error: null }; },
    ...overrides.storage,
  };
  const db = { storage: { from: bucket => { assert.equal(bucket, "operational-photos"); return storage; } }, rpc: async (name, args) => { calls.push([name, args]); return overrides.rpc ? overrides.rpc(name, args) : { data: "saved", error: null }; } };
  return { calls, service: load("lib/services/porterReporting.ts", {
    "@/lib/auth/permissions": permissions,
    "@/lib/services/auth": { getCurrentProfile: async () => ({ role, is_active: true }) },
    "@/lib/supabase/client": { getSupabaseClient: () => db },
    "@/types/photo": photoTypes, "@/types/porterReporting": models,
    "@/lib/services/photoStorage": { ...photoHelpers, prepareOperationalPhoto: async photo => photo },
  }) };
}
test("six roles: field reporting allowed, only management disposition, Sales denied", async () => {
  for (const role of ["Master Admin", "Administrator", "Manager", "Crew Lead", "Scrub Technician", "Sales"]) {
    const { service, calls } = api(role);
    if (role === "Sales") {
      await assert.rejects(service.savePorterIssue("visit", issueInput), /access denied/);
      await assert.rejects(service.uploadPorterPhoto({ visitId: "visit", areaId: null, issueId: null, file }), /access denied/);
      await assert.rejects(service.signPorterPhotos([]), /access denied/);
    } else await service.savePorterIssue("visit", issueInput);
    if (["Master Admin", "Administrator", "Manager"].includes(role)) await service.resolvePorterIssue(issue, "resolve", "Referred for follow-up");
    else await assert.rejects(service.resolvePorterIssue(issue, "resolve", ""), /access denied/);
    if (role === "Sales") assert.equal(calls.length, 0);
  }
});
test("uploads use generated paths, no upsert, and register only after storage success", async () => {
  for (const areaId of [null, "area"]) {
    const { service, calls } = api("Crew Lead");
    await service.uploadPorterPhoto({ visitId: "visit", areaId, issueId: areaId ? "issue" : null, caption: "Evidence", file });
    assert.equal(calls[0][0], "upload");
    assert.equal(calls[0][1], "porter-visits/visit/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg");
    assert.equal(calls[0][3].upsert, false);
    assert.equal(calls[1][0], "add_porter_visit_photo");
    assert.equal(calls[1][1].p_visit_area_id, areaId);
    assert.equal("p_uploaded_by" in calls[1][1], false);
  }
  const denied = api("Scrub Technician", { storage: { upload: async () => ({ error: { message: "assignment denied" } }) } });
  await assert.rejects(denied.service.uploadPorterPhoto({ visitId: "other", file }), /assignment denied/);
  assert.equal(denied.calls.length, 0);
});
test("image MIME and size limits are shared with existing photo workflow", async () => {
  const { service, calls } = api("Manager");
  for (const invalid of [{ ...file, type: "image/svg+xml" }, { ...file, size: 10485761 }, { ...file, size: 0 }]) {
    await assert.rejects(service.uploadPorterPhoto({ visitId: "visit", file: invalid }));
  }
  assert.equal(calls.length, 0);
});
test("registration rejection cleans only unattached objects; ambiguous commits are retained", async () => {
  for (const message of ["Area does not belong to this visit", "Historical visits cannot receive new evidence", "Issue/area mismatch", "access denied"]) {
    const { service, calls } = api("Crew Lead", { rpc: () => ({ error: { message } }) });
    await assert.rejects(service.uploadPorterPhoto({ visitId: "visit", file }), new RegExp(message));
    assert.equal(calls.at(-1)[0], "remove");
  }
  const retained = api("Manager", { rpc: () => { throw Error("Response lost"); }, storage: { remove: async () => ({ error: { message: "registered evidence is immutable" } }) } });
  await assert.rejects(retained.service.uploadPorterPhoto({ visitId: "visit", file }), /retained; refresh/);
});
test("photo-required snapshots block completion until resolved and photographed", () => {
  const snapshot = { id: "area", requires_photo: true, is_required: true, status: "Completed" };
  const visit = { status: "In Progress", areas: [snapshot], issues: [{ status: "Open", severity: "Urgent" }] };
  for (const status of ["Completed", "Unable to Complete"]) {
    const current = { ...visit, areas: [{ ...snapshot, status }] };
    assert.throws(() => visitModels.validateVisitMutation(current, { action: "complete" }, false), /photo evidence/);
    assert.doesNotThrow(() => visitModels.validateVisitMutation({ ...current, photos: [{ visit_area_id: "area", archived_at: null }] }, { action: "complete" }, false));
  }
  for (const photos of [[{ visit_area_id: null, archived_at: null }], [{ visit_area_id: "other", archived_at: null }], [{ visit_area_id: "area", archived_at: "archived" }]]) assert.equal(models.missingPorterPhotoRequirements([snapshot], photos), true);
  assert.equal(models.missingPorterPhotoRequirements([{ ...snapshot, status: "Pending" }], [{ visit_area_id: "area", archived_at: null }]), true);
  for (const status of ["Pending", "Completed", "Unable to Complete"]) {
    const optional = { ...snapshot, is_required: false, status };
    assert.equal(models.missingPorterPhotoRequirements([optional], []), false);
    assert.doesNotThrow(() => visitModels.validateVisitMutation({ ...visit, areas: [optional] }, { action: "complete" }, false));
  }
  assert.throws(() => visitModels.validateVisitMutation({ ...visit, status: "Completed" }, { action: "notes", data: {} }, true), /read-only/);
});
test("issue edits and management disposition send version and preserve server errors", async () => {
  const { service, calls } = api("Manager");
  await service.savePorterIssue("visit", issueInput, issue);
  await service.resolvePorterIssue(issue, "acknowledge", "  Reviewing  ");
  assert.equal(calls[0][1].p_expected_updated_at, "version-1");
  assert.equal(calls[1][1].p_data.resolution_notes, "Reviewing");
  const stale = api("Manager", { rpc: () => ({ error: { message: "Issue changed. Refresh before saving." } }) });
  await assert.rejects(stale.service.resolvePorterIssue(issue, "resolve", "Done"), /Issue changed/);
  const denied = api("Crew Lead", { rpc: () => ({ error: { message: "Porter Visit access denied" } }) });
  await assert.rejects(denied.service.savePorterIssue("other-crew", issueInput), /access denied/);
});
test("secure image links expire after fifteen minutes and can be renewed", async () => {
  const { service, calls } = api("Manager");
  const rows = [{ storage_path: "porter-visits/visit/photo.jpg" }];
  assert.equal((await service.signPorterPhotos(rows))[0].signedUrl, "https://signed.invalid/short-lived");
  await service.signPorterPhotos(rows);
  assert.equal(calls[0][2], 900);
  assert.equal(calls.length, 2);
});
test("migration security contract: parent locks, RLS, immutable evidence, private bucket", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260909043018_porter_issue_photo_reporting_v1.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /as \$\n|end \$;/);
  assert.equal((sql.match(/\$\$/g) ?? []).length % 2, 0);
  for (const text of ["enable row level security", "set search_path=''", "for update", "for share", "p_expected_updated_at", "public.can_access_porter_visit", "owner_id=auth.uid()::text", "archived_at is null", "a.is_required and a.requires_photo", "private operational-photos", "as restrictive for update", "as restrictive for delete", "not manager", "v.status<>'In Progress'", "i.visit_area_id is distinct from p_visit_area_id"]) assert.ok(sql.includes(text), text);
  assert.doesNotMatch(sql, /grant (insert|update|delete) on public.property_service_visit_(photos|issues)/i);
});
