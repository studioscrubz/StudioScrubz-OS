import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/20260831040310_add_browser_push_subscriptions.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

test("push subscription table is tied to auth users and has unique endpoints", () => {
  assert.match(migration, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(migration, /unique \(endpoint\)/); assert.match(migration, /revoked_at timestamptz/);
});
test("RLS limits every client operation to the authenticated owner", () => {
  assert.match(migration, /enable row level security/); assert.match(migration, /revoke all on table[\s\S]*public, anon, authenticated/);
  for (const operation of ["select", "insert", "update", "delete"]) assert.match(migration, new RegExp(`for ${operation} to authenticated`));
  assert.ok((migration.match(/\(select auth\.uid\(\)\) = user_id/g) ?? []).length >= 5);
  assert.doesNotMatch(migration, /to anon/);
});
test("service worker handles push payload fields and notification clicks", () => {
  assert.match(worker, /addEventListener\("push"/); assert.match(worker, /showNotification/);
  for (const field of ["title", "body", "url", "tag"]) assert.match(worker, new RegExp(`payload\\.${field}`));
  assert.match(worker, /StudioScrubz OS/); assert.match(worker, /\/attention/);
  assert.match(worker, /addEventListener\("notificationclick"/); assert.match(worker, /notification\.close\(\)/);
  assert.match(worker, /clients\.matchAll/); assert.match(worker, /clients\.openWindow/);
});
test("service worker has no embedded VAPID or Supabase credentials", () => {
  assert.doesNotMatch(worker, /VAPID|service_role|SUPABASE|eyJ[A-Za-z0-9_-]{20,}/i);
});
