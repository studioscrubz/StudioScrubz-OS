import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const registry = await read("lib/email/senderProfiles.ts");
const resend = await read("lib/email/resend.ts");
const communications = await read("app/api/communications/email/send/route.ts");
const transactional = await read("app/api/customer-emails/send/route.ts");
const deposit = await read("lib/email/postConstructionDeposit.ts");
const vendor = await read("app/api/vendor-packets/send/route.ts");
const marketing = await read("app/api/marketing-materials/route.ts");
const careers = await read("lib/recruiting/leadGeneratorApplications.ts");
const clientService = await read("lib/services/communicationsEmail.ts");

test("authoritative registry contains every approved sender profile", () => {
  const expected = {
    general: ["StudioScrubz <info@studioscrubz.com>", "info@studioscrubz.com"],
    estimate: ["StudioScrubz Estimates <estimates@studioscrubz.com>", "estimates@studioscrubz.com"],
    proposal: ["StudioScrubz Estimates <estimates@studioscrubz.com>", "estimates@studioscrubz.com"],
    serviceAgreement: ["StudioScrubz <info@studioscrubz.com>", "info@studioscrubz.com"],
    billing: ["StudioScrubz Billing <billing@studioscrubz.com>", "billing@studioscrubz.com"],
    scheduling: ["StudioScrubz Scheduling <scheduling@studioscrubz.com>", "scheduling@studioscrubz.com"],
    postConstructionDeposit: ["StudioScrubz Billing <billing@studioscrubz.com>", "billing@studioscrubz.com"],
    vendor: ["StudioScrubz Vendors <vendors@studioscrubz.com>", "vendors@studioscrubz.com"],
    careers: ["StudioScrubz Careers <careers@studioscrubz.com>", "careers@studioscrubz.com"],
    marketing: ["StudioScrubz <donotreply@studioscrubz.com>", "info@studioscrubz.com"],
    systemNotification: ["StudioScrubz Notifications <notifications@studioscrubz.com>", "donotreply@studioscrubz.com"],
    prospectOutreach: ["StudioScrubz <info@studioscrubz.com>", "info@studioscrubz.com"],
  };
  for (const [key, [from, replyTo]] of Object.entries(expected)) {
    assert.match(registry, new RegExp(`${key}: \\{ from: "${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}", replyTo: "${replyTo.replaceAll(".", "\\.")}" \\}`));
  }
  assert.match(registry, /noReply: \{ from: "StudioScrubz <donotreply@studioscrubz\.com>", replyTo: null \}/);
  assert.match(registry, /export type EmailSenderProfileKey = keyof typeof EMAIL_SENDER_PROFILES/);
});

test("server routes resolve locked semantic profiles", () => {
  assert.match(communications, /return "general"/);
  assert.match(communications, /type === "Estimate".*return "estimate"/);
  assert.match(communications, /type === "Proposal".*return "proposal"/);
  assert.match(communications, /type === "Service Agreement".*return "serviceAgreement"/);
  assert.match(communications, /type === "Invoice" \|\| type === "Payment Reminder".*return "billing"/);
  assert.match(communications, /type === "Service Reminder".*return "scheduling"/);
  assert.match(communications, /retry_of_communication_id/);
  assert.match(transactional, /type === "Estimate" \? "estimate" : type === "Proposal" \? "proposal" : type === "Service Agreement" \? "serviceAgreement" : "billing"/);
  assert.doesNotMatch(clientService, /\bfrom\s*:|senderProfile/i);
});

test("specialized production workflows use registry identities", () => {
  assert.match(deposit, /resolveEmailSenderProfile\("postConstructionDeposit"\)/);
  assert.match(vendor, /resolveEmailSenderProfile\("vendor"\)/);
  assert.match(marketing, /resolveEmailSenderProfile\("marketing"\)/);
  assert.match(careers, /resolveEmailSenderProfile\("careers"\),replyTo:clean\.email/);
});

test("provider omits Reply-To for restricted no-reply and keeps a defensive default", () => {
  assert.match(resend, /resolveEmailSenderProfile\("systemNotification"\)/);
  assert.match(resend, /\.\.\.\(input\.replyTo \? \{ reply_to: input\.replyTo \} : \{\}\)/);
});

test("production workflows do not hard-code StudioScrubz From or Reply-To identities", () => {
  for (const [name, source] of Object.entries({ communications, transactional, deposit, vendor, marketing, careers })) {
    assert.doesNotMatch(source, /from:\s*["'`]StudioScrubz/iu, name);
    assert.doesNotMatch(source, /replyTo:\s*["'`][^"'`]+@studioscrubz\.com/iu, name);
  }
});
