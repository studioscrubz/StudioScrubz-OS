// Run with @electric-sql/pglite installed, or set PGLITE_MODULE to its module path.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon; create role authenticated;
create table jobs(id uuid primary key,client_id uuid,property_id uuid,job_number text,property_name text,service_name text,completed_at timestamptz,scheduled_date date,status text,archived_at timestamptz,price numeric,service_occurrence_id uuid);
create table properties(id uuid primary key,client_id uuid,property_name text,address text,address_line_2 text,city text,state text,zip text,archived_at timestamptz);
create table invoices(id uuid primary key,job_id uuid,client_id uuid,total numeric,status text,archived_at timestamptz,sent_at timestamptz,client_access_token text,amount_paid numeric,paid_at timestamptz,balance_due numeric,deposit_requested boolean,is_consolidated boolean,service_agreement_id uuid,contract_billing_type text);
create table payments(invoice_id uuid);
create table square_checkout_attempts(invoice_id uuid,status text,square_order_id text);
create table invoice_job_lines(invoice_id uuid,job_id uuid);
create table service_occurrences(id uuid,agreement_id uuid);
create table service_agreements(id uuid,billing_type text);
insert into properties values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Client residence','123 Main','Unit 2','Long Beach','CA','90802',null);
insert into jobs(id,client_id,property_id,job_number,service_name,status,price) values('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','JOB-TEST','Standard','Completed',100);
insert into invoices(id,job_id,client_id,total,status,sent_at,client_access_token,amount_paid,balance_due,deposit_requested,is_consolidated) values('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002',125,'Open',now(),'test-link',0,125,false,false);`);
await db.exec(readFileSync('supabase/migrations/20261119003000_consolidation_sent_status.sql','utf8'));
for (const status of ['Open','Sent','Past Due']) {
  await db.exec(`update invoices set status='${status}'`);
  assert.equal((await db.query('select * from contractor_invoice_consolidation_candidates')).rows.length,1,status);
  console.log('PASS unpaid '+status+' invoice included');
}
await db.exec("update invoices set status='Sent'");
const rows=async()=> (await db.query('select * from contractor_invoice_consolidation_candidates')).rows;
assert.equal((await rows()).length,1);assert.equal(Number((await rows())[0].amount),125); console.log('PASS sent open invoice included at original invoice total');
for(const [label,sql] of [
['partial payment',`update invoices set amount_paid=25,balance_due=100`],
['paid invoice',`update invoices set status='Paid',amount_paid=125,balance_due=0`],
['payment record',`insert into payments select id from invoices`],
['pending checkout',`insert into square_checkout_attempts select id,'Pending',null from invoices`],
['issued checkout',`insert into square_checkout_attempts select id,'Failed','order-id' from invoices`],
['contract billing',`update invoices set contract_billing_type='Monthly'`],
['duplicate active invoice',`insert into invoices(id,job_id,status) select '00000000-0000-0000-0000-000000000005',job_id,'Draft' from invoices`],
['job already consolidated',`insert into invoice_job_lines select id,job_id from invoices`],
['cross company property',`update properties set client_id='00000000-0000-0000-0000-000000000009'`]
]) {await db.exec('begin;'+sql);assert.equal((await rows()).length,0,label);await db.exec('rollback');console.log('PASS excludes '+label);}
await db.exec('begin;delete from invoices');assert.equal((await rows()).length,1);await db.exec('rollback');console.log('PASS uninvoiced completed job remains eligible');
assert.equal((await db.query("select has_table_privilege('anon','contractor_invoice_consolidation_candidates','select') as allowed")).rows[0].allowed,false);console.log('PASS anonymous view access denied');
await db.close();
