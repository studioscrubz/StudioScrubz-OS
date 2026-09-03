import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("lib/services/messaging.ts", "utf8");
const route = readFileSync("app/api/messages/notify/route.ts", "utf8");
const delivery = readFileSync("lib/push/messagingDelivery.ts", "utf8");
const server = readFileSync("lib/push/messagingServer.ts", "utf8");
const immediate = readFileSync("lib/push/messagingImmediate.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260903160000_add_messaging_push_deliveries.sql", "utf8");

test("sending a Direct Message still succeeds via the existing RPC and triggers the push notify path", () => {
  assert.match(service, /rpc\("send_direct_message"/);
  assert.match(service, /notifyDirectMessagePushBestEffort\(conversationId, message\.id\)/);
  assert.match(service, /fetch\("\/api\/messages\/notify"/);
  assert.match(service, /return message;/);
});

test("push failure never fails message sending", () => {
  assert.match(service, /void fetch\("\/api\/messages\/notify"[\s\S]*?\)\.catch\(\(\) => undefined\)/);
  assert.match(service, /Push notification triggering must never fail message sending\./);
  assert.match(immediate, /try \{\s*await processDirectMessagePush\(input\);/);
  assert.doesNotMatch(immediate, /throw/);
});

test("the notify route derives the recipient from Direct conversation membership, not client input", () => {
  assert.match(route, /session\.from\("messages"\)\.select\("id,sender_user_id"\)/);
  assert.match(route, /message\.sender_user_id !== callerId/);
  assert.match(route, /\.eq\("kind", "Direct"\)/);
  assert.match(route, /conversation_members"\)\.select\("user_id"\)\.eq\("conversation_id", conversationId\)\.is\("left_at", null\)/);
  assert.match(route, /find\(\(userId\) => userId !== callerId\)/);
  assert.doesNotMatch(route, /body\.recipientUserId|body\.recipient_user_id/);
});

test("push payload never contains the private message body and targets the conversation URL", () => {
  assert.match(delivery, /title: "StudioScrubz Message"/);
  assert.match(delivery, /New message from \$\{name\}/);
  assert.match(delivery, /"You have a new Direct Message\."/);
  assert.match(delivery, /url: `\/messages\?conversation=\$\{encodeURIComponent\(input\.conversationId\)\}`/);
  assert.doesNotMatch(delivery, /\bbody:\s*input\.(body|message)\b/);
  assert.doesNotMatch(route, /message\.body|p_body/);
});

test("messaging push delivery uses its own dedup table, separate from attention", () => {
  assert.match(migration, /create table public\.messaging_push_deliveries/);
  assert.match(migration, /unique \(recipient_user_id, message_id, browser_push_subscription_id\)/);
  assert.doesNotMatch(migration, /alter table public\.attention_push_deliveries/);
  assert.match(server, /db\.from\("messaging_push_deliveries"\)\.insert/);
  assert.doesNotMatch(server, /attention_key/);
});

test("messaging push reuses the existing Web Push transport and subscription table", () => {
  assert.match(server, /import \{ sendWebPush \} from "@\/lib\/push\/server"/);
  assert.match(server, /from\("browser_push_subscriptions"\)/);
  assert.doesNotMatch(server, /createClient\(/);
});
