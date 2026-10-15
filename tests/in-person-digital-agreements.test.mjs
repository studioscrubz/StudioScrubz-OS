import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261015141753_in_person_digital_agreement_signing.sql");
const page = read("components/agreements/InPersonAgreementPage.tsx");
const signaturePad = read("components/agreements/SignaturePad.tsx");
const signatureValidator = read("lib/signatures/drawnSignature.ts");
const agreements = read("components/agreements/AgreementsPage.tsx");
const publicRoute = read("app/api/public/agreements/in-person/[token]/route.ts");
const sessionRoute = read("app/api/agreements/[id]/in-person-signing-session/route.ts");

test("only authorized representatives can create short-lived agreement-bound sessions", () => {
  assert.match(migration, /actor\.role not in \('Master Admin', 'Administrator', 'Manager'\)/);
  assert.match(migration, /agreement_row\.status <> 'Sent'/);
  assert.match(migration, /now\(\) \+ interval '15 minutes'/);
  assert.match(migration, /sha256\(convert_to\(p_token, 'UTF8'\)\)/);
  assert.match(migration, /set revoked_at = now\(\)/);
  assert.match(sessionRoute, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(agreements, />Sign In Person</);
});

test("finger, stylus, and mouse use pointer input with clear, undo, and redo", () => {
  assert.match(page, /<SignaturePad/);
  assert.match(signaturePad, /onPointerDown/);
  assert.match(signaturePad, /onPointerMove/);
  assert.match(signaturePad, /event\.pointerType \|\| "mouse"/);
  assert.match(signaturePad, />Undo</);
  assert.match(signaturePad, />Redo</);
  assert.match(signaturePad, />Clear</);
  assert.match(signaturePad, /touch-none/);
});

test("server rejects blank or malformed signatures and requires review and consent", () => {
  assert.match(publicRoute, /validateDrawnPngSignature/);
  assert.match(signatureValidator, /sharp\(Buffer\.from/);
  assert.match(signatureValidator, /inkPixels < 40/);
  assert.match(migration, /p_consent is distinct from true or p_reviewed is distinct from true/);
  assert.match(migration, /data:image\/png;base64/);
  assert.match(page, /Complete Signature/);
});

test("completion is atomic, rejects expiry and duplicates, and preserves signed content", () => {
  assert.match(migration, /session_row\.expires_at <= signed_at/);
  assert.match(migration, /session_row\.completed_at is not null/);
  assert.match(migration, /client_signed_snapshot = session_row\.agreement_snapshot/);
  assert.match(migration, /signing_method = 'in_person_digital'/);
  assert.match(migration, /in_person_witnessed_by = session_row\.witnessed_by/);
  const update = migration.match(/update public\.service_agreements\n  set client_signed_name[\s\S]*?where id = agreement_row\.id;/)?.[0] ?? "";
  for (const field of ["billing_amount", "pricing_snapshot", "scope", "agreement_terms", "cancellation_terms"]) {
    assert.doesNotMatch(update, new RegExp(`${field}\\s*=`));
  }
});

test("signed audit details remain printable from administrative agreement history", () => {
  assert.match(agreements, /In-Person Digital Signature/);
  assert.match(agreements, /in_person_witnessed_by_name/);
  assert.match(page, /Download \/ Print Signed Agreement/);
  assert.match(page, /agreement\.client_signature/);
});
