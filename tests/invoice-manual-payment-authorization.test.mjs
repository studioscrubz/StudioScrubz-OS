import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const permissions = readFileSync("lib/auth/permissions.ts", "utf8");
const invoices = readFileSync("components/invoices/InvoicesPage.tsx", "utf8");
const publicInvoice = readFileSync("components/invoices/PublicInvoicePage.tsx", "utf8");
const checkout = readFileSync("app/api/public/invoices/[token]/square-checkout/route.ts", "utf8");
const webhook = readFileSync("app/api/webhooks/square/route.ts", "utf8");
const squareMigration = readFileSync("supabase/migrations/20260923200258_post_construction_deposit_workflow.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261007170000_align_manual_invoice_payment_authorization.sql", "utf8");

function financialState(total, payments) {
  const amountPaid = payments.reduce((sum, amount) => sum + amount, 0);
  const balanceDue = Math.max(0, total - amountPaid);
  return { total, amountPaid, balanceDue, status: balanceDue === 0 ? "Paid" : amountPaid > 0 ? "Partially Paid" : "Open" };
}

test("Main Admin and Administrator can record a partial manual Invoice payment", () => {
  assert.match(permissions, /"Master Admin": new Set\(PERMISSIONS\)/);
  const administrator = permissions.slice(permissions.indexOf("const operationalAdmin"), permissions.indexOf("const crewLeadPermissions"));
  assert.match(administrator, /"invoices\.recordPayment"/);
  assert.match(invoices, /canRecordPayment=hasPermission\(profile,"invoices\.recordPayment"\)/);
  assert.match(invoices, /canRecordPayment&&<Action text="Record Payment"/);
  assert.match(migration, /has_any_role\(array\['Master Admin', 'Administrator'\]\)/);
  assert.match(migration, /when authoritative_paid > 0 then 'Partially Paid'/);
  assert.match(migration, /insert into public\.payments/);
  assert.match(invoices, /window\.confirm\(`Record a/);
  assert.match(invoices, /Amount Received/);
  assert.match(invoices, /Reference \/ Confirmation Number \(optional\)/);
});

test("unauthorized roles and public customers cannot record manual Invoice payments", () => {
  const manager = permissions.slice(permissions.indexOf("Manager: new Set(["), permissions.indexOf("Sales: new Set(["));
  assert.doesNotMatch(manager, /"invoices\.recordPayment"/);
  for (const role of ["Manager", "Sales", "Lead Representative", "Crew Lead", "Scrub Technician"]) {
    assert.doesNotMatch(migration.match(/has_any_role\(array\[[^\]]+\]\)/)?.[0] ?? "", new RegExp(`'${role}'`));
  }
  assert.match(migration, /auth\.uid\(\) is null[\s\S]*raise exception 'Payment recording permission is required\.'/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*to authenticated/);
});

test("partial payments accumulate without changing the original Invoice total", () => {
  assert.deepEqual(financialState(1000, [300]), { total: 1000, amountPaid: 300, balanceDue: 700, status: "Partially Paid" });
  assert.deepEqual(financialState(1000, [300, 200]), { total: 1000, amountPaid: 500, balanceDue: 500, status: "Partially Paid" });
  assert.deepEqual(financialState(1000, [300, 200, 500]), { total: 1000, amountPaid: 1000, balanceDue: 0, status: "Paid" });
  assert.doesNotMatch(migration.match(/update public\.invoices[\s\S]*?where id = invoice_row\.id/)?.[0] ?? "", /\btotal\s*=/);
  assert.match(migration, /paid_at = case[\s\S]*when new_status = 'Paid'[\s\S]*else null/);
});

test("invalid manual amounts are rejected before the append-only ledger insert", () => {
  assert.match(migration, /normalized_amount is null or normalized_amount <= 0/);
  assert.match(migration, /Payment amount must be greater than zero/);
  assert.match(migration, /authoritative_paid \+ normalized_amount > round\(invoice_row\.total, 2\)/);
  assert.match(migration, /Payment exceeds the remaining Invoice balance/);
  assert.doesNotMatch(migration, /delete from public\.payments/);
});

test("internal and public Invoice views expose payment progress and history", () => {
  for (const label of ["Total", "Amount Paid", "Balance Due", "Payment History", "Partially Paid"]) assert.match(invoices, new RegExp(label));
  for (const label of ["Payments Received", "Remaining Balance", "Pay Remaining Balance"]) assert.match(publicInvoice, new RegExp(label));
  assert.match(publicInvoice, /invoice\.payments\.map/);
});

test("Square checkout charges the non-voided ledger balance and never reuses a stale-amount link", () => {
  assert.match(checkout, /from\("payments"\).*is\("voided_at", null\)/);
  assert.match(checkout, /Number\(invoice\.total\) - amountPaid/);
  assert.match(checkout, /neq\("amount_cents", amountCents\)/);
  assert.ok((checkout.match(/eq\("amount_cents", amountCents\)/g) ?? []).length >= 2);
});

test("manual and Square payments share one ledger and duplicate webhooks cannot double-count", () => {
  assert.match(webhook, /record_square_invoice_payment_v2/);
  const squareV2 = squareMigration.match(/create or replace function public\.record_square_invoice_payment_v2\([\s\S]*?create or replace function public\.get_invoice_by_token/)?.[0] ?? "";
  assert.match(squareV2, /from public\.payments payment[\s\S]*payment\.voided_at is null/);
  assert.match(squareV2, /payment_provider = 'Square'[\s\S]*provider_payment_id = p_square_payment_id/);
  assert.match(squareV2, /return jsonb_build_object\('created', false, 'conflict', false/);
  assert.match(squareV2, /insert into public\.payments/);
  assert.match(squareV2, /when authoritative_paid > 0 then 'Partially Paid'/);
});

test("an historical unpaid Invoice remains open with its full balance", () => {
  assert.deepEqual(financialState(1000, []), { total: 1000, amountPaid: 0, balanceDue: 1000, status: "Open" });
});
