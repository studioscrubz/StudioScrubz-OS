import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { clientViewCounts, matchesClientView } from "../lib/clients/clientView.ts";

const page = fs.readFileSync(new URL("../components/clients/ClientsPage.tsx", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../lib/services/clients.ts", import.meta.url), "utf8");

const clients = [
  { status: "Lead", first_name: "Ben" },
  { status: "Active", first_name: "Ben" },
  { status: "Active", first_name: "Ari" },
  { status: "Inactive", first_name: "Ben" },
];

test("Lead, Active Client, Inactive Client, and All use the authoritative client status", () => {
  assert.deepEqual(clients.filter((client) => matchesClientView(client, "leads")), [clients[0]]);
  assert.deepEqual(clients.filter((client) => matchesClientView(client, "active")), [clients[1], clients[2]]);
  assert.deepEqual(clients.filter((client) => matchesClientView(client, "inactive")), [clients[3]]);
  assert.deepEqual(clients.filter((client) => matchesClientView(client, "all")), clients);
});

test("search applies within the selected client view", () => {
  const result = clients.filter((client) => matchesClientView(client, "active") && client.first_name.toLowerCase().includes("ben"));
  assert.deepEqual(result, [clients[1]]);
  assert.match(page, /matchesClientView\(client, view\).*searchable\.includes\(term\)/s);
});

test("view counts are derived from the already-loaded records", () => {
  assert.deepEqual(clientViewCounts(clients), { all: 4, leads: 1, active: 2, inactive: 1 });
  assert.match(page, /clientViewCounts\(clients\.filter/);
});

test("Active Clients is the default and URL view state preserves other query parameters", () => {
  assert.match(page, /useState<ClientView>\("active"\)/);
  assert.match(page, /url\.searchParams\.set\("view", nextView\)/);
  assert.match(page, /new URL\(window\.location\.href\)/);
});

test("existing client actions, permissions, and data service remain intact", () => {
  for (const action of ["onView(client)", "onEdit(client)", "onArchive(client)"]) assert.ok(page.includes(action));
  for (const permission of ["clients.create", "clients.edit", "clients.archive"]) assert.ok(page.includes(permission));
  assert.match(service, /\.from\("clients"\)/);
  assert.doesNotMatch(service, /\.eq\("status"/);
});
