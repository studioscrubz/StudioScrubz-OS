import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const importer = readFileSync("components/prospects/ProspectCsvImport.tsx", "utf8");
const updateImport = readFileSync("components/prospects/ProspectUpdateImport.tsx", "utf8");
const updateRoute = readFileSync("app/api/prospects/signed-export/route.ts", "utf8");
const page = readFileSync("components/prospects/ProspectsPage.tsx", "utf8");

test("bulk decisions remain constrained by row eligibility", () => {
  for (const label of ["Skip All", "Import All Eligible Separately", "Merge All Eligible Matches"]) {
    assert.match(importer, new RegExp(label));
  }
  assert.match(importer, /decision==="Skip"\?"Skip"/);
  assert.match(importer, /row\.classification==="Invalid"\?"Skip"/);
  assert.match(importer, /row\.classification==="Exact duplicate"\?"Skip":"Import Separately"/);
  assert.match(importer, /row\.matchedProspectId\?"Merge":"Skip"/);
  assert.match(importer, /onChange=\{e=>decide\(index/);
  assert.match(importer, /disabled=\{row\.classification==="Invalid"\}/);
});

test("signed updates are server-authenticated, user-bound, and concurrency guarded", () => {
  assert.match(updateRoute, /import "server-only"/);
  assert.match(updateRoute, /createHmac\("sha256",secret\(\)\)/);
  assert.match(updateRoute, /timingSafeEqual/);
  assert.match(updateRoute, /studioscrubz-prospect-export-v1\|"\+user\+"\|"\+id\+"\|"\+updated/);
  assert.match(updateRoute, /\.eq\("id",id\)\.is\("merged_into_prospect_id",null\)/);
  assert.match(updateRoute, /if\(!value\)continue; \/\/ blanks preserve existing values/);
  assert.match(updateRoute, /\.eq\("updated_at",updated\)\.select\("id"\)\.maybeSingle\(\)/);
  assert.doesNotMatch(updateRoute, /createSupabaseAdminClient|service_role|\.insert\(/);
});

test("signed export and reimport controls remain management-scoped in the UI", () => {
  assert.match(page, /canManageAll&&<>/);
  assert.match(page, /exportSignedUpdate\(\)/);
  assert.match(page, /Reimport Updates/);
  assert.match(page, /<ProspectUpdateImport/);
  assert.match(updateImport, /Only signed StudioScrubz update exports are accepted/);
  assert.match(updateImport, /Blank cells preserve existing values/);
  assert.match(updateImport, /Updates never create new prospects/);
});
