import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const migration=read("supabase/migrations/20261107160000_contractor_management_foundation.sql");
const activation=read("supabase/migrations/20261107161000_contractor_invitation_job_handoff.sql");
const api=read("app/api/contractors/route.ts"),invites=read("app/api/contractors/invitations/route.ts");
const files=read("app/api/contractors/files/route.ts"),guards=read("lib/contractors/server.ts");
const permissions=read("lib/auth/permissions.ts"),sidebar=read("components/layout/Sidebar.tsx");
test("new relations are RLS-enforced and directly unwritable, including financial approvals",()=>{
 for(const name of ["contractor_companies","contractor_members","contractor_invitations","contractor_opportunities","contractor_offers","contractor_messages","contractor_profitability","contractor_audit_events","contractor_documents"]){
  assert.match(migration,new RegExp("alter table public\\."+name+" enable row level security"));
 }
 assert.match(migration,/revoke insert,update,delete on public\.contractor_companies/);
 assert.match(migration,/public\.contractor_profitability,public\.contractor_audit_events/);
 assert.doesNotMatch(migration,/grant (?:insert|update) on public\.contractor_profitability to authenticated/);
});
test("portal user identity is verified against membership and active company, never user metadata",()=>{
 assert.match(guards,/auth\.getUser\(\)/);
 assert.match(guards,/\.eq\("user_id",user\.id\)/);
 assert.match(guards,/company\.status!=="Active"/);
 assert.match(guards,/if\(staff\)throw/);
 assert.doesNotMatch(guards,/raw_user_meta_data|user_metadata/);
 assert.match(api,/\.eq\("company_id",companyId\)/);
 assert.match(api,/linkedIds\.length\?db\.from\("invoices"\)\.select\("id,job_id,invoice_number,status,total,amount_paid,due_date"\)/);
 assert.doesNotMatch(api,/\.select\(".*gross_pay.*"\).*eq\("company_id"/);
});
test("single-use invitations expire and require matching verified auth email",()=>{
 assert.match(migration,/interval '7 days'/);
 assert.match(invites,/randomBytes\(32\)\.toString\("hex"\)/);
 assert.match(invites,/createHash\("sha256"\)/);
 assert.match(activation,/email_confirmed_at is not null/);
 assert.match(activation,/v_inv\.expires_at<=now\(\)/);
 assert.match(activation,/lower\(v_inv\.invited_email\)<>v_email/);
 assert.match(activation,/for update;/i);
 assert.match(activation,/status='Redeemed'/);
});
test("pricing, privileged overrides, final confirmation and job idempotency are gated",()=>{
 assert.match(api,/calculateProfitability\(/);
 assert.match(api,/requireMaster\(ctx\)/);
 assert.match(api,/!opp\.partner_confirmed_at/);
 assert.match(api,/!a\.override_approved_by/);
 assert.match(activation,/v_op\.linked_job_id is not null then return v_op\.linked_job_id/);
 assert.match(activation,/v_op\.partner_confirmed_at is null or v_op\.internal_confirmed_at is null/);
 assert.match(activation,/v_pr\.minimum_price/);
 assert.match(activation,/v_pr\.assessed_amount<>v_op\.agreed_amount/);
 assert.match(activation,/v_pr\.assessed_scope<>v_op\.final_scope/);
 assert.match(api,/a\.assessed_scope!==opp\.final_scope/);
 assert.match(activation,/insert into public\.jobs/);
});
test("existing employee roles do not inherit contractor access, and external portal is separate",()=>{
 assert.match(permissions,/"contractors.view", "contractors.manage"/);
 assert.match(permissions,/Manager: new Set\(\[[\s\S]*"contractors.view", "contractors.manage"/);
 assert.match(permissions,/\["\/contractors", "contractors.view"\]/);
 assert.match(sidebar,/label: "Operations"[\s\S]*label: "Contractor Dashboard"/);
 assert.match(sidebar,/href: "\/contractors\/invitations"/);
});
test("attachments require exact file signatures, private storage and scoped signed URLs",()=>{
 assert.match(files,/const BUCKET="contractor-private"/);
 assert.match(files,/magic\(bytes,uploaded\.type\)/);
 assert.match(files,/createSignedUrl\(document\.storage_path,60\)/);
 assert.match(files,/document\.company_id!==ctx\.companyId/);
 assert.match(files,/\.eq\("company_id",companyId\)/);
});
