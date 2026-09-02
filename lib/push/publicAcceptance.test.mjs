import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const cases = [
  {
    label: "Proposal",
    service: "../services/publicProposals.ts",
    route: "../../app/api/public/proposals/accept/route.ts",
    endpoint: "/api/public/proposals/accept",
    rpc: "accept_proposal_by_token",
    arguments: [/p_token:/, /p_accepted_by_name:/, /p_consent:/],
  },
  {
    label: "Agreement",
    service: "../services/publicAgreements.ts",
    route: "../../app/api/public/agreements/accept/route.ts",
    endpoint: "/api/public/agreements/accept",
    rpc: "accept_service_agreement_by_token",
    arguments: [/p_token:/, /p_signed_name:/, /p_signature:/, /p_consent:/],
  },
];

for (const acceptance of cases) {
  test(`public ${acceptance.label} acceptance hands off to its server route`, () => {
    const service = read(acceptance.service);
    assert.match(service, new RegExp(`fetch\\(\"${acceptance.endpoint.replaceAll("/", "\\/")}\"`));
    assert.doesNotMatch(service, /requestImmediateAttentionPush|withImmediateAttentionPush|api\/attention\/push\/process/);
  });

  test(`successful public ${acceptance.label} RPC schedules best-effort push afterward`, () => {
    const route = read(acceptance.route);
    assert.match(route, new RegExp(`${acceptance.rpc}[\\s\\S]*if \\(error\\) throw error;[\\s\\S]*scheduleAttentionPushAfterResponse\\(\\)`));
    assert.equal(route.match(/scheduleAttentionPushAfterResponse\(\)/g)?.length, 1);
    for (const argument of acceptance.arguments) assert.match(route, argument);
    assert.doesNotMatch(route, /createSupabaseAdminClient|service.role|CRON_SECRET|VAPID/);
  });
}

test("post-response scheduling isolates acceptance from push failures", () => {
  const source = read("./postResponse.ts");
  assert.match(source, /try[\s\S]*after\(processAttentionPushesBestEffort\)[\s\S]*catch/);
});
