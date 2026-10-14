import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261014161859_physical_signed_agreements.sql");
const route = read("app/api/agreements/[id]/physical-signing/route.ts");
const fileRoute = read("app/api/agreements/[id]/physical-signed-files/[fileId]/route.ts");
const page = read("components/agreements/AgreementsPage.tsx");
const panel = read("components/agreements/PhysicalSignedAgreement.tsx");
const service = read("lib/services/agreements.ts");
const physicalTypes = read("types/physicalAgreement.ts");

test("physical signing is restricted to active Master Admin and Administrator accounts", () => {
  assert.match(migration, /actor\.role not in \('Master Admin', 'Administrator'\)/);
  assert.match(route, /\["Master Admin", "Administrator"\]\.includes\(data\.role\)/);
  assert.match(fileRoute, /\["Master Admin", "Administrator"\]\.includes\(profile\.role\)/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*?to anon/);
  assert.match(migration, /grant execute on function public\.finalize_physical_service_agreement[\s\S]*?to authenticated/);
});

test("private signed files are validated, staged, and cleaned up before atomic finalization", () => {
  assert.match(migration, /'signed-agreements',[\s\S]*?false/);
  assert.match(migration, /No storage\.objects policies are added/);
  assert.match(physicalTypes, /application\/pdf/);
  assert.match(physicalTypes, /image\/jpeg/);
  assert.match(physicalTypes, /image\/png/);
  assert.match(route, /String\.fromCharCode[\s\S]*?%PDF-/);
  assert.match(route, /bytes\[0\] === 0xff[\s\S]*?bytes\[1\] === 0xd8/);
  assert.match(route, /uploadedPaths\.push/);
  assert.match(route, /if \(uploadedPaths\.length\)[\s\S]*?\.remove\(uploadedPaths\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /storage\.objects[\s\S]*?bucket_id = 'signed-agreements'/);
});

test("finalization preserves contract content and does not fabricate electronic evidence", () => {
  const finalUpdate = migration.match(/update public\.service_agreements\n  set status =[\s\S]*?returning \* into result_row;/)?.[0] ?? "";
  assert.match(finalUpdate, /status = case when p_replace then agreement_row\.status else 'Accepted' end/);
  assert.match(finalUpdate, /signing_method = 'physical'/);
  assert.match(finalUpdate, /physically_signed_on = p_physically_signed_on/);
  for (const protectedField of ["billing_amount", "pricing_snapshot", "scope", "agreement_terms", "client_signed_at", "client_signature", "client_consent_at"]) {
    assert.doesNotMatch(finalUpdate, new RegExp(`${protectedField}\\s*=`), `${protectedField} must not be rewritten`);
  }
  assert.match(service, /current\.signing_method \|\| current\.client_signed_at \? current\.service_name/);
  assert.match(service, /current\.signing_method \|\| current\.client_signed_at \? current\.scope/);
});

test("duplicate, conflicting, and replacement events are guarded and audited", () => {
  assert.match(migration, /Only an unsigned Sent Agreement can be finalized from a physical copy/);
  assert.match(migration, /electronically signed Agreement cannot be replaced/);
  assert.match(migration, /Physical Signed Copy Replaced/);
  assert.match(migration, /set archived_at = uploaded_at/);
  assert.match(migration, /replaced_event_id/);
  assert.match(panel, /existing files will remain in the audit history/);
});

test("administrative agreement details expose the physical status and secure file actions", () => {
  assert.match(page, /Upload Signed Agreement/);
  assert.match(page, /Signed — Physical Copy/);
  assert.match(page, /getAgreementById\(agreementId\)/);
  assert.match(panel, /Date physically signed/);
  assert.match(panel, /client&apos;s required signature is present/);
  assert.match(panel, /all other required signatures are present/);
  assert.match(panel, /View Signed Agreement/);
  assert.match(panel, /Download Signed Agreement/);
  assert.match(fileRoute, /createSignedUrl\([\s\S]*?5 \* 60/);
  assert.doesNotMatch(fileRoute, /getPublicUrl/);
});
