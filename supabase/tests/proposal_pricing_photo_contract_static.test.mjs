import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../migrations/20260919163228_restore_proposal_pricing_photo_contract.sql", import.meta.url),
  "utf8",
);
const service = fs.readFileSync(new URL("../../lib/services/proposalPhotos.ts", import.meta.url), "utf8");

const managementProfile = /profile\.id = \(select auth\.uid\(\)\)[\s\S]*?profile\.is_active[\s\S]*?profile\.role in \('Master Admin', 'Administrator', 'Manager'\)/;

test("proposal pricing-photo RPC signatures match the application contract", () => {
  for (const name of [
    "get_proposal_pricing_photos",
    "set_proposal_pricing_photo_caption",
    "remove_proposal_pricing_photo",
  ]) {
    assert.match(service, new RegExp(`rpc\\("${name}"`));
  }
  assert.match(migration, /get_proposal_pricing_photos\(p_proposal_id uuid\)\s+returns jsonb/);
  assert.match(migration, /set_proposal_pricing_photo_caption\(\s*p_proposal_id uuid,\s*p_photo_id text,\s*p_caption text\s*\)\s+returns jsonb/);
  assert.match(migration, /remove_proposal_pricing_photo\(\s*p_proposal_id uuid,\s*p_photo_id text\s*\)\s+returns jsonb/);
});

test("all three RPCs require an active management profile and exact proposal scope", () => {
  assert.equal((migration.match(/if auth\.uid\(\) is null/g) ?? []).length, 3);
  assert.equal((migration.match(new RegExp(managementProfile.source, "g")) ?? []).length, 3);
  assert.equal((migration.match(/where proposal\.id = p_proposal_id/g) ?? []).length, 3);
  assert.doesNotMatch(migration, /'Sales'|'Crew Lead'|'Scrub Technician'/);
});

test("caption and removal lock the proposal and remain Draft-only", () => {
  assert.equal((migration.match(/for update;/g) ?? []).length, 2);
  assert.equal((migration.match(/v_status is distinct from 'Draft'/g) ?? []).length, 2);
  assert.match(migration, /length\(coalesce\(p_caption, ''\)\) > 1000/);
  assert.match(migration, /v_match_count > 1/);
});

test("removal preserves the client Storage cleanup contract", () => {
  assert.match(migration, /'photos', v_photos/);
  assert.match(migration, /'removedPhoto', v_removed/);
  assert.match(migration, /'deleteStorageObject', coalesce\(v_removed->>'ownership', ''\) = 'proposal'/);
  assert.match(service, /if \(result\.deleteStorageObject && removedPhoto\.storagePath\)/);
  assert.match(service, /storage\.from\(OPERATIONAL_PHOTO_BUCKET\)\.remove/);
});

test("RPCs have hardened definer configuration and authenticated-only grants", () => {
  assert.equal((migration.match(/security definer\s+set search_path = ''/g) ?? []).length, 3);
  assert.match(migration, /revoke all on function public\.get_proposal_pricing_photos\(uuid\),[\s\S]*?from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.get_proposal_pricing_photos\(uuid\),[\s\S]*?to authenticated;/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (?:public|anon)/i);
});
