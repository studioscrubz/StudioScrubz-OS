import assert from "node:assert/strict";
import test from "node:test";
import { sendCommunicationsEmail } from "../lib/services/communicationsEmail.ts";

const input = { requestId: "11111111-1111-4111-8111-111111111111", recipientEmail: "client@example.com", subject: "Subject", messageBody: "Message", communicationType: "General" };
const providerMessageId = "22222222-2222-4222-8222-222222222222";
const communication = { status: "Sent", provider: "resend", provider_message_id: providerMessageId };

async function withFetch(implementation, action) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try { return await action(); } finally { globalThis.fetch = original; }
}

test("Resend acceptance with a matching provider ID is success", async () => {
  const result = await withFetch(async () => Response.json({ communication, provider: "resend", providerMessageId, accepted: true }), () => sendCommunicationsEmail(input));
  assert.equal(result.provider_message_id, providerMessageId);
});

for (const [name, implementation, expected] of [
  ["Resend rejection is failure", async () => Response.json({ error: "Resend rejected the sender domain." }, { status: 502 }), /rejected the sender domain/],
  ["network exception is failure", async () => { throw new Error("provider network unavailable"); }, /provider network unavailable/],
  ["missing Resend configuration is failure", async () => Response.json({ error: "Email provider configuration is unavailable." }, { status: 502 }), /configuration is unavailable/],
  ["missing provider message ID is failure", async () => Response.json({ communication, provider: "resend", accepted: true }), /verifiable acceptance/],
  ["Prepared communication cannot become UI success", async () => Response.json({ communication: { ...communication, status: "Prepared" }, provider: "resend", providerMessageId, accepted: true }), /verifiable acceptance/],
]) test(name, async () => {
  await assert.rejects(() => withFetch(implementation, () => sendCommunicationsEmail(input)), expected);
});
