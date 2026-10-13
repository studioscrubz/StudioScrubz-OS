import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadPublicAgreementService(fetchImpl) {
  const target = { exports: {} };
  const code = ts.transpileModule(read("lib/services/publicAgreements.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module: target,
    exports: target.exports,
    fetch: fetchImpl,
    require: (id) => {
      if (id === "@/lib/supabase/client") return { getSupabaseClient: () => ({ rpc: async () => ({ data: null, error: null }) }) };
      if (id === "@/lib/services/publicJsonResponse") return { parsePublicJsonResponse: async (response, fallback) => {
        const body = await response.text();
        if (!body.trim()) throw new Error(response.ok ? "Refresh this page to confirm whether your request completed before trying again." : fallback);
        let payload;
        try { payload = JSON.parse(body); } catch { throw new Error(response.ok ? "Refresh this page to confirm whether your request completed before trying again." : fallback); }
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : fallback);
        return payload;
      } };
      throw new Error(`Unexpected runtime import: ${id}`);
    },
  });
  return target.exports;
}

test("successful signing returns the signed agreement JSON", async () => {
  const signed = { agreement_number: "AGR-TEST", status: "Accepted", client_signed_at: "2026-10-12T20:00:00Z", client_signed_name: "Client Name" };
  const service = loadPublicAgreementService(async () => Response.json(signed));
  assert.deepEqual(await service.acceptPublicAgreement("t".repeat(40), "Client Name", true), signed);
});

test("empty, non-JSON, and failed signing responses are client-safe", async () => {
  const empty = loadPublicAgreementService(async () => new Response(null, { status: 200 }));
  await assert.rejects(empty.acceptPublicAgreement("t".repeat(40), "Client Name", true), /Refresh this page to confirm/);
  const invalid = loadPublicAgreementService(async () => new Response("gateway response", { status: 200 }));
  await assert.rejects(invalid.acceptPublicAgreement("t".repeat(40), "Client Name", true), /Refresh this page to confirm/);
  const failed = loadPublicAgreementService(async () => Response.json({ error: "This agreement is no longer awaiting acceptance." }, { status: 409 }));
  await assert.rejects(failed.acceptPublicAgreement("t".repeat(40), "Client Name", true), /no longer awaiting acceptance/);
});

test("public page prevents duplicate submissions and reconciles an uncertain response", () => {
  const page = read("components/agreements/PublicAgreementPage.tsx");
  assert.match(page, /signingRef\.current\|\|agreement\?\.client_signed_at/);
  assert.match(page, /catch\(cause\)\{try\{const current=await getPublicAgreement\(token\)/);
  assert.match(page, /if\(!current\.client_signed_at\)setError/);
  assert.match(page, /const signed=Boolean\(agreement\.client_signed_at\),canSign=agreement\.status==="Sent"&&!signed/);
  assert.match(page, /Agreement Accepted/);
});

test("unsigned and signed agreements print real multipage document content without controls", () => {
  const page = read("components/agreements/PublicAgreementPage.tsx");
  const css = read("app/globals.css");
  assert.match(page, /id="public-agreement" className="document-print-root/);
  for (const text of ["Service Agreement", "Company / Client", "Service Description", "Payment Terms", "Cancellation Terms", "Agreement Accepted"]) assert.match(page, new RegExp(text.replace("/", "\\/")));
  assert.match(page, /Electronic Signature[\s\S]*print:hidden/);
  assert.match(page, /Print \/ Save as PDF/);
  assert.match(css, /\.document-print-root, \.document-print-root \* \{ visibility: visible; \}/);
  assert.match(css, /\.document-print-root \{ position: static; width: 100%; overflow: visible; \}/);
  assert.match(css, /break-inside: avoid-page/);
  assert.doesNotMatch(css, /\.document-print-root \{ position: absolute/);
});

test("standard public agreements use an isolated two-page US Letter print plan", () => {
  const page = read("components/agreements/PublicAgreementPage.tsx");
  const css = read("app/globals.css");
  assert.match(page, /agreement-print-page agreement-print-page-one/);
  assert.match(page, /agreement-print-page agreement-print-page-two/);
  assert.match(css, /@page public-agreement \{ size: Letter portrait; margin: 0\.36in 0\.42in; \}/);
  assert.match(css, /#public-agreement\.document-print-root \{ page: public-agreement;/);
  assert.match(css, /#public-agreement \.agreement-print-page-two \{ break-before: page; \}/);
  assert.match(css, /#public-agreement \.agreement-print-page \{ display: block; \}/);
  assert.match(css, /#public-agreement section \{ margin-top: 0\.1in; break-inside: auto; \}/);
  assert.match(css, /#public-agreement section > h3 \{ break-after: avoid-page; \}/);
  assert.match(css, /#public-agreement header, #public-agreement dl, #public-agreement \.agreement-print-signature \{ break-inside: avoid-page; \}/);
  assert.doesNotMatch(css, /#public-agreement \.agreement-print-page \{ display: flow-root/);
  assert.doesNotMatch(css, /#public-agreement[^}]*overflow: hidden/);
});

test("acceptance route serializes the response before best-effort post-response work", () => {
  const route = read("app/api/public/agreements/accept/route.ts");
  assert.match(route, /if \(!data \|\| typeof data !== "object"\)/);
  assert.match(route, /const response = Response\.json\(data\);[\s\S]*scheduleAttentionPushAfterResponse\(\);[\s\S]*return response;/);
});
