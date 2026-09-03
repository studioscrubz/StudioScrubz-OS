import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("lib/services/messaging.ts", "utf8");
const route = readFileSync("app/api/messages/notify-announcement/route.ts", "utf8");
const delivery = readFileSync("lib/push/messagingDelivery.ts", "utf8");
const server = readFileSync("lib/push/messagingServer.ts", "utf8");
const immediate = readFileSync("lib/push/messagingImmediate.ts", "utf8");

test("sending an announcement triggers the push notify path only after the RPC resolves", () => {
  assert.match(service, /rpc\("send_company_announcement"/);
  const sendFn = service.slice(service.indexOf("export async function sendCompanyAnnouncement"), service.indexOf("function notifyAnnouncementPushBestEffort"));
  assert.match(sendFn, /if \(error\) throw new Error/);
  assert.match(sendFn, /const message = data as Message;\s*\n\s*notifyAnnouncementPushBestEffort\(message\.id\);/);
  assert.match(sendFn, /return message;/);
});

test("a failed announcement RPC never reaches the push trigger", () => {
  const sendFn = service.slice(service.indexOf("export async function sendCompanyAnnouncement"), service.indexOf("function notifyAnnouncementPushBestEffort"));
  const errorIndex = sendFn.indexOf("if (error) throw new Error");
  const notifyIndex = sendFn.indexOf("notifyAnnouncementPushBestEffort(message.id)");
  assert.ok(errorIndex > -1 && notifyIndex > -1 && errorIndex < notifyIndex);
});

test("push failure never fails announcement sending", () => {
  assert.match(service, /void fetch\("\/api\/messages\/notify-announcement"[\s\S]*?\)\.catch\(\(\) => undefined\)/);
  assert.match(service, /Push notification triggering must never fail announcement sending\./);
  assert.match(immediate, /try \{\s*await processAnnouncementPush\(input\);/);
});

test("the server verifies the authenticated sender and the exact Announcement message", () => {
  assert.match(route, /createSupabaseServerClient/);
  assert.match(route, /session\.auth\.getUser\(\)/);
  assert.match(route, /session\.from\("messages"\)\.select\("id,conversation_id,sender_user_id,priority"\)\.eq\("id", messageId\)/);
  assert.match(route, /message\.sender_user_id !== callerId/);
  assert.match(route, /\.eq\("kind", "Announcement"\)/);
});

test("recipients are derived from conversation membership and the sender is excluded, never trusting client-provided ids", () => {
  assert.match(route, /conversation_members"\)\.select\("user_id"\)\.eq\("conversation_id", conversation\.id\)\.is\("left_at", null\)/);
  assert.match(route, /filter\(\(userId\) => userId !== callerId\)/);
  assert.doesNotMatch(route, /body\.recipientUserIds|body\.senderUserId|body\.userId/);
});

test("Normal, Important, and Requires Acknowledgment payloads use the correct title/body prefixes without the announcement content", () => {
  assert.match(delivery, /title: "StudioScrubz Announcement"/);
  assert.match(delivery, /"Requires Acknowledgment" \? "Action required" : input\.priority === "Important" \? "Important company announcement" : "New company announcement"/);
  assert.match(delivery, /url: "\/messages"/);
  assert.doesNotMatch(delivery, /input\.body|announcementBody/);
});

test("announcement push reuses the existing messaging_push_deliveries dedup and Web Push transport", () => {
  assert.match(server, /db\.from\("messaging_push_deliveries"\)\.insert/);
  assert.match(server, /import \{ sendWebPush \} from "@\/lib\/push\/server"/);
  assert.match(server, /processAnnouncementPush/);
  assert.match(server, /deliverDirectMessagePush\(\{/);
});
