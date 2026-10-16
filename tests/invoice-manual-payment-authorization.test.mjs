import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const permissions=readFileSync("lib/auth/permissions.ts","utf8");
const invoices=readFileSync("components/invoices/InvoicesPage.tsx","utf8");
const payments=readFileSync("lib/services/payments.ts","utf8");
const publicInvoice=readFileSync("components/invoices/PublicInvoicePage.tsx","utf8");
const checkout=readFileSync("app/api/public/invoices/[token]/square-checkout/route.ts","utf8");
const webhook=readFileSync("app/api/webhooks/square/route.ts","utf8");
const squareMigration=readFileSync("supabase/migrations/20260923200258_post_construction_deposit_workflow.sql","utf8");
const migration=readFileSync("supabase/migrations/20261015215053_invoice_overpayments_customer_credits.sql","utf8");

function allocation(total,alreadyApplied,received){const remaining=Math.max(0,total-alreadyApplied);return{applied:Math.min(received,remaining),credit:Math.max(0,received-remaining),balance:Math.max(0,remaining-received)}}

test("authorized administrators use the idempotent payment RPC",()=>{
  assert.match(permissions,/"Master Admin": new Set\(PERMISSIONS\)/);
  assert.match(permissions.slice(permissions.indexOf("const operationalAdmin"),permissions.indexOf("const crewLeadPermissions")),/"invoices\.recordPayment"/);
  assert.match(migration,/actor\.role not in \('Master Admin', 'Administrator'\)/);
  assert.match(migration,/revoke all on function public\.record_invoice_payment\(/);
  assert.match(migration,/grant execute on function public\.record_invoice_payment_v2[\s\S]*to authenticated/);
  assert.match(payments,/rpc\("record_invoice_payment_v2"/);
  assert.match(payments,/p_idempotency_key:input\.idempotency_key/);
  assert.match(invoices,/useState\(\(\)=>crypto\.randomUUID\(\)\)/);
});

test("partial, exact, and excess payments allocate without changing Invoice total",()=>{
  assert.deepEqual(allocation(1000,0,300),{applied:300,credit:0,balance:700});
  assert.deepEqual(allocation(1000,300,700),{applied:700,credit:0,balance:0});
  assert.deepEqual(allocation(300,0,500),{applied:300,credit:200,balance:0});
  assert.match(migration,/applied_amount := least\(normalized_received, remaining_before\)/);
  assert.match(migration,/excess_amount := round\(normalized_received - applied_amount, 2\)/);
  assert.match(migration,/insert into public\.customer_credits/);
  assert.doesNotMatch(migration.match(/update public\.invoices[\s\S]*?where id = invoice_row\.id/)?.[0]??"",/\btotal\s*=/);
});

test("zero and negative tenders fail before ledger writes",()=>{
  const validation=migration.indexOf("normalized_received is null or normalized_received <= 0");
  assert.ok(validation>0);
  assert.ok(validation<migration.indexOf("insert into public.payments"));
  assert.match(migration,/Payment amount must be greater than zero/);
  assert.doesNotMatch(invoices,/Payment exceeds the remaining Invoice balance/);
});

test("invoice lock and unique retry key prevent concurrent or duplicate double recording",()=>{
  assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\('invoice-payment:' \|\| p_idempotency_key::text, 0\)\)/);
  assert.match(migration,/from public\.invoices[\s\S]*where id = p_invoice_id[\s\S]*for update/);
  assert.match(migration,/create unique index payments_idempotency_key_unique/);
  assert.match(migration,/where idempotency_key = p_idempotency_key/);
  assert.match(migration,/return payment_row/);
  assert.match(migration,/already associated with different payment details/);
});

test("credits and their source payments cannot be mutated, voided, reversed, or deleted",()=>{
  assert.match(migration,/create trigger customer_credits_prevent_mutation[\s\S]*before update or delete/);
  assert.match(migration,/create trigger payments_protect_customer_credit_source[\s\S]*before update or delete/);
  assert.match(migration,/cannot be changed, voided, reversed, or deleted/);
  assert.match(migration,/received_amount is null and unapplied_amount = 0/);
});

test("full receipt, applied amount, and customer credit are shown separately",()=>{
  for(const label of ["Full Payment Received","Applied to This Invoice","Unapplied Customer Credit","Customer Credits"])assert.match(invoices,new RegExp(label));
  assert.match(invoices,/not refunded or applied to another Invoice automatically/);
  assert.match(invoices,/recorded_by_name/);
  for(const label of ["Full Payments Received","Applied to Invoice","Unapplied Customer Credit","Remaining Balance","Pay Remaining Balance"])assert.match(publicInvoice,new RegExp(label));
  assert.match(publicInvoice,/invoice\.payments\.reduce\(\(sum, payment\) => sum \+ payment\.received_amount, 0\)/);
  assert.match(publicInvoice,/invoice\.payments\.reduce\(\(sum, payment\) => sum \+ payment\.unapplied_amount, 0\)/);
  assert.match(publicInvoice,/payment\.received_amount/);
  assert.match(publicInvoice,/payment\.unapplied_amount/);
  assert.match(migration,/'received_amount', coalesce\(p\.received_amount, p\.amount\)/);
});

test("reports and Invoice accounting continue to use applied amount only",()=>{
  const revenue=readFileSync("lib/services/revenue.ts","utf8");
  assert.match(revenue,/amount: Number\(x\.amount\)/);
  assert.doesNotMatch(revenue,/received_amount|unapplied_amount/);
  assert.match(migration,/sum\(amount\)[\s\S]*voided_at is null/);
});

test("Square checkout remains balance-limited and webhook-idempotent",()=>{
  assert.match(checkout,/from\("payments"\).*is\("voided_at", null\)/);
  assert.match(checkout,/Number\(invoice\.total\) - amountPaid/);
  assert.match(webhook,/record_square_invoice_payment_v2/);
  const squareV2=squareMigration.match(/create or replace function public\.record_square_invoice_payment_v2\([\s\S]*?create or replace function public\.get_invoice_by_token/)?.[0]??"";
  assert.match(squareV2,/payment_provider = 'Square'[\s\S]*provider_payment_id = p_square_payment_id/);
  assert.match(squareV2,/return jsonb_build_object\('created', false, 'conflict', false/);
});

test("credit and payment records retain actor and timestamp audit fields",()=>{
  assert.match(migration,/recorded_by uuid references public\.user_profiles/);
  assert.match(migration,/recorded_by_name text/);
  assert.match(migration,/created_by uuid references public\.user_profiles/);
  assert.match(migration,/created_at timestamptz not null default now\(\)/);
  assert.match(migration,/revoke all on table public\.customer_credits from public, anon, authenticated/);
});
