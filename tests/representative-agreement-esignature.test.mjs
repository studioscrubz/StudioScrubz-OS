import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261016140042_representative_agreement_esignatures.sql", "utf8");
const page = readFileSync("components/agreements/AgreementsPage.tsx", "utf8");
const publicPage = readFileSync("components/agreements/PublicAgreementPage.tsx", "utf8");

test("representative signing is Master Admin-only and requires consent plus a drawn PNG", () => {
  assert.match(migration, /actor\.role <> 'Master Admin'/);
  assert.match(migration, /p_consent is distinct from true/);
  assert.match(migration, /agreement_signature_png_hash\(p_signature\)/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
});

test("signing is atomic, idempotent, and cannot be duplicated concurrently", () => {
  assert.match(migration, /idempotency_key uuid not null unique/);
  assert.match(migration, /agreement_id uuid not null unique/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /where id = p_agreement_id for update/);
  assert.match(migration, /already been signed by StudioScrubz/);
});

test("audit evidence is append-only and binds signature to immutable terms", () => {
  assert.match(migration, /document_snapshot jsonb not null/);
  assert.match(migration, /document_hash text not null/);
  assert.match(migration, /before update or delete/);
  assert.match(migration, /representative-signed Service Agreement cannot be materially changed/);
  assert.match(migration, /extensions\.digest\(convert_to\(snapshot::text, 'UTF8'\), 'sha256'\)/);
});

test("legacy and client signatures remain independent", () => {
  assert.doesNotMatch(migration, /alter table public\.service_agreements\s+add column/);
  assert.doesNotMatch(migration, /update public\.service_agreements\s+set client_/);
  assert.match(migration, /status in \('Sent', 'Accepted', 'Active', 'Paused'\)/);
});

test("internal and printable views expose signing state and both signatures", () => {
  assert.match(page, /Sign as StudioScrubz/);
  assert.match(page, /Awaiting Client Signature/);
  assert.match(page, /Awaiting StudioScrubz Signature/);
  assert.match(page, /Fully Signed/);
  assert.match(page, /StudioScrubz Representative Acceptance/);
  assert.match(publicPage, /StudioScrubz Representative Acceptance/);
  assert.match(publicPage, /document_hash/);
});
