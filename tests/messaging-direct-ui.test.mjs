import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const permissions = readFileSync("lib/auth/permissions.ts", "utf8");
const service = readFileSync("lib/services/messaging.ts", "utf8");
const page = readFileSync("components/messages/MessagesPage.tsx", "utf8");
const realtime = readFileSync("components/realtime/OperationalRealtimeProvider.tsx", "utf8");
const sidebar = readFileSync("components/layout/Sidebar.tsx", "utf8");

test("all roles receive Direct Messages permissions and route access", () => {
  assert.match(permissions, /"messages\.view", "messages\.send"/);
  assert.match(permissions, /\["\/messages", "messages\.view"\]/);
  assert.equal((permissions.match(/"messages\.view", "messages\.send"/g) ?? []).length >= 4, true);
  assert.equal((permissions.match(/"messages\.announce"/g) ?? []).length, 2);
});

test("recipient picker excludes the current user and uses active profiles", () => {
  assert.match(service, /from\("user_profiles"\)/);
  assert.match(service, /\.eq\("is_active", true\)/);
  assert.match(page, /candidate\.id !== currentUserId/);
  assert.doesNotMatch(page, /employees/);
});

test("Direct mutations use RPCs and blank messages are blocked", () => {
  assert.match(service, /rpc\("start_direct_conversation"/);
  assert.match(service, /rpc\("send_direct_message"/);
  assert.match(service, /rpc\("mark_messages_read"/);
  assert.match(service, /if \(!trimmed\) throw new Error/);
  assert.match(page, /disabled=\{sending \|\| !body\.trim\(\)\}/);
  assert.doesNotMatch(service, /\.insert\([^)]*conversations/);
  assert.doesNotMatch(service, /rpc\("send_direct_message"[^\n]*sender_user_id/);
});

test("unread state is based on messages and read states", () => {
  assert.match(service, /from\("message_read_states"\)/);
  assert.match(service, /sender_user_id !== userId && !readIds\.has\(message\.id\)/);
  assert.match(sidebar, /getUnreadDirectMessageCount/);
});

test("sidebar exposes the Messages navigation item with messages.view permission", () => {
  assert.match(sidebar, /href: "\/messages", marker: "M", permission: "messages\.view"/);
});

test("only the active Direct conversation is marked read, including automatic selection", () => {
  const directEffect = page.slice(page.indexOf("if (!selected || selected.unreadCount === 0"), page.indexOf('}, [currentUserId, selected]);'));
  assert.match(directEffect, /selected\.unreadCount === 0/);
  assert.match(directEffect, /markConversationMessagesRead\(selected\.id, unreadMessageIds\)/);
  assert.match(directEffect, /setConversations\(\(current\) => current\.map\(\(conversation\) => conversation\.id === selected\.id/);
  assert.match(directEffect, /markingReadConversation\.current === selected\.id/);
  assert.doesNotMatch(directEffect, /markConversationMessagesRead\(conversation\.id/);
});

test("Direct messaging realtime tables remain registered alongside the new Company Announcements tables", () => {
  for (const table of ["conversations", "conversation_members", "messages", "message_read_states"]) assert.match(realtime, new RegExp(`"${table}"`));
  assert.match(page, /useOperationalRealtime\(\["conversations", "conversation_members", "messages", "message_read_states", "announcement_acknowledgments"\]/);
  assert.match(service, /\.eq\("kind", "Direct"\)/);
});
