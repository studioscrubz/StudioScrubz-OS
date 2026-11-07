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
 for(const name of ["contractor_companies","contractor_members","contractor_invitations","contractor_opportunities","contractor_offers","contractor_messages","contractor_profitability","contractor_audit_events","contractor_documents","contractor_message_reads","contractor_contact_attempts","contractor_followups","contractor_notification_deliveries"]){
  assert.match(migration,new RegExp("alter table public\\."+name+" enable row level security"));
 }
 assert.match(migration,/revoke all on public\.contractor_companies/);
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
 assert.match(api,/db\.from\("invoices"\)\.select\("id,job_id,invoice_number,status,total,amount_paid,due_date(?:,archived_at)?"\)/);
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
 assert.match(activation,/v_op\.partner_confirmed_at is null or \(v_op\.status=\x27Accepted\x27 and v_op\.internal_confirmed_at is null/);
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
test("attachments require exact file signatures, private storage and authorized downloads",()=>{
 assert.match(files,/const BUCKET="contractor-private"/);
 assert.match(files,/magic\(bytes,uploaded\.type\)/);
 assert.match(files,/download\(document\.storage_path\)/);
 assert.match(files,/document\.company_id!==ctx\.companyId/);
 assert.match(files,/\.eq\("company_id",companyId\)/);
});

test("company administrator tax files and quality-reviewed financial outputs stay company scoped",()=>{
 const upload=read("app/api/contractors/files/route.ts");
 const photos=read("app/api/contractors/completion-photos/route.ts");
 assert.match(upload,/ctx\.role!=="Company Admin"&&document\.category==="Tax"/);
 assert.match(upload,/category==="Tax"&&ctx\.role!=="Company Admin"/);
 assert.match(api,/ctx\.role==="Company Admin"\?documents\.data/);
 assert.match(api,/approvedJobIds\.length\?db\.from\("invoices"\)/);
 assert.match(api,/action==="approveQuality"/);
 assert.match(api,/action==="invoiceJob"/);
 assert.match(api,/create_completed_job_invoice/);
 assert.match(api,/action==="setMemberAccess"/);
 assert.match(api,/action==="sendPaymentReminder"/);
 assert.match(photos,/!op\.quality_approved_at/);
 assert.match(photos,/\.eq\("customer_visible",true\)/);
 assert.match(photos,/\.eq\("job_id",jobId\)\.in\("invoice_id"/);
 assert.match(photos,/\.download\(photo\.storage_path\)\.asStream\(\)/);
});
test("contractor opportunities are idempotent and use existing guarded crew assignment",()=>{
 const portal=read("components/contractors/ContractorPortal.tsx");
 const assignment=read("components/contractors/ContractorJobAssignment.tsx");
 assert.match(portal,/externalReference:submissionKey/);
 assert.match(api,/const externalRef=uuid\(input\.externalReference\)/);
 assert.match(assignment,/assignJobWorker\(/);
 assert.match(assignment,/findCrewConflicts/);
 assert.match(assignment,/findIndividualTechConflicts/);
 assert.match(assignment,/getActiveCrews\(/);
});

test("contractor communications record unread receipts, contact attempts and due follow-ups",()=>{
 assert.match(api,/action==="markMessagesRead"/);
 assert.match(api,/action==="logContactAttempt"/);
 assert.match(api,/action==="createFollowup"/);
 assert.match(api,/action==="resolveFollowup"/);
 assert.match(api,/\.match\(thread\)\.eq\("sender_side"/);
 assert.match(api,/read_at:new Date\(\)\.toISOString\(\)/);
 assert.match(migration,/create table public\.contractor_contact_attempts/);
 assert.match(migration,/create table public\.contractor_followups/);
});

test("scheduled contractor reminders are secret-protected and idempotently receipt-tracked",()=>{
 const cron=read("app/api/contractors/reminders/route.ts");
 const config=read("vercel.json");
 assert.match(cron,/process\.env\.CRON_SECRET/);
 assert.match(cron,/request\.headers\.get\("authorization"\)/);
 assert.match(cron,/event_key:event\.key/);
 assert.match(cron,/insertError\.code==="23505"/);
 assert.match(cron,/status:"Sent",provider_message_id:sent\.id/);
 assert.match(cron,/\.lt\("due_date",today\)/);
 assert.match(cron,/outstanding<=0/);
 assert.match(cron,/operations-digest/);
 assert.match(migration,/create table public\.contractor_notification_deliveries/);
 assert.match(config,/\/api\/contractors\/reminders/);
});

test("partner hostname is isolated from the employee application and uses canonical authentication links",()=>{
 const proxy=read("proxy.ts");
 const login=read("components/contractors/ContractorLogin.tsx");
 const activationUi=read("components/contractors/ContractorActivate.tsx");
 assert.match(proxy,/isPartnerHost\(hostname\)/);
 assert.match(proxy,/pathname === "\/"\) return updateSession\(request, \{ partnerEntry: true \}\)/);
 assert.match(proxy,/destination\.pathname = \`\/contractor\$\{pathname\}\`/);
 assert.match(proxy,/"\/api\/contractors\/completion-photos"\]\.includes\(pathname\)/);
 assert.match(guards,/isPartnerHost\(\(await headers\(\)\)\.get\("host"\)\)/);
 assert.match(read("lib/supabase/proxy.ts"),/authenticated \? "\/contractor" : "\/contractor\/login"/);
 assert.match(proxy,/new NextResponse\("Not Found", \{ status: 404 \}\)/);
 assert.match(invites,/https:\/\/partners\.studioscrubz\.com/);
 assert.match(login,/https:\/\/partners\.studioscrubz\.com/);
 assert.match(activationUi,/https:\/\/partners\.studioscrubz\.com/);
 assert.match(activationUi,/\/contractor\/activate#token=/);
 assert.match(activationUi,/new URLSearchParams\(callback\.hash\.slice\(1\)\)/);
 assert.match(read("components/contractors/ContractorResetPassword.tsx"),/event === "PASSWORD_RECOVERY"/);
 assert.match(login,/https:\/\/app\.studioscrubz\.com\/login/);
});


test("activation reuses the confirmed browser session before offering password entry",()=>{
 const activate=read("components/contractors/ContractorActivate.tsx");
 assert.match(activate,/const session=getSupabaseClient\(\)\.auth\.getSession\(\)/);
 assert.match(activate,/await session;[\s\S]*?current\?\.user\.email_confirmed_at[\s\S]*?promise:redeem\(invitationToken\)/);
 assert.match(activate,/router\.replace\(contractorPage\("\/"\)\)/);
 assert.match(activate,/signInWithPassword/);
});


test("partner profile updates and private messages use the server identity",()=>{
 const portal=read("components/contractors/ContractorPortal.tsx");
 const management=read("components/contractors/ContractorManagement.tsx");
 const privacy=read("supabase/migrations/20261107192154_contractor_private_messages.sql");
 const profile=api.slice(api.indexOf('if(action==="updateCompany")'),api.indexOf('if(action==="submitOpportunity")'));
 assert.match(profile,/ctx\.type==="internal"\?uuid\(input\.companyId\):ctx\.companyId/);
 assert.match(profile,/if\(ctx\.type==="internal"\)\{\s*if\(input\.payment_terms/);
 assert.doesNotMatch(profile,/Company administrator access required/);
 assert.match(api,/ctx\.type==="partner"\?ctx\.userId:uuid\(input\.partnerUserId\)/);
 assert.match(api,/\.eq\("partner_user_id",ctx\.userId\)\.eq\("manager_user_id",manager\.id\)/);
 assert.match(api,/manager\.id!==ctx\.userId/);
 assert.match(api,/\.eq\("manager_user_id",ctx\.userId\)\.in\("company_id",managedCompanies\)/);
 assert.doesNotMatch(api,/\.from\("contractor_messages"\)/);
 assert.doesNotMatch(portal+management,/Company-wide (?:messages|conversation)/i);
 assert.match(privacy,/revoke all on public\.contractor_private_messages from public,anon,authenticated/);
});
