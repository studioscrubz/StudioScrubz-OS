import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261002160000_lead_representative_weekly_payouts_phase_3.sql", "utf8");
const phase2 = readFileSync("supabase/migrations/20261002151500_lead_representative_commission_ledger_phase_2.sql", "utf8");
const permissions = readFileSync("lib/auth/permissions.ts", "utf8");
const service = readFileSync("lib/services/leadRepresentative.ts", "utf8");
const portal = readFileSync("components/lead-rep/LeadRepresentativePortal.tsx", "utf8");
const management = readFileSync("components/lead-rep/LeadCommissionPayoutManagementPage.tsx", "utf8");

test("1-4: Friday-through-Thursday periods use the authoritative business timezone and earned_at", () => {
  assert.match(migration, /private\.lead_commission_business_timezone/);
  assert.match(migration, /extract\(isodow from p_period_end\) <> 4/);
  assert.match(migration, /period_start_date := p_period_end - 6/);
  assert.match(migration, /period_start_date::timestamp at time zone timezone_name/);
  assert.match(migration, /\(p_period_end \+ 1\)::timestamp at time zone timezone_name/);
  assert.match(migration, /entry\.earned_at<end_exclusive_at/);
  assert.doesNotMatch(migration, /entry\.created_at\s*<\s*end_exclusive_at/);
});

