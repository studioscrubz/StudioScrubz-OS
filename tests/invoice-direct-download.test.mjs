import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function createPdf(invoice){
 const source=readFileSync(new URL("../lib/invoices/downloadPdf.ts",import.meta.url),"utf8");
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};
 vm.runInNewContext(js,{exports,require:()=>({}),TextEncoder,Intl,Uint8Array,Blob,URL,document:{},window:{}});
 return exports.invoicePdfBytes(invoice);
}
test("invoice PDF is a real self-contained PDF and excludes internal notes",async()=>{
 const pdf=await createPdf({
  invoice_number:"INV-2026-001",client_name:"Test Client",property_name:"Unit 5",
  service_name:"Deep Clean",issue_date:"2026-11-24",due_date:"2026-12-24",
  status:"Sent",line_items:[{description:"Kitchen and bathroom",quantity:2,rate:100,amount:200}],
  subtotal:200,discount:0,tax:0,total:200,amount_paid:50,balance_due:150,
  customer_notes:"Door code provided separately",notes:"INTERNAL SECRET",
  terms:"Net 30",is_consolidated:false,job_lines:[]
 });
 const s=Buffer.from(pdf).toString("latin1");
 assert.match(s,/^%PDF-1\.4/);
 assert.match(s,/\/Type \/Catalog/);
 assert.match(s,/xref\n0 /);
 assert.match(s,/%%EOF/);
 assert.match(s,/INV-2026-001/);
 assert.match(s,/Kitchen and bathroom/);
 assert.match(s,/Door code provided separately/);
 assert.doesNotMatch(s,/INTERNAL SECRET/);
});
test("invoice download is available on both desktop and mobile without print popup",()=>{
 const s=readFileSync(new URL("../components/invoices/InvoicesPage.tsx",import.meta.url),"utf8");
 assert.equal((s.match(/<Action text="Download PDF"/g)||[]).length,2);
 assert.match(s,/downloadInvoicePdf\(x\)/);
});

test("invoice PDF email uses attachment-bearing verified Communications delivery",()=>{
 const ui=readFileSync(new URL("../components/invoices/InvoicesPage.tsx",import.meta.url),"utf8");
 assert.equal((ui.match(/<Action text="Email PDF"/g)||[]).length,2);
 assert.match(ui,/sendCommunicationsEmail\(/);
 assert.match(ui,/invoicePdfBytes\(invoice\)/);
 assert.match(ui,/contentType:"application\/pdf"/);
 assert.match(ui,/job\?\.job_number/);
 assert.match(ui,/job\?\.scheduled_date/);
 assert.match(ui,/communicationType:"Invoice"/);
});
