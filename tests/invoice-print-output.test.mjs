import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public invoice print is visible and flows across pages, with customer notes", () => {
  const page = read("components/invoices/PublicInvoicePage.tsx");
  const css = read("app/globals.css");
  assert.match(page, /id="public-invoice" className="document-print-root/);
  assert.match(page, /print:overflow-visible/);
  assert.match(page, /invoice\.customer_notes&&<section/);
  assert.match(page, /Invoice Notes/);
  assert.match(page, /print:hidden/);
  assert.match(css, /body \* \{ visibility: hidden; \}/);
  assert.match(css, /\.document-print-root, \.document-print-root \* \{ visibility: visible; \}/);
  assert.match(css, /#public-invoice\.document-print-root \{[^}]*overflow: visible;/);
  assert.match(css, /#public-invoice > div \{[^}]*overflow: visible;/);
  assert.match(css, /#public-invoice \.overflow-x-auto \{ overflow: visible; \}/);
  assert.match(css, /#public-invoice tr \{ break-inside: avoid-page; \}/);
});

function renderInternalInvoicePrint(invoice) {
  const source = read("components/invoices/InvoicesPage.tsx");
  const script = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const output = { html: "", printed: false };
  const popup = {
    document: {
      write(content) { output.html += content; },
      close() {},
    },
    print() { output.printed = true; },
  };
  const exports = {};
  vm.runInNewContext(script + "\nexports.__printInvoice=printInvoice;", {
    exports,
    require: () => ({}),
    window: { open: () => popup },
    Intl,
    console,
  });
  exports.__printInvoice(invoice);
  return output;
}

test("direct Print / Save PDF includes escaped customer notes and excludes internal notes", () => {
  const result = renderInternalInvoicePrint({
    id: "invoice-test",
    invoice_number: "INV-TEST",
    client_name: "Example Client",
    property_name: "Example Property",
    service_name: "Standard Cleaning",
    line_items: [{ id: "line1", description: "Cleaning", quantity: 1, rate: 125, amount: 125 }],
    is_consolidated: false,
    contract_billing_type: null,
    job: null,
    tax: 0,
    total: 125,
    amount_paid: 0,
    balance_due: 125,
    due_date: "2026-10-28",
    customer_notes: "Bring <supplies> & leave a note\nThank you!",
    notes: "PRIVATE STAFF-ONLY NOTE",
    terms: "Due upon receipt",
  });
  assert.equal(result.printed, true);
  assert.match(result.html, /<h3>Invoice Notes<\/h3>/);
  assert.match(result.html, /Bring &lt;supplies&gt; &amp; leave a note<br>Thank you!/);
  assert.match(result.html, /Due upon receipt/);
  assert.doesNotMatch(result.html, /PRIVATE STAFF-ONLY NOTE/);
  assert.doesNotMatch(result.html, /<supplies>/);
});

test("empty customer notes are omitted from the direct print document", () => {
  const result = renderInternalInvoicePrint({
    invoice_number: "INV-EMPTY",
    line_items: [],
    is_consolidated: false,
    contract_billing_type: null,
    job: null,
    tax: 0,
    total: 0,
    amount_paid: 0,
    balance_due: 0,
    customer_notes: " ",
  });
  assert.equal(result.printed, true);
  assert.doesNotMatch(result.html, /<h3>Invoice Notes<\/h3>/);
});
