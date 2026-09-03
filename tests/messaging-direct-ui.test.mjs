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
  assert.doesNotMatch(permissions, /messages\.announce/);
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

test("only the active conversation is marked read, including automatic selection", () => {
  assert.match(page, /useEffect\(\(\) => \{/);
  assert.match(page, /selected\.unreadCount === 0/);
  assert.match(page, /markConversationMessagesRead\(selected\.id, unreadMessageIds\)/);
  assert.match(page, /setConversations\(\(current\) => current\.map\(\(conversation\) => conversation\.id === selected\.id/);
  assert.match(page, /markingReadConversation\.current === selected\.id/);
  assert.doesNotMatch(page, /markConversationMessagesRead\(conversation\.id/);
});

test("realtime refresh covers Direct messaging tables and inbox excludes announcements", () => {
  for (const table of ["conversations", "conversation_members", "messages", "message_read_states"]) assert.match(realtime, new RegExp(`"${table}"`));
  assert.match(page, /useOperationalRealtime\(\["conversations", "conversation_members", "messages", "message_read_states"\]/);
  assert.match(service, /\.eq\("kind", "Direct"\)/);
  assert.doesNotMatch(page, /send_company_announcement|acknowledge_required_announcement/);
});
