import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const files = read("lib/email/attachments.ts");
const limits = read("lib/email/attachmentLimits.ts");
const ui = read("components/communications/EmailAttachmentPicker.tsx");
const general = read("app/api/communications/email/send/route.ts");
const employee = read("app/api/communications/employee-email/route.ts");
const migration = read("supabase/migrations/20261026083000_employee_email_attachment_manifest.sql");

function loadParser() {
  const exports = {};
  const constants = { MAX_EMAIL_FILES: 3, MAX_EMAIL_FILE_BYTES: 2000000, MAX_EMAIL_TOTAL_BYTES: 2000000,
    EMAIL_ATTACHMENT_TYPES: { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", txt: "text/plain", csv: "text/csv", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } };
  const js = ts.transpileModule(files, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports, require: id => id === "node:crypto" ? { createHash } : id === "@/lib/email/attachmentLimits" ? constants : {}, Buffer });
  return exports;
}
const parser = loadParser();
function attachment(filename, value, contentType) { return { filename, content: Buffer.from(value).toString("base64"), contentType }; }

test("attachment validation checks file identity, MIME, signatures and total size", () => {
  const valid = attachment("invoice.pdf", "%PDF-1.6\ninvoice", "application/pdf");
  const { files: result, manifest } = parser.parseEmailAttachments([valid]);
  assert.equal(result.length, 1);
  assert.equal(manifest[0].sha256, createHash("sha256").update(Buffer.from("%PDF-1.6\ninvoice")).digest("hex"));
  assert.equal(parser.sameAttachmentManifest(manifest, manifest), true);
  assert.equal(parser.sameAttachmentManifest([{sha256: manifest[0].sha256, bytes: manifest[0].bytes, contentType: manifest[0].contentType, filename: manifest[0].filename}],manifest),true);
  assert.equal(parser.sameAttachmentManifest([], manifest), false);
  for (const bad of [
    [{ ...valid, filename: "../invoice.pdf" }],
    [{ ...valid, filename: "evil.exe" }],
    [{ ...valid, contentType: "text/html" }],
    [attachment("invoice.pdf", "not a real pdf", "application/pdf")],
    [{ ...valid, content: "not-base64" }],
    [attachment("a.txt", "x".repeat(2000001), "text/plain")],
    [valid, valid, valid, valid],
  ]) assert.throws(() => parser.parseEmailAttachments(bad), /attachment|PDF|files|large|supported|limit|Select|Combined|invalid/i);
});

test("General Email validates and binds attachments to request identity before sending", () => {
  assert.match(general, /parseEmailAttachments\(body\.attachments\)/);
  assert.match(general, /attachment_manifest: manifest/);
  assert.match(general, /sameAttachmentManifest/);
  assert.match(general, /idempotencyKey: eventKey, attachments/);
  assert.match(general, /communications\.create/);
  assert.match(general, /provider_message_id/);
});

test("Employee Email uses immutable attachment manifest per recipient", () => {
  assert.match(employee, /parseEmailAttachments\(body\.attachments\)/);
  assert.match(employee, /attachments_manifest: manifest/);
  assert.match(employee, /sameAttachmentManifest\(row\.attachments_manifest, manifest\)/);
  assert.match(employee, /idempotencyKey: delivery\.event_key, attachments/);
  assert.match(employee, /AUTHORIZED_ROLES/);
  assert.match(employee, /preview\.recipientCount > 1 && body\.confirmed !== true/);
  assert.match(migration, /add column attachments_manifest jsonb not null default/);
  assert.match(migration, /before update on public\.employee_email_deliveries/);
  assert.match(migration, /is distinct from old\.attachments_manifest/);
  assert.match(migration, /revoke all on function/);
});

test("Both outgoing email forms allow selecting/removing attachments and enforce file budget", () => {
  const generalUi = read("components/communications/GeneralEmailPage.tsx");
  const employeeUi = read("components/communications/EmployeeEmailPage.tsx");
  for (const page of [generalUi, employeeUi]) {
    assert.match(page, /EmailAttachmentPicker/);
    assert.match(page, /encodeEmailFiles\(attachments\)/);
  }
  assert.match(ui, /type="file" multiple/);
  assert.match(ui, /Remove/);
  assert.match(ui, /MAX_EMAIL_TOTAL_BYTES/);
  assert.match(limits, /MAX_EMAIL_TOTAL_BYTES = 2_000_000/);
  assert.match(read("lib/email/resend.ts"), /attachments: input\.attachments\?\.map/);
});
