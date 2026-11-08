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
const contractorInvitations = await read("app/api/contractors/invitations/route.ts");
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
    contractorInvitation: ["StudioScrubz Operations <operations@studioscrubz.com>", "operations@studioscrubz.com"],
    systemNotification: ["StudioScrubz Notifications <notifications@studioscrubz.com>", "studioscrubz@gmail.com"],
    prospectOutreach: ["StudioScrubz <info@studioscrubz.com>", "info@studioscrubz.com"],
  };
  for (const [key, [from, replyTo]] of Object.entries(expected)) {
    assert.match(registry, new RegExp(`${key}: \\{ from: "${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}", replyTo: "${replyTo.replaceAll(".", "\\.")}" \\}`));
  }
  assert.match(registry, /noReply: \{ from: "StudioScrubz <donotreply@studioscrubz\.com>", replyTo: null \}/);
  assert.match(registry, /export type EmailSenderProfileKey = keyof typeof EMAIL_SENDER_PROFILES/);
});

test("staff routes resolve authenticated personal identities without browser sender input", () => {
  for (const route of [communications, transactional, vendor, marketing]) assert.match(route, /resolvePersonalEmailSender\(profile,\s*admin\)/);
  assert.match(contractorInvitations, /ctx\.type==="internal"[\s\S]*?resolvePersonalEmailSenderById\(ctx\.userId,ctx\.admin\)/);
  assert.doesNotMatch(clientService, /\bfrom\s*:|senderProfile/i);
});

test("users edit their own signatures and only Master Admins can designate senders", async () => {
  const settings = await read("app/api/settings/personal-email/route.ts");
  assert.match(settings, /user_id: profile\.id, signature: body\.signature\.trim\(\)/);
  assert.match(settings, /body\.action === "sender"[\s\S]*?profile\.role !== "Master Admin"[\s\S]*?sender_email: sender/);
  assert.match(resend, /escapeEmailHtml\(signature\)/);
});

test("specialized production workflows use registry identities", () => {
  assert.match(deposit, /resolveEmailSenderProfile\("postConstructionDeposit"\)/);
  assert.match(contractorInvitations, /resolveEmailSenderProfile\("contractorInvitation"\)/);
  assert.match(careers, /resolveEmailSenderProfile\("careers"\),replyTo:clean\.email/);
});

test("provider omits Reply-To for restricted no-reply and keeps a defensive default", () => {
  assert.match(resend, /resolveEmailSenderProfile\("systemNotification"\)/);
  assert.match(resend, /\.\.\.\(replyTo \? \{ reply_to: replyTo \} : \{\}\)/);
});

test("production workflows do not hard-code StudioScrubz From or Reply-To identities", () => {
  for (const [name, source] of Object.entries({ communications, transactional, deposit, vendor, marketing, careers })) {
    assert.doesNotMatch(source, /from:\s*["'`]StudioScrubz/iu, name);
    assert.doesNotMatch(source, /replyTo:\s*["'`][^"'`]+@studioscrubz\.com/iu, name);
  }
});
