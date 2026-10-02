import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261002151500_lead_representative_commission_ledger_phase_2.sql", "utf8");
const permissions = readFileSync("lib/auth/permissions.ts", "utf8");
const sidebar = readFileSync("components/layout/Sidebar.tsx", "utf8");
const service = readFileSync("lib/services/leadRepresentative.ts", "utf8");
const portal = readFileSync("components/lead-rep/LeadRepresentativePortal.tsx", "utf8");

test("policy is effective prospectively and snapshots the approved fixed amounts", () => {
  assert.match(migration, /effective_at[\s\S]*transaction_timestamp\(\)/);
  assert.match(migration, /'LEAD_REP_2026_10_02'[\s\S]*25\.00[\s\S]*40\.00[\s\S]*25\.00/);
  assert.doesNotMatch(migration, /employees\.commission_rate|commission_rate/);
  assert.doesNotMatch(migration, /insert into public\.lead_commission_ledger[\s\S]*select[\s\S]*from public\.jobs[\s\S]*where.*completed/i);
});

test("customer origin and cleaning ordinals are immutable and limited to one and two", () => {
  assert.match(migration, /client_id uuid not null unique/);
  assert.match(migration, /cleaning_ordinal smallint not null check \(cleaning_ordinal in \(1,2\)\)/);
  assert.match(migration, /unique\(customer_origin_id, cleaning_ordinal\)/);
  assert.match(migration, /jobs_process_lead_commission_completion/);
  assert.match(migration, /new\.status = 'Completed'/);
  assert.match(migration, /old\.status is distinct from 'Completed'/);
  assert.match(migration, /agreement_row\.status not in \('Accepted','Active'\)/);
  assert.match(migration, /agreement_row\.frequency = 'One-Time'/);
  assert.match(migration, /proposal\.estimate_id = origin\.estimate_id/);
  assert.match(migration, /else return; end if;/);
  assert.match(migration, /lead_commission_cleanings_immutable/);
});

test("cancelled and incomplete jobs cannot qualify and later timing cannot reorder qualifications", () => {
  assert.match(migration, /job_row\.status <> 'Completed'/);
  assert.match(migration, /job_row\.completed_at is null/);
  assert.match(migration, /job_row\.archived_at is not null/);
  assert.match(migration, /completed_at_snapshot timestamptz not null/);
  assert.match(migration, /before update or delete on public\.lead_commission_cleaning_qualifications/);
});

