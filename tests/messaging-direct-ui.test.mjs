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

test("recipient picker excludes the current user and uses the safe messaging directory", () => {
  assert.match(service, /from\("messaging_user_directory_safe"\)/);
  assert.match(service, /select\("id,employee_id,display_name,email,role"\)/);
  assert.match(page, /candidate\.id\s*!==\s*currentUserId/);
  assert.doesNotMatch(service, /from\("user_profiles"\)|from\("employees"\)/);
});

test("Direct mutations use RPCs and blank messages are blocked", () => {
  assert.match(service, /rpc\(\s*"start_direct_conversation"/);
  assert.match(service, /rpc\(\s*"send_direct_message"/);
  assert.match(service, /rpc\(\s*"mark_messages_read"/);
  assert.match(service, /if \(!trimmed\)\s*\{\s*throw new Error/);
  assert.match(page, /disabled=\{\s*sending\s*\|\|\s*!body\.trim\(\)\s*\}/);
  assert.doesNotMatch(service, /\.insert\([^)]*conversations/);
  assert.doesNotMatch(service, /rpc\("send_direct_message"[^\n]*sender_user_id/);
});

test("unread state is based on messages and read states", () => {
  assert.match(service, /from\("message_read_states"\)/);
  assert.match(service, /sender_user_id\s*!==\s*userId\s*&&\s*!readIds\.has\(message\.id\)/);
  assert.match(sidebar, /getUnreadDirectMessageCount/);
});

test("sidebar exposes the Messages navigation item with messages.view permission", () => {
  assert.match(sidebar, /hasPermission\(auth\.profile,\s*"messages\.view"\)[\s\S]*?<Link[\s\S]*?href="\/messages"/);
});

test("only the active Direct conversation is marked read, including automatic selection", () => {
  const marker = page.indexOf("markingReadConversation.current = selected.id");
  const directEffect = page.slice(
    page.lastIndexOf("useEffect(() => {", marker),
    page.indexOf("}, [currentUserId, selected]);", marker),
  );
  assert.match(directEffect, /selected\.unreadCount === 0/);
  assert.match(directEffect, /markConversationMessagesRead\(\s*selected\.id,\s*unreadMessageIds/);
  assert.match(directEffect, /setConversations\(\(current\)\s*=>\s*current\.map\(\(conversation\)\s*=>[\s\S]*?conversation\.id\s*===\s*selected\.id/);
  assert.match(directEffect, /markingReadConversation\.current === selected\.id/);
  assert.doesNotMatch(directEffect, /markConversationMessagesRead\(conversation\.id/);
});

test("Direct messaging realtime tables remain registered alongside the new Company Announcements tables", () => {
  for (const table of ["conversations", "conversation_members", "messages", "message_read_states"]) assert.match(realtime, new RegExp(`"${table}"`));
  for (const table of ["conversations", "conversation_members", "messages", "message_read_states", "announcement_acknowledgments"]) {
    assert.match(page, new RegExp(`"${table}"`));
  }
  assert.match(service, /\.eq\("kind", "Direct"\)/);
});
