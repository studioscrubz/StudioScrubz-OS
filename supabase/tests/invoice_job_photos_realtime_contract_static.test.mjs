import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../migrations/20260919165038_restore_invoice_job_photos_realtime.sql", import.meta.url),
  "utf8",
);
const provider = fs.readFileSync(
  new URL("../../components/realtime/OperationalRealtimeProvider.tsx", import.meta.url),
  "utf8",
);
const finishedPhotos = fs.readFileSync(
  new URL("../../components/invoices/InvoiceFinishedPhotos.tsx", import.meta.url),
  "utf8",
);
const invoicesPage = fs.readFileSync(
  new URL("../../components/invoices/InvoicesPage.tsx", import.meta.url),
  "utf8",
);

test("invoice photo UI subscribes to every public table change without a row filter", () => {
  assert.match(provider, /OPERATIONAL_TABLES\s*=\s*\[[\s\S]*?"invoice_job_photos"/);
  assert.match(
    provider,
    /\.on\("postgres_changes",\s*\{\s*event:\s*"\*",\s*schema:\s*"public",\s*table\s*\}/,
  );
  assert.doesNotMatch(provider, /event:\s*"\*"[\s\S]{0,100}filter:/);
  assert.match(finishedPhotos, /useOperationalRealtime\(\["jobs",\s*"invoice_job_photos"\],\s*load\)/);
  assert.match(invoicesPage, /useOperationalRealtime\(\["invoices","payments","invoice_job_photos","invoice_job_lines"\]/);
});

test("migration idempotently adds only invoice_job_photos to supabase_realtime", () => {
  assert.match(migration, /exists\s*\([\s\S]*?from pg_publication[\s\S]*?pubname = 'supabase_realtime'/);
  assert.match(migration, /not exists\s*\([\s\S]*?from pg_publication_tables[\s\S]*?schemaname = 'public'[\s\S]*?tablename = 'invoice_job_photos'/);
  assert.match(
    migration,
    /alter publication supabase_realtime\s+add table public\.invoice_job_photos/,
  );
  assert.equal((migration.match(/alter publication/gi) ?? []).length, 1);
  assert.doesNotMatch(migration, /alter table|replica identity|create policy|grant\s|revoke\s|storage\.|create or replace function/i);
});
