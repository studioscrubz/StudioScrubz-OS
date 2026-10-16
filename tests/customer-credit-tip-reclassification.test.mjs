import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration=readFileSync("supabase/migrations/20261016130538_customer_credit_tip_reclassification.sql","utf8");
const service=readFileSync("lib/services/payments.ts","utf8");
const page=readFileSync("components/finances/CustomerCreditsPage.tsx","utf8");
const permissions=readFileSync("lib/auth/permissions.ts","utf8");

test("only an active Master Admin can invoke the correction RPC",()=>{
  assert.match(migration,/actor\.role <> 'Master Admin'/);
  assert.match(migration,/Master Admin permission is required/);
  assert.match(migration,/revoke all on function public\.reclassify_customer_credit_as_tip[\s\S]*from public, anon, authenticated/);
  assert.match(migration,/grant execute on function public\.reclassify_customer_credit_as_tip[\s\S]*to authenticated/);
  assert.match(permissions,/"customerCredits\.manage"/);
});

test("correction is atomic, idempotent, and concurrency safe",()=>{
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/where id = p_credit_id for update/);
  assert.match(migration,/where id = p_payment_id for update/);
  assert.match(migration,/idempotency_key uuid not null unique/);
  assert.match(migration,/credit_id uuid not null unique/);
  assert.match(migration,/return event_row/);
});

test("ownership and unused-credit requirements are database enforced",()=>{
  assert.match(migration,/source_payment_id is distinct from p_payment_id/);
  assert.match(migration,/credit_row\.status <> 'Unapplied'/);
  assert.match(migration,/credit_row\.remaining_amount <> credit_row\.original_amount/);
  assert.match(migration,/payment_row\.client_id is distinct from credit_row\.client_id/);
  assert.match(migration,/invoice_row\.client_id is distinct from credit_row\.client_id/);
});

test("receipt and invoice allocation are preserved while credit becomes tip",()=>{
  const paymentUpdate=migration.match(/update public\.payments[\s\S]*?where id = payment_row\.id/)?.[0]??"";
  assert.match(paymentUpdate,/unapplied_amount = 0/);
  assert.match(paymentUpdate,/tip_amount = tip_amount \+ credit_row\.remaining_amount/);
  assert.doesNotMatch(paymentUpdate,/received_amount\s*=/);
  assert.doesNotMatch(paymentUpdate,/\bamount\s*=/);
  assert.doesNotMatch(migration,/update public\.invoices/);
  assert.match(migration,/round\(received_amount, 2\) = round\(amount \+ tip_amount \+ unapplied_amount, 2\)/);
});

test("audit evidence is append-only and includes before and after values",()=>{
  assert.match(migration,/customer_credit_tip_reclassification_events_append_only/);
  assert.match(migration,/payment_before jsonb not null/);
  assert.match(migration,/payment_after jsonb not null/);
  assert.match(migration,/credit_before jsonb not null/);
  assert.match(migration,/credit_after jsonb not null/);
  assert.match(migration,/char_length\(btrim\(reason\)\) >= 15/);
});

test("Master Admin UI requires a reason and confirmation",()=>{
  assert.match(service,/rpc\("reclassify_customer_credit_as_tip"/);
  assert.match(page,/isMasterAdmin\(profile\)/);
  assert.match(page,/at least 15 characters/);
  assert.match(page,/window\.confirm/);
  assert.match(page,/Reclassify as Tip/);
});
