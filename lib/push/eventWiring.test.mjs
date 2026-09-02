import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("job event boundaries request push only after successful authoritative results", () => {
  const source = read("../services/jobs.ts");
  assert.match(source, /create_job_from_accepted_proposal[\s\S]*requestJobAttentionPush\(job\)/);
  assert.match(source, /create_direct_operational_job[\s\S]*requestJobAttentionPush\(job\)/);
  assert.match(source, /const job=fullJob\(data\);[\s\S]*requestJobAttentionPush\(job\)/);
  assert.match(source, /complete_in_progress_job[\s\S]*createCompletedJobInvoice[\s\S]*requestImmediateAttentionPush/);
  assert.match(source, /start_or_clock_in_to_job[\s\S]*if \(error\) throw[\s\S]*requestImmediateAttentionPush/);
  assert.match(source, /Ready to Schedule[\s\S]*Scheduled[\s\S]*!job\.assigned_crew_id/);
  assert.match(read("../services/serviceOccurrences.ts"), /create_job_from_service_occurrence[\s\S]*!job\.assigned_crew_id[\s\S]*requestImmediateAttentionPush/);
});

test("proposal and agreement internal terminal transitions reuse the authenticated helper", () => {
  const proposals = read("../services/proposals.ts");
  const agreements = read("../services/agreements.ts");
  assert.match(proposals, /markProposalAccepted[\s\S]*withImmediateAttentionPush/);
  assert.match(agreements, /markAgreementSent[\s\S]*withImmediateAttentionPush/);
  assert.match(agreements, /markAgreementAccepted[\s\S]*withImmediateAttentionPush/);
  assert.equal((proposals.match(/submitProposalForApproval\(id:string\).*withImmediateAttentionPush/g) ?? []).length, 1);
});

test("paid invoice paths trigger only after authoritative payment completion", () => {
  const manual = read("../services/payments.ts");
  const invoices = read("../services/invoices.ts");
  const square = read("../../app/api/webhooks/square/route.ts");
  assert.match(manual, /record_invoice_payment[\s\S]*if\(error\)throw error[\s\S]*invoice\.status==="Paid"[\s\S]*requestImmediateAttentionPush/);
  assert.match(invoices, /saveInvoice[\s\S]*await updateInvoice[\s\S]*invoice\.status==="Paid"[\s\S]*requestImmediateAttentionPush/);
  assert.match(square, /record_square_invoice_payment_v2[\s\S]*if \(error\) throw error[\s\S]*paidInvoice\.status === "Paid"[\s\S]*scheduleAttentionPushAfterResponse/);
});

test("communication failure, open time, and restore boundaries are wired", () => {
  assert.match(read("../services/clientCommunications.ts"), /markCommunicationFailed[\s\S]*withImmediateAttentionPush/);
  assert.match(read("../../app/api/customer-emails/send/route.ts"), /status: "Failed"[\s\S]*if \(!failureError\) scheduleAttentionPushAfterResponse/);
  const time = read("../services/timeEntries.ts");
  const startOperationalJob = read("../services/jobs.ts").match(/export async function startOperationalJob[\s\S]*?\n}/)?.[0] ?? "";
  assert.doesNotMatch(startOperationalJob, /requestImmediateAttentionPush/);
  assert.match(time, /entry\.status === "Open" && !entry\.clock_out[\s\S]*requestImmediateAttentionPush/);
  assert.match(read("../services/attention.ts"), /restoreAttentionItem[\s\S]*withImmediateAttentionPush/);
});

test("public acceptance clients remain free of authenticated push endpoint calls", () => {
  for (const path of ["../services/publicProposals.ts", "../services/publicAgreements.ts"]) {
    const source = read(path);
    assert.doesNotMatch(source, /requestImmediateAttentionPush|withImmediateAttentionPush|api\/attention\/push\/process/);
  }
});
