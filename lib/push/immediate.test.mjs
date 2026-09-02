import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runAttentionPushBestEffort, sanitizeAttentionPushError } from "./bestEffort.ts";
import { handleImmediateAttentionPush } from "./immediateRoute.ts";

function dependencies(overrides = {}) {
  return {
    authenticate: async () => ({ userId: "user-1" }),
    process: async () => undefined,
    allow: () => true,
    ...overrides,
  };
}

test("unauthenticated immediate push request is rejected", async () => {
  let processed = false;
  const response = await handleImmediateAttentionPush(dependencies({
    authenticate: async () => null,
    process: async () => { processed = true; },
  }));
  assert.equal(response.status, 401);
  assert.equal(processed, false);
  assert.deepEqual(await response.json(), { error: "Authentication is required." });
});

test("authenticated immediate push request is accepted", async () => {
  let processed = false;
  const response = await handleImmediateAttentionPush(dependencies({
    process: async () => { processed = true; },
  }));
  assert.equal(response.status, 202);
  assert.equal(processed, true);
  assert.deepEqual(await response.json(), { accepted: true });
});

test("processor failure does not turn the endpoint into an application failure", async () => {
  const response = await handleImmediateAttentionPush(dependencies({
    process: async () => { throw new Error("WEB_PUSH_VAPID_PRIVATE_KEY=do-not-return"); },
  }));
  assert.equal(response.status, 202);
  const body = JSON.stringify(await response.json());
  assert.equal(body, '{"accepted":true}');
  assert.doesNotMatch(body, /do-not-return|VAPID|CRON_SECRET|service.role/i);
});

test("best-effort wrapper never rethrows and sanitizes its log", async () => {
  const logs = [];
  await assert.doesNotReject(() => runAttentionPushBestEffort(
    async () => { throw new Error("Bearer secret-token https://push.example/device CRON_SECRET=hidden"); },
    (message, detail) => logs.push([message, detail]),
  ));
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0][1], /secret-token|push\.example|hidden/);
  assert.match(logs[0][1], /\[credential\]|\[endpoint\]|\[redacted\]/);
});

test("best-effort wrapper still resolves if logging fails", async () => {
  await assert.doesNotReject(() => runAttentionPushBestEffort(
    async () => { throw new Error("processor failed"); },
    () => { throw new Error("logger failed"); },
  ));
});

test("server-only wrapper reuses the existing processor", () => {
  const source = readFileSync(new URL("./immediate.ts", import.meta.url), "utf8");
  assert.match(source, /import "server-only"/);
  assert.match(source, /runAttentionPushBestEffort\(processAttentionPushes\)/);
});

test("sanitizer bounds non-error values", () => {
  assert.equal(sanitizeAttentionPushError({ private: "value" }), "Attention push processing failed.");
});
