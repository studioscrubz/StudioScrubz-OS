import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/communications/email/send/route.ts", import.meta.url), "utf8");
const modal = await readFile(new URL("../components/communications/LogCommunicationModal.tsx", import.meta.url), "utf8");
const service = await readFile(new URL("../lib/services/communicationsEmail.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261005160000_communications_resend_delivery_invariant.sql", import.meta.url), "utf8");

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
  assert.match(route, /finalize\(admin, communicationId, sent\.id, null\)/);
});

test("duplicate, concurrent, and retry calls preserve one row and provider identity", () => {
  assert.match(route, /communications-email:\$\{profile\.id\}:\$\{requestId\}/);
  assert.match(route, /\.eq\("event_key", eventKey\)\.maybeSingle\(\)/);
  assert.match(route, /createError\?\.code === "23505"/);
  assert.match(route, /assertSameRequest/);
  assert.match(route, /communication\.status === "Sent" && communication\.provider_message_id/);
});

test("provider failures are sanitized in storage and browser responses", () => {
  assert.match(route, /Email delivery was not accepted by the provider\./);
  assert.match(route, /The email could not be confirmed as sent\. Please try again\./);
  assert.doesNotMatch(route, /Response\.json\(\{ error: (?:safeLog|errorMessage)\(cause\)/);
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
