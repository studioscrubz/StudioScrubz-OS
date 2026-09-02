import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requestImmediateAttentionPush, withImmediateAttentionPush } from "./client.ts";

test("successful business mutation attempts immediate push afterward", async () => {
  const order = [];
  const result = await withImmediateAttentionPush(
    async () => { order.push("mutation"); return { id: "saved-1" }; },
    async () => { order.push("push"); },
  );
  assert.deepEqual(order, ["mutation", "push"]);
  assert.deepEqual(result, { id: "saved-1" });
});

test("failed business mutation does not attempt immediate push", async () => {
  let pushes = 0;
  await assert.rejects(
    () => withImmediateAttentionPush(
      async () => { throw new Error("mutation failed"); },
      async () => { pushes += 1; },
    ),
    /mutation failed/,
  );
  assert.equal(pushes, 0);
});

test("immediate push failure does not change a successful mutation result", async () => {
  const expected = { id: "saved-2" };
  const result = await withImmediateAttentionPush(
    async () => expected,
    async () => { throw new Error("push failed"); },
  );
  assert.equal(result, expected);
});

test("wiring executes the business mutation exactly once", async () => {
  let mutations = 0;
  await withImmediateAttentionPush(
    async () => { mutations += 1; return "saved"; },
    async () => undefined,
  );
  assert.equal(mutations, 1);
});

test("client trigger uses only the authenticated internal endpoint and exposes no secrets", async () => {
  const calls = [];
  await requestImmediateAttentionPush(async (input, init) => {
    calls.push([input, init]);
    return new Response(null, { status: 202 });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/attention/push/process");
  assert.deepEqual(calls[0][1], { method: "POST", credentials: "same-origin", cache: "no-store" });
  assert.doesNotMatch(JSON.stringify(calls), /CRON_SECRET|VAPID|service.role|authorization/i);
});

test("client trigger ignores network failures", async () => {
  await assert.doesNotReject(() => requestImmediateAttentionPush(async () => {
    throw new Error("network failed");
  }));
});

test("only the requested three business paths are wired", () => {
  const route = readFileSync(new URL("../../app/api/public/request-estimate/route.ts", import.meta.url), "utf8");
  const walkthroughRoute = readFileSync(new URL("../../app/api/public/estimates/walkthrough-request/route.ts", import.meta.url), "utf8");
  const postResponse = readFileSync(new URL("./postResponse.ts", import.meta.url), "utf8");
  const estimates = readFileSync(new URL("../services/publicEstimates.ts", import.meta.url), "utf8");
  const proposals = readFileSync(new URL("../services/proposals.ts", import.meta.url), "utf8");
  assert.match(route, /saved=await submitPublicRequest\(input,result\);scheduleAttentionPushAfterResponse\(\);return Response\.json\(saved/);
  assert.doesNotMatch(route, /await processAttentionPushesBestEffort/);
  assert.match(walkthroughRoute, /await createSupabaseAdminClient\(\)\.rpc\("request_estimate_walkthrough_by_token"[\s\S]*scheduleAttentionPushAfterResponse\(\);[\s\S]*return Response\.json\(data\)/);
  assert.doesNotMatch(walkthroughRoute, /await processAttentionPushesBestEffort/);
  assert.match(postResponse, /after\(processAttentionPushesBestEffort\)/);
  assert.match(estimates, /requestPublicEstimateWalkthrough[\s\S]*fetch\("\/api\/public\/estimates\/walkthrough-request"/);
  assert.match(proposals, /submitProposalForApproval[\s\S]*withImmediateAttentionPush/);
});

test("post-response registration failure is isolated", () => {
  const source = readFileSync(new URL("./postResponse.ts", import.meta.url), "utf8");
  assert.match(source, /try\s*{[\s\S]*after\(processAttentionPushesBestEffort\);[\s\S]*}\s*catch\s*{/);
});
