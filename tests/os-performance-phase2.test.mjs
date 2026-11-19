import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=file=>readFileSync(new URL("../"+file,import.meta.url),"utf8");

test("invoice overview uses compact relationship fields, full invoice detail is unchanged",()=>{
 const api=read("lib/services/invoices.ts");
 const ui=read("components/invoices/InvoicesPage.tsx");
 const selector=api.match(/const invoiceListSelect = ([^\n]+)/)?.[1]??"";
 assert.match(selector,/invoice_job_lines\(id,/);
 assert.match(selector,/job:jobs!invoices_job_id_fkey\(job_number\)/);
 assert.match(selector,/agreement:service_agreements!invoices_service_agreement_id_fkey\(agreement_number\)/);
 assert.doesNotMatch(selector,/proposal:proposals/);
 assert.match(api,/export async function getInvoiceById\(id:string\)[\s\S]*?select\(select\)/);
 assert.match(ui,/getInvoiceList\(\)/);
 assert.match(ui,/getInvoiceById\(initialInvoice.id\)/);
});
test("Contractor summary loading stays authorized, isolated and non-blocking",()=>{
 const api=read("app/api/contractors/route.ts");
 const ui=read("components/contractors/ContractorManagement.tsx");
 assert.match(api,/async function contractorDashboardSummary\(ctx:ContractorContext\)\{\s*requireInternal\(ctx\)/);
 assert.match(api,/view==="dashboard-summary"\)return noCache\(await contractorDashboardSummary\(ctx\)\)/);
 assert.match(api,/client_type","Contractor"/);
 assert.match(ui,/view=dashboard-core/);
 assert.match(ui,/view=dashboard-summary/);
 assert.match(ui,/sequence===refreshSequence.current/);
});
test("Cached client and property reads are per-auth user, expire and invalidate after mutations",()=>{
 const cache=read("lib/services/shortReadCache.ts");
 const clients=read("lib/services/clients.ts");
 const properties=read("lib/services/properties.ts");
 assert.match(cache,/MAX_AGE_MS=5_000/);
 assert.match(cache,/const userId=session\?\.user\?\.id/);
 assert.match(cache,/SIGNED_OUT/);
 assert.match(cache,/sessionGeneration===generation/);
 assert.match(clients,/invalidateShortReadCache\("clients:"\)/);
 assert.match(properties,/invalidateShortReadCache\("properties:"\)/);
});
test("Core Web Vitals contain no personal identifiers",()=>{
 const metric=read("components/performance/OsWebVitals.tsx");
 assert.match(metric,/performance\.mark/);
 assert.doesNotMatch(metric,/userId|jobId|invoiceId|email:/);
});
