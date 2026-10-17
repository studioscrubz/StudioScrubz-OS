import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const route = read("app/api/communications/employee-email/route.ts");
const page = read("components/communications/EmployeeEmailPage.tsx");
const migration = read("supabase/migrations/20261017162512_employee_email_communications.sql");
const permissions = read("lib/auth/permissions.ts");
const sidebar = read("components/layout/Sidebar.tsx");

test("employee email is restricted to active Master Admin and Administrator users", () => {
  assert.match(route, /AUTHORIZED_ROLES = new Set\(\["Master Admin", "Administrator"\]\)/);
  assert.match(route, /!profile\?\.is_active \|\| !AUTHORIZED_ROLES\.has\(profile\.role\)/);
  assert.match(permissions, /operationalAdmin[\s\S]*"employeeEmails\.send"/);
  assert.match(sidebar, /Employee Email[\s\S]*employeeEmails\.send/);
});

test("server resolves active employee recipients without trusting browser email addresses", () => {
  assert.match(route, /from\("employees"\)[\s\S]*\.eq\("employment_status", "Active"\)\.is\("archived_at", null\)/);
  assert.match(route, /selection\.mode === "department" \? query\.eq\("department", selection\.department\) : query\.in\("id", selection\.employeeIds\)/);
  assert.doesNotMatch(route, /body\.recipientEmail|input\.recipientEmail/);
  assert.match(route, /EMAIL_PATTERN\.test\(email\)/);
  assert.match(page, /unavailable - not included/i);
});

test("bulk preview lists recipients and requires explicit confirmation", () => {
  assert.match(page, /Preview recipients/);
  assert.match(page, /recipient\.name[\s\S]*recipient\.email[\s\S]*recipient\.department/);
  assert.match(page, /bulkConfirmed/);
  assert.match(route, /preview\.recipientCount > 1 && body\.confirmed !== true/);
});

test("each recipient has a private idempotent provider submission", () => {
  assert.match(route, /employee-email:\$\{profile\.id\}:\$\{requestId\}:\$\{recipient\.employeeId\}/);
  assert.match(route, /recipientEmail: delivery\.recipient_email/);
  assert.doesNotMatch(route, /\bcc\s*:|\bbcc\s*:/i);
  assert.match(migration, /unique \(request_id, employee_id\)/);
  assert.match(migration, /event_key text not null unique/);
  assert.match(route, /provider_submission_started_at[\s\S]*\.is\("provider_submission_started_at", null\)/);
});

test("provider acceptance is durable and never presented as inbox delivery", () => {
  assert.match(migration, /create table public\.employee_email_provider_submissions/);
  assert.match(migration, /provider acceptance receipts are append-only/i);
  assert.match(route, /sendResendEmail\([\s\S]*from\("employee_email_provider_submissions"\)\.insert[\s\S]*providerReceipt\(admin, delivery\.id\)[\s\S]*return finalizeAccepted/);
  assert.match(page, /Accepted means the email provider accepted the submission; it does not confirm inbox delivery\./);
  for (const status of ["Accepted", "Failed", "Pending"]) assert.match(page, new RegExp(status));
});

test("partial failures remain per-recipient and preserve successful recipients", () => {
  assert.match(route, /Promise\.all\(deliveries\.slice\(index, index \+ 5\)\.map\(\(delivery\) => deliverOne/);
  assert.match(route, /accepted: results\.filter/);
  assert.match(route, /failed: results\.filter/);
  assert.match(route, /pending: results\.filter/);
  assert.match(route, /status: "Failed", failed_at:/);
});

test("delivery history is server-only and immutable in identity and content", () => {
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on table public\.employee_email_deliveries from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update on table public\.employee_email_deliveries to service_role/);
  for (const field of ["employee_id", "recipient_email", "subject", "message_body", "sender_id"]) assert.match(migration, new RegExp(`new\\.${field} is distinct from old\\.${field}`));
});

test("employee emails reuse the shared Resend branding and general sender profile", () => {
  assert.match(route, /sendResendEmail/);
  assert.match(route, /resolveEmailSenderProfile\("general"\)/);
  assert.match(route, /text: delivery\.message_body/);
  assert.match(route, /html: `<div style="white-space:pre-wrap">/);
});
