import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

async function invoiceSendSource() {
  const page = await read("components/invoices/InvoicesPage.tsx");
  const source = page.match(/async function send\(x:InvoiceWithRelations\)([\s\S]*?)async function cancel/)?.[1];
  assert.ok(source, "Invoice send function should be present");
  return source;
}

test("Invoice email subject uses the exact safe title", async () => {
  const source = await invoiceSendSource();
  assert.match(source, /const subject="StudioScrubz Invoice Ready";/);
  assert.doesNotMatch(source, /StudioScrubz Invoice Ready\s*[?\uFFFD]/);
});

test("Invoice email title is passed through without a trailing question mark", async () => {
  const [source, email] = await Promise.all([
    invoiceSendSource(),
    read("lib/email/resend.ts"),
  ]);
  assert.match(source, /deliverDocument\(\{[^}]*subject,messageBody,/);
  assert.match(email, /subject: input\.subject/);
  assert.match(email, /<strong[^>]*>StudioScrubz<\/strong>/);
  assert.doesNotMatch(email, />StudioScrubz Invoice Ready\s*[?\uFFFD]</);
});

test("Invoice SMS records the safe title and opens a message without it trailing", async () => {
  const [source, delivery] = await Promise.all([
    invoiceSendSource(),
    read("lib/services/unifiedDocumentDelivery.ts"),
  ]);
  assert.match(source, /const subject="StudioScrubz Invoice Ready";/);
  assert.match(delivery, /subject: input\.subject/);
  assert.match(delivery, /const outgoing = `\$\{input\.messageBody\}/);
  assert.doesNotMatch(source, /Invoice Ready\s*[?\uFFFD]/);
});

test("Generated Invoice notification copy contains no replacement or mojibake sequences", async () => {
  const source = await invoiceSendSource();
  assert.doesNotMatch(source, /\uFFFD|â|Â|ðŸ/);
});

test("Legitimate question marks outside the title remain unchanged", async () => {
  const page = await read("components/invoices/InvoicesPage.tsx");
  assert.match(page, /window\.confirm\("Cancel this invoice\?"\)/);
  assert.match(page, /If you have any questions regarding the invoice or completed service/);
});

test("Other shared outbound document titles use ASCII separators", async () => {
  const [agreements, proposals, attention] = await Promise.all([
    read("components/agreements/AgreementsPage.tsx"),
    read("components/proposals/OpenProposalsPage.tsx"),
    read("lib/services/attention.ts"),
  ]);
  const titles = `${agreements}\n${proposals}\n${attention}`;
  assert.doesNotMatch(titles, /(?:Ready|Reminder) \? /);
  assert.match(agreements, /Service Agreement Ready - /);
  assert.match(proposals, /Proposal Ready - /);
  assert.match(attention, /Reminder - Upcoming StudioScrubz Service/);
  assert.match(attention, /Friendly Reminder - StudioScrubz Invoice/);
});
