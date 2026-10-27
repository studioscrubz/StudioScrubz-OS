import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const sql = readFileSync("supabase/migrations/20261027205000_fix_completed_job_addon_invoice_repair.sql","utf8");

test("invoice RPC must treat add-on JSON text as text before SQL concatenation", () => {
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.create_completed_job_invoice\(p_job_id uuid\)/);
  assert.match(sql,/SECURITY DEFINER/);
  assert.match(sql,/auth\.uid\(\) is null/);
  assert.match(sql,/caller_role.*'Master Admin'/);
  assert.match(sql,/not public\.is_valid_job_pricing_snapshot/);
  assert.match(sql,/public\.is_job_financially_handed_off/);
  assert.match(sql,/\|\|\(snapshot_addon->>'label'\)\|\|/);
  assert.match(sql,/\|\|\(snapshot_addon->>'unitName'\)\|\|/);
  assert.doesNotMatch(sql,/\|\|snapshot_addon->>'label'\|\|/);
});

test("historical invoice backfill is one-job-only, checks all financial safeguards, and never emails clients", () => {
  assert.match(sql,/bb33159b-0bb6-4082-bdb8-f0e2942365cc/);
  assert.match(sql,/FOR UPDATE/);
  assert.match(sql,/EXISTS\(SELECT 1 FROM public\.invoices i WHERE i\.job_id=j\.id\)/);
  assert.match(sql,/EXISTS\(SELECT 1 FROM public\.invoice_job_lines l WHERE l\.job_id=j\.id\)/);
  assert.match(sql,/j\.status IS DISTINCT FROM 'Completed'/);
  assert.match(sql,/j\.service_occurrence_id IS NOT NULL/);
  assert.match(sql,/j\.proposal_id IS NOT NULL/);
  assert.match(sql,/public\.is_valid_job_pricing_snapshot\(j\.pricing_snapshot,j\.price\)/);
  assert.match(sql,/sum\(\(x->>'amount'\)::numeric\)/);
  assert.match(sql,/j\.price,0,0,j\.price,0,j\.price/);
  assert.match(sql,/'Open',issue_on/);
  assert.doesNotMatch(sql,/INSERT INTO public\.payments/);
  assert.doesNotMatch(sql,/UPDATE public\.jobs /);
  assert.doesNotMatch(sql,/PERFORM.*send|email.*send|send.*email/i);
});
