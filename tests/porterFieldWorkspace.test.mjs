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
const workspace = readFileSync(new URL("../components/properties/PorterFieldWorkspace.tsx", import.meta.url), "utf8");
const visitsPage = readFileSync(new URL("../components/properties/PorterVisitsPage.tsx", import.meta.url), "utf8");
const reporting = readFileSync(new URL("../components/properties/PorterReporting.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../lib/services/porterVisits.ts", import.meta.url), "utf8");

test("field workspace is available to authorized technicians and management only", () => {
  for (const role of ["Master Admin", "Administrator", "Manager", "Crew Lead", "Scrub Technician"]) assert.equal(permissions.hasPermission({ role, is_active: true }, permissions.permissionForPath("/properties/porter/my-visits")), true);
  for (const role of ["Sales", "Lead Representative"]) assert.equal(permissions.hasPermission({ role, is_active: true }, permissions.permissionForPath("/properties/porter/my-visits")), false);
  assert.equal(permissions.hasPermission({ role: "Scrub Technician", is_active: false }, "porterVisits.view"), false);
});

test("workspace uses assignment-authorized visit RPCs and existing lifecycle mutations", () => {
  assert.match(workspace, /listPorterVisits\(\)/);
  assert.match(workspace, /getPorterVisit\(id\)/);
  assert.match(workspace, /mutatePorterVisit\(selected, mutation\)/);
  assert.doesNotMatch(workspace, /service_role|\.from\(|localStorage|indexedDB/);
  assert.match(service, /rpc\("get_porter_visits"/);
  assert.match(service, /p_expected_updated_at: visit\.updated_at/);
});

test("action-first cards expose start, resume, view, progress, and mobile touch targets", () => {
  for (const text of ["My Visits Today", "Currently active", "Today’s assigned visits", "Upcoming visits", "Start", "Resume", "View", "Checklist progress"]) assert.match(workspace, new RegExp(text));
  assert.match(workspace, /min-h-12/);
  assert.match(workspace, /aria-label=\{`\$\{action\} Porter Visit/);
});

test("completion readiness separates blockers from unable areas and open issues", () => {
  const visit = {
    areas: [
      { id: "pending", is_required: true, requires_photo: false, status: "Pending" },
      { id: "photo", is_required: true, requires_photo: true, status: "Completed" },
      { id: "unable", is_required: false, requires_photo: false, status: "Unable to Complete" },
    ],
    photos: [], issues: [{ status: "Open" }, { status: "Resolved" }],
  };
  const result = hub.porterVisitReadiness(visit);
  assert.equal(result.ready, false);
  assert.equal(result.blockers, 2);
  assert.equal(result.pendingRequired.length, 1);
  assert.equal(result.missingPhotoAreas.length, 1);
  assert.equal(result.unableToComplete.length, 1);
  assert.equal(result.openIssues.length, 1);
  for (const text of ["Required areas pending", "Required photos missing", "Unable to complete", "Open issues"]) assert.match(visitsPage, new RegExp(text));
});

test("photo evidence supports camera capture, confirmed success, failure, and safe retry states", () => {
  assert.match(reporting, /capture="environment"/);
  assert.match(reporting, /uploadState === "saving"/);
  assert.match(reporting, /Photo saved and confirmed by the server/);
  assert.match(reporting, /Photo was not confirmed/);
  assert.match(reporting, /Retry Upload/);
});

test("duplicate submissions remain disabled and terminal lifecycle compatibility is preserved", () => {
  assert.match(workspace, /if \(!selected \|\| saveState === "saving"\) return/);
  assert.match(visitsPage, /disabled=\{busy \|\| blocked\}/);
  assert.match(visitsPage, /Completed/);
  assert.match(visitsPage, /Cancelled/);
  assert.match(visitsPage, /read-only/);
  assert.match(visitsPage, /fieldMode/);
});
