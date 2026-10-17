import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTemplate() {
  const target = { exports: {} };
  const code = ts.transpileModule(read("lib/email/studioScrubzTemplate.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module: target,
    exports: target.exports,
    process: { env: { NODE_ENV: "production" } },
    URL,
    require: (id) => {
      if (id === "server-only") return {};
      if (id === "@/lib/publicSiteUrl") return { getPublicSiteUrl: () => "https://app.studioscrubz.com" };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  return target.exports;
}

test("branded template uses the public HTTPS logo with accessible proportional rendering", () => {
  const template = loadTemplate();
  const html = template.renderStudioScrubzEmail("<p>Hello</p>");
  assert.match(html, /src="https:\/\/app\.studioscrubz\.com\/branding\/studioscrubz-logo\.png"/);
  assert.match(html, /alt="StudioScrubz cleaning services logo"/);
  assert.match(html, /width="180"[^>]*height:auto/);
  assert.doesNotMatch(html, /src="(?:\/|data:)/);
});

test("template is mobile-friendly and uses the StudioScrubz palette and tagline", () => {
  const html = loadTemplate().renderStudioScrubzEmail("<p>Hello</p>");
  assert.match(html, /name="viewport"/);
  assert.match(html, /width:100%;max-width:640px/);
  assert.match(html, /#143D1A/);
  assert.match(html, /#D4AF37/);
  assert.match(html, /No mess\. No stress\./);
});

test("contact configuration and unsafe text are escaped", () => {
  const template = loadTemplate();
  const html = template.renderStudioScrubzEmail("<p>Preserved content</p>", {
    businessName: 'Studio <Scrubz>', email: 'hello+care@studioscrubz.com',
    phone: '<script>alert(1)</script>', website: 'studioscrubz.com/contact?x=1&y=2',
  });
  assert.match(html, /Studio &lt;Scrubz&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /mailto:hello\+care@studioscrubz\.com/);
  assert.match(html, /https:\/\/studioscrubz\.com\/contact\?x=1&amp;y=2/);
  assert.match(html, /<p>Preserved content<\/p>/);
});

test("already branded messages are not double wrapped", () => {
  const template = loadTemplate();
  const once = template.renderStudioScrubzEmail("<p>Hello</p>");
  assert.equal(template.renderStudioScrubzEmail(once), once);
  assert.equal((once.match(/data-studioscrubz-email="v1"/g) ?? []).length, 1);
});

test("document, reminder, receipt, general, and automatic producers use the shared Resend boundary", () => {
  const resend = read("lib/email/resend.ts");
  const communications = read("app/api/communications/email/send/route.ts");
  const customerDocuments = read("app/api/customer-emails/send/route.ts");
  const marketing = read("app/api/marketing-materials/route.ts");
  const deposits = read("lib/email/postConstructionDeposit.ts");
  const vendor = read("app/api/vendor-packets/send/route.ts");
  assert.match(resend, /html = renderStudioScrubzEmail\(input\.html/);
  assert.match(customerDocuments, /sendWithResend/);
  assert.match(communications, /"Service Reminder"[\s\S]*"Payment Reminder"[\s\S]*"General"/);
  for (const source of [communications, marketing, deposits, vendor]) assert.match(source, /sendResendEmail/);
});

test("document calls preserve CTA links and plain-text alternatives", () => {
  const resend = read("lib/email/resend.ts");
  assert.match(resend, /text: `\$\{input\.messageBody\}\\n\\n\$\{label\}:\\n\$\{input\.publicUrl\}`/);
  assert.match(resend, /href="\$\{escapeEmailHtml\(input\.publicUrl\)\}"/);
  assert.match(resend, /text: input\.text, html/);
  assert.match(resend, /"Idempotency-Key": input\.idempotencyKey/);
  assert.match(resend, /reply_to: input\.replyTo/);
});
