import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/communications/email/send/route.ts", import.meta.url), "utf8");
const modal = await readFile(new URL("../components/communications/LogCommunicationModal.tsx", import.meta.url), "utf8");
const service = await readFile(new URL("../lib/services/communicationsEmail.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261005160000_communications_resend_delivery_invariant.sql", import.meta.url), "utf8");
const recoveryMigration = await readFile(new URL("../supabase/migrations/20261005204522_communications_email_provider_submission_recovery.sql", import.meta.url), "utf8");

test("Email uses the authenticated provider route while SMS keeps device handoff", () => {
  assert.match(modal, /sendCommunicationsEmail\(/);
  assert.doesNotMatch(modal, /openDeviceEmailApp/);
  assert.match(service, /fetch\("\/api\/communications\/email\/send"/);
  assert.match(modal, /openDeviceSmsApp\(phone, message\)/);
  assert.match(modal, /confirmSms\("Sent"\)/);
});

test("provider-backed outbound Email cannot be manually logged or marked Sent", () => {
  assert.match(modal, /channel === "Email" && direction === "Outbound"/);
  assert.match(modal, /Use Send Email for outbound email delivery/);
  assert.match(modal, /!\(channel === "Email" && direction === "Outbound"\).*<><option>Sent<\/option><option>Failed<\/option>/);
  assert.match(modal, /preparedSms\?\.status === "Prepared"/);
});

test("route authenticates and enforces active Communications permission", () => {
  assert.match(route, /if \(!auth\.user\).*status: 401/);
  assert.match(route, /!profile\?\.is_active.*status: 403/);
  assert.match(route, /hasPermission\(profile, "communications\.create"\).*status: 403/);
});

test("route resolves sender identity server-side without accepting browser sender input", () => {
  assert.match(route, /resolveEmailSenderProfile\(await senderProfileForCommunication/);
  assert.match(route, /return "general"/);
  assert.doesNotMatch(service, /\bfrom\s*:|senderProfile/i);
});

test("route validates recipient and linked records", () => {
  assert.match(route, /EMAIL_PATTERN\.test\(recipientEmail\)/);
  assert.match(route, /eq\("client_id", links\.clientId\)/);
  assert.match(route, /data\.client_id !== links\.clientId/);
  assert.match(route, /data\.property_id !== links\.propertyId/);
});

test("route prepares once, sends with the event key, and finalizes only with a provider ID", () => {
  assert.match(route, /status: "Prepared" as const/);
  assert.match(route, /provider: "resend"/);
  assert.match(route, /event_key: eventKey/);
  assert.match(route, /sendResendEmail\([\s\S]*idempotencyKey: eventKey/);
  assert.match(route, /if \(!sent\.id\?\.trim\(\)\) throw/);
  assert.match(route, /providerMessageId = sent\.id\.trim\(\)/);
  assert.match(route, /persistProviderSubmission\(admin, communicationId, eventKey, providerMessageId\)/);
  assert.match(route, /finalize\(admin, communicationId, providerMessageId, null\)/);
  assert.match(route, /provider_message_id: sent \? providerMessageId!\.trim\(\) : null/);
});

test("duplicate, concurrent, and retry calls preserve one row and provider identity", () => {
  assert.match(route, /communications-email:\$\{profile\.id\}:\$\{requestId\}/);
  assert.match(route, /\.eq\("event_key", eventKey\)\.maybeSingle\(\)/);
  assert.match(route, /createError\?\.code === "23505"/);
  assert.match(route, /assertSameRequest/);
  assert.match(route, /communication\.status === "Sent" && communication\.provider_message_id/);
});

test("provider failures are sanitized in storage and distinguished from finalization recovery", () => {
  const acceptedBranch = route.slice(route.indexOf("if (providerMessageId)"), route.indexOf('console.error("Communications email provider submission failed"'));
  assert.match(route, /Email delivery was not accepted by the provider\./);
  assert.match(route, /The email provider did not accept the message\. Please try again\./);
  assert.match(route, /if \(providerMessageId\)/);
  assert.match(route, /accepted the message, but StudioScrubz could not finish recording delivery/);
  assert.doesNotMatch(acceptedBranch, /finalize\(admin, communicationId, null/);
  assert.doesNotMatch(route, /Response\.json\(\{ error: (?:safeLog|errorMessage)\(cause\)/);
});

test("provider acceptance remains recoverable without duplicate submission", () => {
  assert.match(route, /idempotencyKey: eventKey/);
  assert.match(route, /communication\.status === "Sent" && communication\.provider_message_id/);
  assert.match(route, /providerMessageId = sent\.id\.trim\(\)/);
  assert.match(route, /findProviderSubmission\(admin, communicationId, eventKey\)/);
  assert.match(route, /if \(recoveredSubmission\)[\s\S]*finalize\(admin, communicationId, providerMessageId, null\)[\s\S]*recovered: true/);
  assert.match(route, /Retry this same send request to recover it without sending a duplicate\./);
  assert.match(route, /DeliveryFinalizationError/);
  assert.doesNotMatch(route, /rpc\("finalize_communications_resend_email"/);
});

test("provider acceptance is durably journaled behind a service-role-only boundary", () => {
  assert.match(recoveryMigration, /create table public\.communications_email_provider_submissions/);
  assert.match(recoveryMigration, /communication_id uuid primary key/);
  assert.match(recoveryMigration, /event_key text not null unique/);
  assert.match(recoveryMigration, /provider_message_id text not null/);
  assert.match(recoveryMigration, /enable row level security/);
  assert.match(recoveryMigration, /revoke all on table public\.communications_email_provider_submissions[\s\S]*from public, anon, authenticated/);
  assert.match(recoveryMigration, /grant select, insert on table public\.communications_email_provider_submissions[\s\S]*to service_role/);
  assert.doesNotMatch(recoveryMigration, /grant [^;]* to authenticated/);
});

test("database boundary requires provider ID and preserves mailto and SMS semantics", () => {
  assert.match(migration, /provider_message_id[\s\S]*is not null/);
  assert.match(migration, /auth\.role\(\).*<> 'service_role'/);
  assert.match(migration, /before insert or update/);
  assert.match(migration, /finalize_communications_resend_email/);
  assert.match(migration, /channel = 'Email'.*direction = 'Outbound'.*provider/s);
  assert.doesNotMatch(migration, /provider\s*=\s*'mailto'/);
  assert.doesNotMatch(migration, /channel\s*=\s*'SMS'/);
  assert.doesNotMatch(migration, /mark_client_communication_delivery_status/);
});

test("server-only service-role finalization retains the database delivery invariant", () => {
  assert.match(route, /createSupabaseAdminClient\(\)/);
  assert.match(route, /admin\.from\("client_communications"\)\.update/);
  assert.match(route, /\.eq\("id", id\)\.select\("\*"\)\.single\(\)/);
  assert.match(migration, /new\.status is distinct from old\.status/);
  assert.match(migration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.doesNotMatch(service, /provider_message_id|status:\s*"Sent"/);
});
