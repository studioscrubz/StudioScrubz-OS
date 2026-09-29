import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration=readFileSync("supabase/migrations/20260929153140_prospect_engine_phase_2_csv_duplicates.sql","utf8");
const csv=readFileSync("lib/prospectCsv.ts","utf8");
const importer=readFileSync("components/prospects/ProspectCsvImport.tsx","utf8");
const page=readFileSync("components/prospects/ProspectsPage.tsx","utf8");

test("CSV limits, mapping, normalization, preview, and in-memory processing are explicit",()=>{assert.match(csv,/5 \* 1024 \* 1024/);assert.match(csv,/CSV_MAX_ROWS = 2000/);for(const field of ["company_name","contact_name","business_email","business_phone","website","address","city","state","zip","industry","notes","source"])assert.match(csv,new RegExp(field));assert.match(csv,/Exact duplicate/);assert.match(csv,/Possible duplicate/);assert.match(importer,/TextDecoder\("utf-8",\{fatal:true\}\)/);assert.doesNotMatch(importer,/storage\.|upload\(|FormData/);});
test("imports are batched, idempotent, self-assigned for Sales, and RLS protected",()=>{assert.match(importer,/start<preview\.length;start\+=100/);assert.match(migration,/unique\(created_by, request_id\)/);assert.match(migration,/unique\(batch_id, row_number\)/);assert.match(migration,/Sales imports must be self-assigned/);assert.match(migration,/enable row level security/g);assert.match(migration,/revoke all on table public\.prospect_import_batches/);assert.doesNotMatch(migration,/service_role/);});
test("duplicate lookup is non-unique and controlled merges are transactional and audited",()=>{assert.match(migration,/drop index public\.prospects_email_normalized_key/);assert.match(migration,/create index prospects_email_normalized_idx/);assert.doesNotMatch(migration,/create unique index prospects_(email|phone|domain)_normalized_idx/);assert.match(migration,/for update/);assert.match(migration,/p_survivor_id=p_removed_id/);assert.match(migration,/already merged/);assert.match(migration,/unique\(removed_prospect_id\)/);assert.match(migration,/originalProspectId/);assert.match(migration,/fieldDecisions/);assert.match(page,/Controlled merge/);});
test("Phase 2 adds no discovery, outreach, or conversion behavior",()=>{const source=`${csv}\n${importer}\n${page}`;assert.doesNotMatch(source,/crawlProspect|sendEmail|sendSms|dialProspect|convertToClient|convertToEstimate|openai|anthropic/i);});
