import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("lib/services/pushNotifications.ts", "utf8");
const route = readFileSync("app/api/push/subscribe/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260831040310_add_browser_push_subscriptions.sql", "utf8");

test("client-side registration keeps the existing fast path and never submits a user_id to the server", () => {
  assert.match(service, /client\.from\("browser_push_subscriptions"\)\.upsert\(\{[\s\S]*?onConflict: "endpoint" \}\)/);
  assert.match(service, /if \(!error\) return data;/);
  assert.doesNotMatch(service, /JSON\.stringify\(\{[^}]*user_id/);
  assert.doesNotMatch(service, /JSON\.stringify\(\{[^}]*userId:/);
});

test("account-switch registration falls back to the secure server endpoint only on an RLS violation", () => {
  assert.match(service, /isRowLevelSecurityViolation\(error\)/);
  assert.match(service, /code === "42501" \|\| \/row-level security\/i\.test\(message\)/);
  assert.match(service, /reconcilePushSubscriptionOwnership\(subscription\.endpoint, p256dh, auth\)/);
  assert.match(service, /fetch\("\/api\/push\/subscribe"/);
});

test("the server endpoint derives the user from the authenticated session and ignores client-submitted identity", () => {
  assert.match(route, /createSupabaseServerClient/);
  assert.match(route, /session\.auth\.getUser\(\)/);
  assert.match(route, /const userId = authData\.user\?\.id/);
  assert.doesNotMatch(route, /body\.user_id|body\.userId/);
  assert.match(route, /user_id: userId,/);
});

test("a different-owner endpoint is retired and re-inserted, never reassigned with user_id in place", () => {
  assert.match(route, /existing\.user_id === userId/);
  assert.match(route, /admin\.from\("browser_push_subscriptions"\)\.delete\(\)\.eq\("id", existing\.id\)/);
  assert.match(route, /admin\.from\("browser_push_subscriptions"\)\.insert\(\{/);
  assert.doesNotMatch(route, /\.update\(\{[^}]*user_id/);
});

test("the old subscription row is deleted before the fresh row is inserted, relying on ON DELETE CASCADE for messaging_push_deliveries", () => {
  const deleteIndex = route.indexOf(".delete().eq(\"id\", existing.id)");
  const insertIndex = route.indexOf("browser_push_subscriptions\").insert({");
  assert.ok(deleteIndex > -1 && insertIndex > -1 && deleteIndex < insertIndex);
  assert.match(route, /ON DELETE CASCADE clears its historical delivery rows/);
  assert.doesNotMatch(route, /\.update\(\{[\s\S]*?messaging_push_deliveries/);
});

test("a same-owner endpoint still updates normally via upsert", () => {
  assert.match(route, /!existing \|\| existing\.user_id === userId/);
  assert.match(route, /admin\.from\("browser_push_subscriptions"\)\.upsert\(\{/);
  assert.match(route, /onConflict: "endpoint"/);
  assert.match(route, /revoked_at: null/);
});

test("registration failures never leak raw database/RLS errors to the UI", () => {
  assert.match(route, /Push notifications could not be registered on this browser\./);
  assert.doesNotMatch(route, /return Response\.json\(\{[^}]*cause/);
});

test("existing RLS ownership policies are untouched by this fix", () => {
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(migration, /with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.doesNotMatch(migration, /using \(true\)/);
});
