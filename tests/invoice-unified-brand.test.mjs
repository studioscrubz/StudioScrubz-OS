import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const read=(file)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");

test("all invoice PDF delivery modes use the same branded generator and official asset",()=>{
 const pdf=read("lib/invoices/downloadPdf.ts");
 const invoicePage=read("components/invoices/InvoicesPage.tsx");
 assert.match(pdf,/\/branding\/studioscrubz-logo\.png/);
 assert.match(pdf,/const GREEN="#143d1a"/);
 assert.match(pdf,/const GOLD="#d4af37"/);
 assert.match(pdf,/replace\(\/\\\?\{2,\}\/g," "\)/);
 assert.match(pdf,/async function invoicePdfBytes|async function invoicePdfBytes/);
 assert.match(invoicePage,/const attachmentBytes=useMemo\(\(\)=>invoicePdfBytes\(invoice\),\[invoice\]\)/);
 assert.match(invoicePage,/const pdf=await attachmentBytes/);
 assert.match(invoicePage,/downloadInvoicePdf\(x\)/);
 assert.match(invoicePage,/sendCommunicationsEmail\(/);
});

test("internal and customer-facing print invoices carry the same brand identity",()=>{
 const internal=read("components/invoices/InvoicesPage.tsx");
 const customer=read("components/invoices/PublicInvoicePage.tsx");
 assert.match(internal,/\/branding\/studioscrubz-logo\.png/);
 assert.match(customer,/\/branding\/studioscrubz-logo\.png/);
 assert.match(internal,/No mess\. No stress\./);
 assert.match(customer,/No mess\. No stress\./);
 assert.match(customer,/invoice\.terms\.replace/);
 assert.match(internal,/x\.terms\.replace/);
});
