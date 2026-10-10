import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../components/proposals/OpenProposalsPage.tsx");
const service = read("../lib/services/proposals.ts");
const migration = read(
  "../supabase/migrations/20261010010000_protect_superseded_proposals.sql",
);
const publicHistoryMigration = read(
  "../supabase/migrations/20261010000000_proposal_public_revision_history.sql",
);

test("open proposals query excludes archived and superseded revisions", () => {
  assert.match(
    service,
    /getProposals[\s\S]*?\.is\("archived_at",null\)\.or\("is_current_revision\.eq\.true,superseded_at\.is\.null"\)\.neq\("status","Archived"\)/,
  );
  assert.match(
    page,
    /currentRevisionByFamily\.get\(p\.revision_group_id\)[\s\S]*?p\.status !== "Archived"/,
  );
});

test("an unsent draft revision remains actionable until delivery activation", () => {
  assert.match(page, /p\.is_current_revision \|\| !p\.superseded_at/);
  assert.match(service, /is_current_revision\.eq\.true,superseded_at\.is\.null/);
});

test("counters and workflow groups are derived from the guarded rows", () => {
  assert.match(page, /const visibleRows = useMemo/);
  assert.match(page, /total: visibleRows\.filter/);
  assert.match(page, /pending: visibleRows\.filter/);
  assert.match(page, /sent: visibleRows\.filter/);
  assert.match(page, /accepted: visibleRows\.filter/);
  assert.match(page, /expired: visibleRows\.filter/);
  assert.match(page, /workflowGroups\.map/);
});

test("historical rows retain family history access but no proposal actions", () => {
  assert.match(
    service,
    /getProposalRevisionHistory[\s\S]*?\.eq\("revision_group_id",groupId\)/,
  );
  assert.match(page, /const actionable =[\s\S]*?p\.is_current_revision \|\| !p\.superseded_at/);
  assert.match(page, /\{actionable && <Action t="Preview"/);
  assert.match(page, /\{actionable && p\.status === "Draft"/);
  assert.match(page, /\{actionable && canSend/);
  assert.match(page, /\{actionable && \(p\.status === "Sent"/);
  assert.match(page, /\{actionable && p\.status === "Accepted"/);
  assert.match(page, /\{actionable && p\.status === "Expired"/);
  assert.match(page, /<Action t="History" f=\{history\}/);
  assert.match(page, /Superseded · read-only/);
});

test("application writes and approval transitions reject superseded revisions", () => {
  assert.match(
    service,
    /getActionableProposalById[\s\S]*?\.or\("is_current_revision\.eq\.true,superseded_at\.is\.null"\)/,
  );
  assert.match(
    service,
    /updateProposal[\s\S]*?\.or\("is_current_revision\.eq\.true,superseded_at\.is\.null"\)/,
  );
  assert.match(
    service,
    /transitionApproval[\s\S]*?\.or\("is_current_revision\.eq\.true,superseded_at\.is\.null"\)/,
  );
});

test("database protects lifecycle flags and every later historical update", () => {
  assert.match(migration, /before update on public\.proposals/);
  assert.doesNotMatch(
    migration.match(/create function private\.protect_historical_proposal_revision\(\)[\s\S]*?\$\$;/)?.[0] ?? "",
    /security definer/i,
  );
  assert.match(migration, /old\.superseded_at is not null/);
  assert.match(migration, /newer\.revision_number > old\.revision_number/);
  assert.match(migration, /old\.archived_at is not null/);
  assert.match(migration, /old\.status = 'Archived'/);
  assert.match(migration, /current_user is distinct from delivery_owner/);
  assert.match(migration, /to_jsonb\(new\) - array\['is_current_revision', 'superseded_at'\]/);
  assert.match(migration, /Historical Proposal revisions are read-only/);
});

test("assessment detach and audit-history permissions are narrowly scoped", () => {
  assert.match(migration, /current_user is not distinct from assessment_delete_owner/);
  assert.match(migration, /to_jsonb\(new\) - 'walkthrough_id'/);
  assert.match(migration, /revoke all on table public\.proposal_history/);
  assert.match(migration, /grant select, insert on table public\.proposal_history/);
});

test("public family history and current-only actions remain intact", () => {
  assert.match(
    publicHistoryMigration,
    /proposal\.revision_group_id = anchor\.revision_group_id/,
  );
  assert.match(
    publicHistoryMigration,
    /proposal\.revision_number <= anchor\.revision_number/,
  );
  assert.match(publicHistoryMigration, /proposal\.is_current_revision/);
});
