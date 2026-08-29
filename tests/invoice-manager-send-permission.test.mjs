import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Manager receives only the granular Invoice send capability", async () => {
  const permissions = await read("lib/auth/permissions.ts");
  const manager = permissions.match(/Manager: new Set\(\[([\s\S]*?)\]\),\n  Sales:/)?.[1] ?? "";
  assert.match(manager, /"invoices\.view"/);
  assert.match(manager, /"invoices\.send"/);
  assert.doesNotMatch(manager, /"invoices\.(?:create|edit|recordPayment)"/);
  assert.doesNotMatch(manager, /"(?:archives\.delete|settings\.manage|finances\.view)"/);
});

test("Invoice send UI is gated separately from edit and payment actions", async () => {
  const page = await read("components/invoices/InvoicesPage.tsx");
  assert.match(page, /canSend=hasPermission\(profile,"invoices\.send"\)/);
  assert.match(page, /\{canSend&&<Action text=\{x\.sent_at\?"Resend Invoice":"Send Invoice"\}/);
  assert.match(page, /\{canEdit&&\["Draft","Open","Sent","Past Due","Partially Paid"\]/);
  assert.match(page, /\{canRecordPayment&&<Action text="Record Payment"/);
});

test("Invoice preparation is server-authorized and narrowly updates delivery fields", async () => {
  const [route, service] = await Promise.all([
    read("app/api/invoices/[id]/prepare-delivery/route.ts"),
    read("lib/services/invoices.ts"),
  ]);
  assert.match(route, /hasPermission\(profile, "invoices\.send"\)/);
  assert.match(route, /SENDABLE_STATUSES/);
  assert.match(route, /status: "Sent", sent_at: sentAt, client_access_token: token, client_access_token_expires_at: expiresAt/);
  assert.doesNotMatch(route, /amount_paid|balance_due|payment|Square|delete\(/);
  assert.match(service, /\/api\/invoices\/\$\{encodeURIComponent\(id\)\}\/prepare-delivery/);
  assert.doesNotMatch(service.match(/export async function sendInvoice[\s\S]*?\n/)?.[0] ?? "", /\.from\("invoices"\)|updateInvoice\(/);
});

test("Transactional Invoice email uses the same granular backend permission", async () => {
  const route = await read("app/api/customer-emails/send/route.ts");
  assert.match(route, /type === "Service Agreement" \? "agreements\.manage" : "invoices\.send"/);
  assert.match(route, /if \(!hasPermission\(profile, permissionFor\(documentType\)\)\)/);
});
