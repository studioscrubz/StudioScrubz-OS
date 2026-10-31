import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync("components/agreements/AgreementsPage.tsx", "utf8");
const service = readFileSync("lib/services/agreements.ts", "utf8");
const publicService = readFileSync("lib/services/publicAgreements.ts", "utf8");

test("draft agreements never present a generated token as a usable signing URL", () => {
  assert.match(view, /hasValidToken && agreement\.status !== "Draft" \?/);
  assert.match(view, /The secure link activates only after you select Send/);
  assert.match(view, /await markAgreementSent\(agreement\.id, recipient, sender, token, expiry\)/);
  assert.match(view, /await deliverDocument\(/);
});

test("only saved, unexpired sent agreement tokens can be copied", () => {
  assert.match(view, /Copy Signing Link/);
  assert.match(view, /\["Sent", "Accepted", "Active", "Paused"\]\.includes\(agreement\.status\)/);
  assert.match(view, /agreement\.client_access_token_expires_at/);
  assert.match(view, /navigator\.clipboard\.writeText\(url\)/);
  assert.match(service, /mark_service_agreement_sent_for_delivery/);
  assert.match(publicService, /get_service_agreement_by_token/);
});