test("100 percent collection is required and tips, tax, and uncollected discounts are excluded", () => {
  assert.match(migration, /if collected >= q\.eligible_service_amount then/);
  assert.match(migration, /jobs\.price less proposal\.result\.taxes/);
  assert.match(migration, /payment_row\.amount/);
  assert.match(migration, /tipsExcluded', true/);
  assert.match(migration, /taxExcluded', true/);
  assert.doesNotMatch(migration, /tip_amount[\s\S]*eligible_service_collection/);
});

test("payment-first, completion-first, partial, and repeated processing are idempotent", () => {
  assert.match(migration, /payments_process_lead_commission/);
  assert.match(migration, /jobs_process_lead_commission_completion/);
  assert.match(migration, /on conflict \(cleaning_qualification_id, payment_id, source_type\) do nothing/);
  assert.match(migration, /lead_commission_one_initial_per_origin/);
  assert.match(migration, /lead_commission_one_recurring_bonus_per_origin/);
  assert.match(migration, /perform pg_advisory_xact_lock/);
});

test("deposits permanently map to Cleaning 1 and do not earn before completion", () => {
  assert.match(migration, /q\.cleaning_ordinal = 1/);
  assert.match(migration, /requirement\.proposal_id = q\.proposal_id/);
  assert.match(migration, /'PROPOSAL_DEPOSIT_TO_CLEANING_1'/);
  assert.match(migration, /'permanentCleaningOrdinal', 1/);
  assert.match(migration, /source_type = 'DEPOSIT' and payment\.invoice_id is not null/);
});

test("consolidated invoice payments use deterministic cent-safe proportional allocation", () => {
  assert.match(migration, /CONSOLIDATED_PROPORTIONAL_TRUNCATED_CENTS/);
  assert.match(migration, /trunc\(payment_row\.amount \* amount \/ nullif\(total_amount, 0\), 2\)/);
  assert.match(migration, /row_number\(\) over \(order by job_id\)/);
  assert.match(migration, /remainder_rank <= remainder_cents/);
  assert.match(migration, /least\(amount, base_amount/);
});

test("personally-close requires management authorization and accepted booking proof", () => {
  assert.match(migration, /public\.authorize_lead_personally_close/);
  assert.match(migration, /public\.confirm_lead_personally_closed/);
  assert.match(migration, /has_any_role\(array\['Master Admin','Administrator','Manager'\]\)/);
  assert.match(migration, /event_type = 'AUTHORIZED'/);
  assert.match(migration, /event_type = 'BOOKING_QUALIFIED'/);
  assert.match(migration, /accepted and accepted_at is not null and status = 'Accepted'/);
  assert.match(migration, /booking_event\.created_at >= authorization_event\.created_at/);
  assert.match(migration, /authorization_record public\.lead_personally_close_events/);
  assert.doesNotMatch(migration, /declare[\s\S]*?\bauthorization public\.lead_personally_close_events/);
  assert.match(migration, /commission_type := 'GENERATE_PERSONALLY_CLOSE'; commission_value := policy\.personally_close_amount/);
  assert.match(migration, /else commission_type := 'NEW_CUSTOMER_LEAD'/);
});

test("initial commission is exclusive, recurring bonus is separate, and no residual event exists", () => {
  assert.match(migration, /where event_type in \('NEW_CUSTOMER_LEAD','GENERATE_PERSONALLY_CLOSE'\)/);
  assert.match(migration, /where event_type = 'RECURRING_CONVERSION_BONUS'/);
  assert.doesNotMatch(migration, /RESIDUAL|cleaning_ordinal in \(1,2,3/);
});

test("earned ledger and supporting evidence are append-only", () => {
  for (const table of [
    "lead_commission_policies", "lead_commission_customer_origins",
    "lead_personally_close_events", "lead_commission_cleaning_qualifications",
    "lead_commission_payment_allocations", "lead_commission_ledger",
  ]) assert.match(migration, new RegExp(`before update or delete on public\\.${table}`));
  assert.match(migration, /source_event jsonb not null/);
  assert.match(migration, /payout_status text not null default 'EARNED_UNPAID'/);
});

test("authoritative voids create append-only negative reversals without inventing refunds", () => {
  assert.match(migration, /event_type = 'REVERSAL' and commission_amount < 0/);
  assert.match(migration, /-prior\.commission_amount/);
  assert.match(migration, /Authoritative payment void reduced collection below 100%/);
  assert.match(migration, /lead_commission_one_reversal_per_entry/);
  assert.doesNotMatch(migration, /chargeback|refund_provider|create_refund/i);
});

test("RLS and grants deny direct authenticated ledger access", () => {
  assert.match(migration, /alter table public\.lead_commission_ledger enable row level security/);
  assert.match(migration, /revoke all on table[\s\S]*lead_commission_ledger[\s\S]*from public, anon, authenticated/);
  const directGrants = [...migration.matchAll(/grant select on table ([\s\S]*?)\nto ([^;]+);/g)];
  assert.equal(directGrants.some(([, tables, role]) => tables.includes("lead_commission_ledger") && role.includes("authenticated")), false);
});

test("my commissions derives identity from auth and accepts no representative id", () => {
  assert.match(migration, /function public\.get_my_lead_representative_commissions\(\)/);
  assert.match(migration, /public\.is_current_lead_representative_eligible\(\)/);
  assert.match(migration, /representative_id := public\.current_employee_id\(\)/);
  assert.match(migration, /entry\.lead_representative_id = representative_id/);
  assert.doesNotMatch(migration, /get_my_lead_representative_commissions\([^)]*representative/);
  assert.match(service, /rpc\("get_my_lead_representative_commissions", \{\}\)/);
});

test("only management has oversight while Sales and field roles remain excluded", () => {
  const oversight = migration.match(/create function public\.get_lead_commission_oversight\(\)[\s\S]*?end;\n\$\$;/)?.[0] ?? "";
  assert.match(oversight, /Master Admin','Administrator','Manager/);
  assert.doesNotMatch(oversight, /Sales|Crew Lead|Scrub Technician/);
  assert.match(migration, /revoke all on function public\.get_my_lead_representative_commissions\(\)/);
});

test("portal exposes only the representative commission projection", () => {
  assert.match(permissions, /leadRep\.commissions\.viewOwn/);
  assert.match(sidebar, /href: "\/lead-rep\/commissions"/);
  assert.match(portal, /getMyLeadRepresentativeCommissions/);
  assert.match(portal, /weekly payout history/i);
  assert.doesNotMatch(portal, /company-wide|margin|payroll/i);
});

test("Phase 1, Sales Schedule, and Manager walkthrough contracts remain untouched", () => {
  assert.match(service, /get_my_lead_representative_leads/);
  assert.match(permissions, /"schedule\.view"/);
  const managerMigration = readFileSync("supabase/migrations/20261002143446_manager_scrub_technician_walkthrough_permissions.sql", "utf8");
  assert.match(managerMigration, /public\.current_user_role\(\) not in \('Manager', 'Crew Lead'\)/);
});
