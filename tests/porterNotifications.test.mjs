import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260916205528_porter_schedule_notifications_v1.sql", import.meta.url), "utf8");
const attention = readFileSync(new URL("../lib/services/attention.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../components/properties/PorterRoutesPage.tsx", import.meta.url), "utf8");

test("migration preserves nullable legacy time and adds combined revision", () => {
  assert.match(migration, /add column scheduled_start_time time without time zone/);
  assert.match(migration, /notification_revision bigint not null default 1/);
  assert.match(migration, /create_porter_visit_v2[\s\S]*Scheduled start time is required/);
});

test("recipient resolution is assignment-neutral and deduplicates linked users", () => {
  assert.match(migration, /resolve_porter_notification_recipients\([\s\S]*p_worker_employee_id uuid[\s\S]*p_worker_crew_id uuid[\s\S]*p_manager_employee_id uuid/);
  assert.match(migration, /select distinct up\.id, e\.id, ap\.recipient_context/);
  assert.match(migration, /c\.crew_lead_id/);
  assert.match(migration, /public\.crew_members/);
});

test("timed generation is visit-based, revision-deduplicated and terminal-safe", () => {
  assert.match(migration, /v\.status='Scheduled' and v\.started_at is null and v\.scheduled_start_time is not null/);
  assert.match(migration, /visit_reminder_24h/);
  assert.match(migration, /visit_reminder_1h/);
  assert.match(migration, /visit_missed_start/);
  assert.match(migration, /visit\.notification_revision/);
  assert.match(migration, /unique[\s\S]*dedupe_key|dedupe_key text not null unique/);
});

test("Attention and deep-link wiring use the existing framework", () => {
  assert.match(attention, /"porter_notification_events"/);
  assert.match(attention, /event\.dedupe_key[\s\S]*"Porter"/);
  assert.match(migration, /\/properties\/porter-visits\?visit=/);
  assert.match(migration, /\/properties\/porter-routes\?route=/);
  assert.match(routes, /new URLSearchParams\(window\.location\.search\)\.get\("route"\)/);
});

test("event table is recipient-isolated and due generator is service-role only", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /\(select auth\.uid\(\)\) = recipient_user_id/);
  assert.match(migration, /revoke all on function public\.generate_due_porter_notifications\(timestamptz\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.generate_due_porter_notifications\(timestamptz\) to service_role/);
});
