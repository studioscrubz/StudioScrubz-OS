import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration=readFileSync(new URL("../supabase/migrations/20261008001836_fix_create_proposal_revision_photo_seeding.sql",import.meta.url),"utf8");
const foundation=readFileSync(new URL("../supabase/migrations/20261007194500_proposal_revision_foundation.sql",import.meta.url),"utf8");
const photoContract=readFileSync(new URL("../supabase/invoice_operational_photo_snapshot_handoff.sql",import.meta.url),"utf8");
const page=readFileSync(new URL("../components/proposals/OpenProposalsPage.tsx",import.meta.url),"utf8");

test("forward migration replaces only the revision RPC and retains its security boundary",()=>{
  assert.match(migration,/create or replace function public\.create_proposal_revision\(p_proposal_id uuid\)/);
  assert.match(migration,/security definer\s+set search_path = ''/);
  assert.match(migration,/auth\.uid\(\) is null/);
  assert.match(migration,/has_any_role\(array\['Master Admin','Administrator','Sales'\]\)/);
  assert.match(migration,/revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(migration,/grant execute[\s\S]*to authenticated/);
  assert.doesNotMatch(migration,/create trigger|drop trigger|seed_proposal_pricing_photos/);
});

test("revision insertion delegates initial photos to the authoritative seed trigger",()=>{
  assert.match(migration,/source\.notes, source\.result, '\[\]'::jsonb/);
  assert.doesNotMatch(migration,/source\.result,\s*source\.photos/);
  assert.match(photoContract,/if jsonb_array_length\(new\.photos\) > 0 then raise exception 'New Proposal pricing photos must be initialized by the database.'/);
  assert.match(photoContract,/new\.walkthrough_id is null/);
  assert.match(photoContract,/public\.is_valid_operational_photo_path\('walkthroughs', new\.walkthrough_id/);
});

test("revision preserves references required for trigger-based photo seeding",()=>{
  assert.match(migration,/source\.estimate_id,\s*source\.walkthrough_id/);
  assert.match(migration,/source\.client_id, source\.property_id/);
  assert.match(migration,/source\.revision_group_id, next_revision,\s*source\.id, false, null/);
});

test("authorization eligibility locking numbering and history remain aligned",()=>{
  for(const contract of [
    /source\.status not in \('Sent','Viewed'\)/,
    /or source\.accepted/,
    /or not source\.is_current_revision/,
    /revision_group_id = source\.revision_group_id\s+for update/,
    /coalesce\(max\(revision_number\), 0\) \+ 1/,
    /This Proposal already has an open draft revision/,
    /insert into public\.proposal_history/,
  ]) assert.match(migration,contract);
  assert.match(foundation,/create unique index proposals_revision_group_number_uidx/);
  assert.match(foundation,/create unique index proposals_one_open_revision_uidx/);
});

test("UI extracts safe Postgrest-shaped messages and retains a fallback",()=>{
  assert.match(page,/x && typeof x === "object" && "message" in x/);
  assert.match(page,/typeof message === "string" && message\.trim\(\) && message\.length <= 500/);
  assert.match(page,/return f;/);
});
