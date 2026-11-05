import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read=(p)=>readFileSync(new URL(p,import.meta.url),"utf8");
const page=read("../components/invoices/InvoicesPage.tsx");
const service=read("../lib/services/invoices.ts");
const archive=read("../lib/services/archives.ts");
const sql=read("../supabase/archive_permanent_delete_rpc.sql");

test("cancelled and archived invoices disappear from active invoice list",()=>{
  assert.match(page,/const activeInvoices=useMemo\(\(\)=>rows\.filter\(x=>!x\.archived_at&&!\["Cancelled","Archived"\]\.includes\(x\.status\)\)/);
  assert.match(page,/const filtered=useMemo\(\(\)=>activeInvoices\.filter/);
  assert.match(page,/const live=activeInvoices/);
  assert.match(page,/INVOICE_STATUSES\.filter\(value=>!\["Cancelled","Archived"\]\.includes\(value\)\)/);
});
test("cancellation preserves audit history and moves invoice into archive list",()=>{
  assert.match(service,/cancelInvoice=\(id:string\)=>updateInvoice\(id,\{status:"Cancelled",archived_at:new Date\(\)\.toISOString\(\)\}\)/);
  assert.match(service,/archiveInvoice=\(id:string\)=>updateInvoice\(id,\{status:"Archived",archived_at:new Date\(\)\.toISOString\(\)\}\)/);
  assert.match(page,/href="\/archives"/);
  assert.match(archive,/\{ type: "Invoices", table: "invoices", href: "\/invoices" \}/);
});
test("permanent deletion requires Master Admin and disallows payment or production checkout history",()=>{
  assert.match(archive,/canPermanentlyDelete\(profile\)/);
  assert.match(archive,/master_admin_permanently_delete_archived_record/);
  assert.match(sql,/when 'Invoices' then/);
  assert.match(sql,/from public\.payments where invoice_id = p_record_id/);
  assert.match(sql,/square_checkout_attempts[\s\S]*square_environment is distinct from 'sandbox'/);
  assert.match(sql,/delete from public\.invoices where id = p_record_id and archived_at is not null/);
});