test("5-11: generation is closed-period, admin-only, idempotent, and concurrency safe", () => {
  assert.match(migration, /Only a closed payout period can be generated/);
  assert.match(migration, /current_user_role\(\) in \('Master Admin','Administrator'\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('lead-payout-period:/);
  assert.match(migration, /lead_commission_one_active_batch_per_period/);
  assert.match(migration, /unique\(lead_representative_id, period_end, generation_revision\)/);
  assert.match(migration, /if found then return next batch_id; continue; end if/);
  for (const denied of ["Manager", "Lead Representative", "Sales", "Crew Lead", "Scrub Technician"]) {
    assert.doesNotMatch(migration.match(/create function private\.is_lead_commission_payout_admin[\s\S]*?\$\$;/)?.[0] ?? "", new RegExp(`'${denied}'`));
  }
});

test("12-20: ledger, reversals, adjustments, no-minimum payout, and carry-forward are consumed once", () => {
  assert.match(migration, /COMMISSION_LEDGER/);
  assert.match(migration, /entry\.commission_amount/);
  assert.match(migration, /PAYOUT_ADJUSTMENT/);
  assert.match(migration, /greatest\(accounting_total_value,0\)/);
  assert.match(migration, /least\(accounting_total_value,0\)/);
  assert.match(migration, /NEGATIVE_CARRY_FORWARD/);
  assert.match(migration, /lead_commission_ledger_consumed_once/);
  assert.match(migration, /lead_commission_adjustment_consumed_once/);
  assert.match(migration, /lead_commission_carry_consumed_once/);
  assert.doesNotMatch(migration, /minimum payout|minimum_payout/i);
});

test("21-28: holds and releases are explicit, append-only, visible, and cannot alter approved history", () => {
  assert.match(migration, /create table public\.lead_commission_hold_events/);
  assert.match(migration, /event_type in \('HOLD','RELEASE'\)/);
  assert.match(migration, /A hold reason is required/);
  assert.match(migration, /private\.lead_commission_entry_is_held/);
  assert.match(migration, /not private\.lead_commission_entry_is_held\(entry\.id\)/);
  assert.match(migration, /lead_commission_hold_events_immutable/);
  assert.match(migration, /A finalized payout entry cannot be held/);
  assert.match(migration, /then 'Held' else 'Pending Weekly Payout'/);
});

test("29-35: approval is admin-only and permanently snapshots and locks membership and totals", () => {
  assert.match(migration, /public\.approve_lead_commission_payout_batch/);
  assert.match(migration, /lead_commission_payout_approvals_immutable/);
  assert.match(migration, /lead_commission_payout_items_immutable/);
  assert.match(migration, /Approved payout batches are immutable/);
  assert.match(migration, /gross_positive_amount_snapshot/);
  assert.match(migration, /payout_amount_snapshot/);
  assert.match(migration, /insert into public\.lead_commission_payout_consumptions/);
});

test("36-51: manual payment accepts exactly the approved methods and is immutable/idempotent", () => {
  const payment = migration.match(/create function public\.mark_lead_commission_payout_paid[\s\S]*?end;\n\$\$;/)?.[0] ?? "";
  for (const method of ["Apple Pay","Zelle","Venmo","Cash App","Chime","Debit Card","Other"]) assert.match(payment, new RegExp(`'${method.replace(" ", "\\s")}'`.replace("\\s", " ")));
  for (const rejected of ["ACH", "Bank Transfer", "Cash'", "Check"]) assert.doesNotMatch(payment, new RegExp(`'${rejected}`));
  assert.match(payment, /Actual payment date is required/);
  assert.match(payment, /Payment method is not allowed/);
  assert.match(payment, /Other payment method requires a description/);
  assert.match(payment, /Only an approved payout batch can be marked paid/);
  assert.match(payment, /on conflict\(batch_id\) do nothing/);
  assert.match(migration, /lead_commission_payout_payments_immutable/);
  assert.match(migration, /confirmation_reference text/);
  assert.doesNotMatch(migration, /automatic transfer|payment provider|stripe connect/i);
});

test("52-56: adjustments are separate, append-only, attributed, reasoned, and single-consumption", () => {
  assert.match(migration, /create table public\.lead_commission_payout_adjustments/);
  assert.match(migration, /amount <> 0/);
  assert.match(migration, /An adjustment reason is required/);
  assert.match(migration, /lead_representative_id uuid not null/);
  assert.match(migration, /lead_commission_payout_adjustments_immutable/);
  assert.doesNotMatch(migration.match(/create function public\.create_lead_commission_payout_adjustment[\s\S]*?\$\$;/)?.[0] ?? "", /update public\.lead_commission_ledger/);
});

test("57-64: representative projection derives identity, exposes own safe lifecycle, and accepts no representative id", () => {
  const mine = migration.match(/create function public\.get_my_lead_representative_payouts\(\)[\s\S]*?end;\n\$\$;/)?.[0] ?? "";
  assert.match(mine, /public\.is_current_lead_representative_eligible\(\)/);
  assert.match(mine, /representative_id:=public\.current_employee_id\(\)/);
  assert.match(mine, /entry\.lead_representative_id=representative_id/);
  assert.match(mine, /batch\.lead_representative_id=representative_id/);
  assert.match(mine, /Pending Weekly Payout/);
  assert.match(mine, /Awaiting Approval/);
  assert.match(mine, /Approved \/ Awaiting Payment/);
  assert.match(mine, /Paid/);
  assert.doesNotMatch(mine, /p_lead_representative_id|invoice|revenue|margin|payroll/i);
  assert.match(service, /rpc\("get_my_lead_representative_payouts", \{\}\)/);
});

test("65-68: database constraints preserve single consumption and historical snapshots", () => {
  assert.match(migration, /unique index lead_commission_ledger_consumed_once/);
  assert.match(migration, /unique index lead_commission_carry_consumed_once/);
  assert.match(migration, /representative_name_snapshot/);
  assert.match(migration, /description_snapshot/);
  assert.match(migration, /source_snapshot jsonb not null/);
  assert.match(migration, /before update or delete on public\.lead_commission_payout_payments/);
});

test("69-75: Phase 2 and unrelated access contracts remain intact", () => {
  assert.match(phase2, /NEW_CUSTOMER_LEAD/);
  assert.match(phase2, /GENERATE_PERSONALLY_CLOSE/);
  assert.match(phase2, /RECURRING_CONVERSION_BONUS/);
  assert.match(permissions, /leadRep\.payouts\.manage/);
  assert.match(permissions, /Administrator: new Set\(operationalAdmin\)/);
  assert.match(portal, /getMyLeadRepresentativePayouts/);
  assert.match(portal, /Pending amounts are not finalized payouts/);
  assert.match(management, /Generate Weekly Payouts/);
  assert.match(management, /methods = \["Apple Pay", "Zelle", "Venmo", "Cash App", "Chime", "Debit Card", "Other"\]/);
  assert.doesNotMatch(migration, /prospect/i);
});

test("all payout tables use RLS and deny direct authenticated access", () => {
  for (const table of ["lead_commission_hold_events","lead_commission_payout_adjustments","lead_commission_payout_batches","lead_commission_payout_items","lead_commission_payout_approvals","lead_commission_payout_consumptions","lead_commission_payout_payments"]) {
    assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /revoke all on table[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete) on table[\s\S]*to authenticated/i);
});
