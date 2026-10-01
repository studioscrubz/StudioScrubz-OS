import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const permissions = readFileSync("lib/auth/permissions.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260903170000_restrict_company_announcement_senders.sql", "utf8");
const foundation = readFileSync("supabase/migrations/20260903141751_add_internal_messaging_foundation.sql", "utf8");
const service = readFileSync("lib/services/messaging.ts", "utf8");
const page = readFileSync("components/messages/MessagesPage.tsx", "utf8");

test("Master Admin and Administrator receive messages.announce, no other role does", () => {
  const masterAdminBlock = permissions.slice(permissions.indexOf('"Master Admin": new Set(PERMISSIONS)'), permissions.indexOf("Administrator: new Set(operationalAdmin)"));
  assert.match(masterAdminBlock, /new Set\(PERMISSIONS\)/); // Master Admin gets every permission, including messages.announce
  const operationalAdminBlock = permissions.slice(permissions.indexOf("const operationalAdmin"), permissions.indexOf("export const ROLE_PERMISSIONS"));
  assert.match(operationalAdminBlock, /"messages\.announce"/);
  const managerBlock = permissions.slice(permissions.indexOf("Manager: new Set(["), permissions.indexOf("Sales: new Set(["));
  assert.doesNotMatch(managerBlock, /messages\.announce/);
  const crewLeadBlock = permissions.slice(permissions.indexOf('"Crew Lead": new Set(['), permissions.indexOf('"Scrub Technician": new Set(['));
  assert.doesNotMatch(crewLeadBlock, /messages\.announce/);
  const scrubTechBlock = permissions.slice(permissions.indexOf('"Scrub Technician": new Set(['));
  assert.doesNotMatch(scrubTechBlock, /messages\.announce/);
});

test("all roles keep messages.view so active users can read announcements", () => {
  assert.equal((permissions.match(/"messages\.view"/g) ?? []).length >= 6, true);
});

test("the database RPC is tightened to Master Admin and Administrator only, without touching the applied foundation migration", () => {
  assert.match(migration, /create or replace function public\.send_company_announcement/);
  assert.match(migration, /array\[\s*'Master Admin', 'Administrator'\s*\]/);
  assert.doesNotMatch(migration, /'Manager'/);
  assert.match(foundation, /'Master Admin', 'Administrator', 'Manager'/); // original migration is untouched
});

test("the announcement composer is only rendered for messages.announce, not merely hidden by a role check", () => {
  assert.match(page, /const canAnnounce = hasPermission\(profile, "messages\.announce"\)/);
  assert.match(page, /canAnnounce\s*\?\s*\(\s*<button[\s\S]*?setNewAnnouncementOpen\(true\)/);
  assert.match(page, /\{newAnnouncementOpen\s*&&\s*canAnnounce\s*&&\s*\(/);
});

test("sending an announcement uses the existing send_company_announcement RPC with title, body, and priority", () => {
  assert.match(service, /rpc\(\s*"send_company_announcement",\s*\{[\s\S]*?p_title:\s*trimmedTitle,[\s\S]*?p_body:\s*trimmedBody,[\s\S]*?p_priority:\s*priority/);
});

test("Requires Acknowledgment uses the existing acknowledge_required_announcement RPC and hides the action once acknowledged", () => {
  assert.match(service, /rpc\(\s*"acknowledge_required_announcement",\s*\{\s*p_message_id:\s*messageId/);
  assert.match(page, /requiresAcknowledgment\s*&&\s*\([\s\S]*?message\.acknowledgedAt\s*\?\s*\(/);
});

test("Normal and Important priorities never expose an acknowledgment action", () => {
  assert.match(page, /const requiresAcknowledgment\s*=\s*message\.priority\s*===\s*"Requires Acknowledgment"/);
  assert.doesNotMatch(page, /priority === "Normal".*Acknowledge/);
  assert.doesNotMatch(page, /priority === "Important".*Acknowledge/);
});

test("announcements participate in the existing read-state infrastructure without altering Direct Message read behavior", () => {
  assert.match(page, /markConversationMessagesRead\(\s*conversation\.id,\s*unreadMessageIds/);
  assert.match(page, /markConversationMessagesRead\(\s*selected\.id,\s*unreadMessageIds/);
  assert.match(page, /markingReadAnnouncements\.current/);
  assert.match(page, /markingReadConversation\.current/);
});

test("Direct Message send/behavior is untouched by the announcement slice", () => {
  assert.match(service, /rpc\(\s*"send_direct_message"/);
  assert.match(page, /sendDirectMessage\(\s*selected\.id,\s*body\s*\)/);
});
