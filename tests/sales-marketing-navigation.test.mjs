import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebar = readFileSync(new URL("../components/layout/Sidebar.tsx", import.meta.url), "utf8");
test("Marketing Materials and Vendor Packets live inside Sales without duplicate navigation groups", () => {
  const nav=sidebar.slice(sidebar.indexOf("const navItems:"),sidebar.indexOf("function isGroup("));
  const salesStart=nav.indexOf('label: "Sales"');
  const invoicesStart=nav.indexOf('label: "Invoices"', salesStart);
  assert.ok(salesStart>=0&&invoicesStart>salesStart);
  const sales=nav.slice(salesStart,invoicesStart);
  assert.match(sales,/href: "\/marketing-materials"/);
  assert.match(sales,/href: "\/vendor-packets"/);
  assert.match(sales,/permission: "marketingMaterials.send"/);
  assert.match(sales,/permission: "estimates.create"/);
  assert.equal((nav.match(/href: "\/marketing-materials"/g)||[]).length,1);
  assert.equal((nav.match(/href: "\/vendor-packets"/g)||[]).length,1);
});
