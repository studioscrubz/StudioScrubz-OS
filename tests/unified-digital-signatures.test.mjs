import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261015141753_in_person_digital_agreement_signing.sql");
const onlinePage = read("components/agreements/PublicAgreementPage.tsx");
const inPersonPage = read("components/agreements/InPersonAgreementPage.tsx");
const pad = read("components/agreements/SignaturePad.tsx");
const acceptRoute = read("app/api/public/agreements/accept/route.ts");
const inPersonRoute = read("app/api/public/agreements/in-person/[token]/route.ts");
const validator = read("lib/signatures/drawnSignature.ts");

test("online and in-person signing share one signature pad", () => {
  assert.match(onlinePage, /<SignaturePad/);
  assert.match(inPersonPage, /<SignaturePad/);
  assert.match(pad, /onPointerDown/);
  assert.match(pad, />Undo</);
  assert.match(pad, />Redo</);
  assert.match(pad, />Clear</);
});

test("online signing requires review, consent, legal name, and actual ink", () => {
  assert.match(onlinePage, /Complete Signature/);
  assert.match(onlinePage, /!reviewed \|\| !consent \|\| !signature/);
  assert.doesNotMatch(onlinePage, /\/s\/ /);
  assert.match(acceptRoute, /validateDrawnPngSignature\(signature\)/);
  assert.match(acceptRoute, /p_reviewed: body\.reviewed \?\? false/);
  assert.match(validator, /inkPixels < 40/);
});

test("direct RPC calls require a short-lived server-issued signature validation receipt", () => {
  assert.match(migration, /create table public\.service_agreement_validated_signatures/);
  assert.match(migration, /revoke all on table public\.service_agreement_validated_signatures from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.register_validated_agreement_signature\(text, text, text\) to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.register_validated_agreement_signature[^;]+to anon/);
  assert.match(acceptRoute, /createSupabaseAdminClient\(\)\.rpc\("register_validated_agreement_signature"/);
  assert.match(inPersonRoute, /createSupabaseAdminClient\(\)\.rpc\("register_validated_agreement_signature"/);
  assert.match(migration, /and signature_hash = public\.agreement_signature_png_hash\(p_signature\)/);
  assert.match(migration, /and consumed_at is null and expires_at > /);
  assert.match(migration, /set consumed_at = /);
});

test("database validates decoded PNG structure and dimensions before hashing", () => {
  assert.match(migration, /decode\(encoded, 'base64'\)/);
  assert.match(migration, /89504e470d0a1a0a/);
  assert.match(migration, /convert_to\('IHDR', 'UTF8'\)/);
  assert.match(migration, /convert_to\('IDAT', 'UTF8'\)/);
  assert.match(migration, /0000000049454e44ae426082/);
  assert.match(migration, /width < 240 or height < 80 or width > 2400 or height > 1200/);
});

test("migration removes the typed-signature overload and atomically accepts drawn signatures", () => {
  assert.match(migration, /drop function public\.accept_service_agreement_by_token\(text, text, text, boolean\)/);
  assert.match(migration, /p_reviewed boolean/);
  assert.match(migration, /p_signature !~ '\^data:image\/png;base64/);
  assert.match(migration, /signing_method = 'electronic'/);
  assert.match(migration, /status = 'Accepted'/);
  assert.doesNotMatch(migration.match(/create function public\.accept_service_agreement_by_token[\s\S]*?\$\$;/)?.[0] ?? "", /\/s\//);
  assert.doesNotMatch(migration, /drop function[^;]+cascade/i);
});

test("online acceptance keeps existing Sent links usable and returns the completed agreement", () => {
  const onlineRpc = migration.match(/create function public\.accept_service_agreement_by_token[\s\S]*?\n\$\$;/)?.[0] ?? "";
  assert.match(onlineRpc, /client_access_token = p_token/);
  assert.match(onlineRpc, /client_access_token_expires_at > now\(\)/);
  assert.doesNotMatch(onlineRpc, /client_access_token\s*=\s*null/);
  assert.match(onlineRpc, /return public\.get_service_agreement_by_token\(p_token\)/);
});

test("migration preserves historical agreement content and physical-signature history", () => {
  assert.match(migration, /Depends on the already-applied 20261014170443_physical_signed_agreements\.sql/);
  assert.doesNotMatch(migration, /delete from public\.service_agreements/i);
  assert.doesNotMatch(migration, /update public\.service_agreements\s+set\s+(pricing_snapshot|billing_amount|scope|agreement_terms)/i);
  assert.doesNotMatch(migration, /drop table[^;]+service_agreement_physical/i);
});

test("signed rendering preserves historical typed signatures and prints drawn PNG signatures", () => {
  assert.match(onlinePage, /startsWith\("data:image\/png;base64,"\)/);
  assert.match(onlinePage, /<img src=\{agreement\.client_signature!/);
  assert.match(onlinePage, /font-serif text-2xl italic/);
  assert.match(onlinePage, /Print \/ Save as PDF/);
});
