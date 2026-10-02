import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authTypes = readFileSync("types/auth.ts", "utf8");
const permissions = readFileSync("lib/auth/permissions.ts", "utf8");
const authService = readFileSync("lib/services/auth.ts", "utf8");
const authProvider = readFileSync("components/auth/AuthProvider.tsx", "utf8");
const login = readFileSync("components/auth/LoginPage.tsx", "utf8");
const sidebar = readFileSync("components/layout/Sidebar.tsx", "utf8");
const portal = readFileSync("components/lead-rep/LeadRepresentativePortal.tsx", "utf8");
const portalService = readFileSync("lib/services/leadRepresentative.ts", "utf8");
const attribution = readFileSync("supabase/migrations/20260912020000_lead_representative_attribution.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261002141026_lead_representative_portal_phase_1.sql", "utf8");

const roles = authTypes.match(/USER_ROLES = \[(.*?)\] as const/s)?.[1] ?? "";
const leadRepPermissions = permissions.slice(
  permissions.indexOf('"Lead Representative": new Set'),
  permissions.indexOf('"Crew Lead": new Set'),
);

test("Lead Representative becomes a valid role without removing existing roles", () => {
  for (const role of ["Master Admin", "Administrator", "Manager", "Sales", "Lead Representative", "Crew Lead", "Scrub Technician"]) {
    assert.match(roles, new RegExp(`"${role}"`));
  }
  assert.match(migration, /user_profiles_role_check[\s\S]*'Lead Representative'/);
  assert.match(migration, /p_role not in \('Master Admin','Administrator','Manager','Sales','Lead Representative','Crew Lead','Scrub Technician'\)/);
});

test("active Lead Representative profiles require an eligible linked employee", () => {
  assert.match(migration, /new\.role = 'Lead Representative' and new\.is_active/);
  assert.match(migration, /new\.employee_id is null/);
  assert.match(migration, /employee\.department = 'Lead Representative'/);
  assert.match(migration, /employee\.employment_status = 'Active'/);
  assert.match(migration, /employee\.archived_at is null/);
  assert.match(authService, /profile\?\.role === "Lead Representative"/);
  assert.match(authService, /is_current_lead_representative_eligible/);
});

test("Lead Representative login and root navigation route to the dedicated portal", () => {
  assert.match(login, /result\.profile\.role === "Lead Representative" \? "\/lead-rep" : "\/"/);
  assert.match(authProvider, /auth\.profile\?\.role === "Lead Representative" && pathname === "\/"/);
  assert.match(authProvider, /router\.replace\("\/lead-rep"\)/);
  assert.match(permissions, /\["\/lead-rep", "leadRep\.portal"\]/);
});

test("other roles retain the existing root landing fallback", () => {
  assert.match(login, /Lead Representative" \? "\/lead-rep" : "\/"/);
  assert.match(login, /router\.replace\(auth\.profile\.role === "Lead Representative" \? "\/lead-rep" : "\/"\)/);
});

test("Lead Representative receives only portal, own leads, and own commissions permissions", () => {
  assert.match(leadRepPermissions, /"leadRep\.portal"/);
  assert.match(leadRepPermissions, /"leadRep\.leads\.viewOwn"/);
  assert.match(leadRepPermissions, /"leadRep\.commissions\.viewOwn"/);
  for (const denied of ["dashboard.view", "clients.view", "estimates.view", "proposals.view", "jobs.view", "schedule.view", "agreements.view", "invoices.view", "finances.view", "payrollPrep.view", "prospects.view", "employees.view", "users.manage"]) {
    assert.doesNotMatch(leadRepPermissions, new RegExp(denied.replace(".", "\\.")));
  }
  assert.match(sidebar, /label: "Home"[\s\S]*?href: "\/lead-rep"[\s\S]*?permission: "leadRep\.portal"/);
  assert.match(sidebar, /label: "My Leads"[\s\S]*?href: "\/lead-rep\/leads"[\s\S]*?permission: "leadRep\.leads\.viewOwn"/);
  assert.match(sidebar, /label: "Commissions"[\s\S]*?href: "\/lead-rep\/commissions"[\s\S]*?permission: "leadRep\.commissions\.viewOwn"/);
  assert.match(permissions, /\["leadRep\.portal", "leadRep\.leads\.viewOwn", "leadRep\.commissions\.viewOwn"\]\.includes\(permission\)[\s\S]*profile\.role === "Lead Representative"/);
});

test("own-leads RPC derives identity and cannot accept another representative id", () => {
  assert.match(migration, /function public\.get_my_lead_representative_leads\(\)/);
  assert.match(migration, /representative_id := public\.current_employee_id\(\)/);
  assert.match(migration, /estimate\.lead_representative_id = representative_id/);
  assert.match(migration, /j\.lead_representative_id = representative_id/);
  assert.doesNotMatch(migration, /get_my_lead_representative_leads\([^)]*p_lead_representative_id/);
  assert.match(portalService, /rpc\("get_my_lead_representative_leads", \{\}\)/);
});

test("portal projection returns attributed contact details but no unrelated or financial data", () => {
  assert.match(migration, /estimate\.customer_phone/);
  assert.match(migration, /estimate\.customer_email/);
  assert.match(migration, /left join public\.clients client on client\.id = estimate\.client_id/);
  assert.match(migration, /where estimate\.lead_representative_id = representative_id/);
  for (const forbidden of ["invoice.total", "invoice.amount_paid", "invoice.balance_due", "job.price", "commission", "revenue", "payroll"]) {
    assert.doesNotMatch(migration, new RegExp(forbidden.replace(".", "\\."), "i"));
  }
});

test("lifecycle derives only from authoritative records and does not infer Contacted or Duplicate", () => {
  for (const evidence of [
    "estimate.status = 'Declined'",
    "proposal.status = 'Declined'",
    "jobs.cancelled",
    "jobs.completed and financial.paid",
    "proposal.accepted and proposal.accepted_at is not null",
    "proposal.status in ('Sent','Viewed')",
    "walkthrough.id is not null",
  ]) assert.match(migration, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(migration, /'Contacted'|'Duplicate'/);
  assert.match(portal, /Active Leads/);
  assert.match(portal, /Booked Leads/);
  assert.match(portal, /Completed \/ Paid/);
});

test("attribution changes are append-only and inheritance remains intact", () => {
  assert.match(migration, /create table public\.estimate_lead_representative_attribution_events/);
  assert.match(migration, /after insert or update of lead_representative_id/);
  assert.match(migration, /revoke all on table public\.estimate_lead_representative_attribution_events/);
  assert.doesNotMatch(migration, /update public\.estimate_lead_representative_attribution_events|delete from public\.estimate_lead_representative_attribution_events/i);
  assert.match(attribution, /create trigger proposals_lead_representative[\s\S]*public\.inherit_lead_representative\(\)/);
  assert.match(attribution, /create trigger jobs_lead_representative[\s\S]*public\.inherit_lead_representative\(\)/);
});

test("management access remains explicit while Lead Representative gets no direct business-table grants", () => {
  assert.match(migration, /has_any_role\(array\['Master Admin','Administrator','Manager','Sales'\]\)/);
  assert.match(migration, /grant execute on function public\.get_my_lead_representative_leads\(\)[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete)[^;]*on (?:public\.)?(?:clients|estimates|proposals|jobs|invoices|payments)[^;]*to authenticated/i);
  assert.doesNotMatch(migration, /Phase 2|payout|commission_amount|commission_rate/i);
});
