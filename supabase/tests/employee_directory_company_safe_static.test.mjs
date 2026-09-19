import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../migrations/20260919161425_restore_employee_directory_company_safe.sql", import.meta.url),
  "utf8",
);
const appliedPlaceholder = fs.readFileSync(
  new URL("../migrations/20260911074500_employee_directory_company_safe.sql", import.meta.url),
  "utf8",
);

test("forward migration restores exactly the company-safe employee columns", () => {
  const selectList = migration.match(/select\s+([\s\S]*?)\s+from public\.employees as e/i)?.[1]
    .split(",")
    .map((column) => column.trim());

  assert.deepEqual(selectList, [
    "e.id",
    "e.employee_number",
    "e.first_name",
    "e.last_name",
    "e.preferred_name",
    "e.email",
    "e.phone",
    "e.department",
    "e.job_title",
    "e.employment_status",
    "e.employment_type",
    "e.created_at",
    "e.updated_at",
    "e.archived_at",
  ]);
  assert.doesNotMatch(migration, /hourly_rate|overtime_rate|commission_rate|bank|routing|account_number|payroll|hire_date|notes/i);
});

test("view excludes archived employees and permits only verified company roles", () => {
  assert.match(migration, /where e\.archived_at is null/);
  assert.match(
    migration,
    /public\.has_any_role\(array\[\s*'Master Admin',\s*'Administrator',\s*'Manager',\s*'Sales',\s*'Crew Lead',\s*'Scrub Technician'\s*\]::text\[\]\)/,
  );
  assert.match(migration, /with \(security_barrier=true\)/);
});

test("view grants authenticated SELECT only and denies public and anon", () => {
  assert.match(
    migration,
    /revoke all on table public\.employee_directory_company_safe\s+from public, anon, authenticated;/,
  );
  assert.match(
    migration,
    /grant select on table public\.employee_directory_company_safe\s+to authenticated;/,
  );
  assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete|truncate|references|trigger|all)/i);
});

test("previously applied empty migration remains untouched", () => {
  assert.equal(appliedPlaceholder, "");
});
