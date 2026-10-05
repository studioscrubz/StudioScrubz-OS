import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, require = () => { throw new Error("Unexpected runtime import"); }) {
  const target = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module: target, exports: target.exports, require });
  return target.exports;
}

const proposalAddons = load("../lib/pricing/proposalAddons.ts");
const proposalPricing = load("../lib/pricing/proposals.ts", (id) => {
  if (id === "@/lib/scheduling/frequency") return { estimatedMonthlyTotal: (amount) => amount };
  if (id === "@/lib/pricing/pricingEngine") return { calculateRecurringTotals: ({ subtotal }) => ({ manualDiscount: 0, taxes: 0, finalPrice: subtotal, recurringDiscountAmount: 0, recurringDiscountPercent: 0, recurringPricingRuleId: null, recurringPricingRuleName: null }) };
  if (id === "@/lib/pricing/authoritativePrice") return { withAuthoritativeEstimatePrice: (value) => value };
  throw new Error(`Unexpected runtime import: ${id}`);
});

const windows = {
  id: "windows", addon_code: "WINDOWS", addon_name: "Window Cleaning", description: null,
  division: "Both", pricing_model: "Per Unit", pricing_config: { pricing_type: "Per Unit", unit_name: "Window", unit_price: 8 },
  price: 8, unit_label: "Window", is_active: true, display_order: 1, created_at: "", updated_at: "", archived_at: null,
};
const flat = {
  ...windows, id: "oven", addon_code: "OVEN", addon_name: "Oven Cleaning", pricing_model: "Flat Rate",
  pricing_config: { pricing_type: "Flat Price" }, price: 40, unit_label: null,
};

test("Proposal Window quantity is editable and rebuilt from authoritative catalog pricing", () => {
  const one = proposalAddons.selectProposalCatalogAddons([], [windows.addon_name], [windows, flat]);
  assert.equal(one[0].quantity, 1);
  assert.equal(one[0].amount, 8);

  const eight = proposalAddons.replaceProposalCatalogAddons(one, [{ catalogAddonId: windows.id, name: windows.addon_name, quantity: 8, unitPrice: 999, lineTotal: 7992 }], [windows, flat]);
  assert.equal(eight[0].quantity, 8);
  assert.equal(eight[0].unitPrice, 8);
  assert.equal(eight[0].amount, 64);
});

test("invalid per-unit quantities are rejected and flat add-ons remain quantity one", () => {
  for (const quantity of [0, -1, 1.5, undefined]) {
    assert.throws(() => proposalAddons.replaceProposalCatalogAddons([], [{ catalogAddonId: windows.id, name: windows.addon_name, quantity }], [windows]), /whole-number quantity/);
  }
  const selected = proposalAddons.replaceProposalCatalogAddons([], [{ catalogAddonId: flat.id, name: flat.addon_name, quantity: 99, unitPrice: 0 }], [flat]);
  assert.equal(selected[0].quantity, undefined);
  assert.equal(selected[0].amount, 40);
  assert.equal(proposalAddons.proposalAddonSnapshots(selected, [flat])[0].quantity, 1);
});

test("saved quantity hydrates and removal removes the pricing contribution", () => {
  const saved = proposalAddons.replaceProposalCatalogAddons([], [{ catalogAddonId: windows.id, name: windows.addon_name, quantity: 8 }], [windows]);
  const reopened = proposalAddons.proposalAddonSnapshots(JSON.parse(JSON.stringify(saved)), [windows]);
  assert.equal(reopened[0].quantity, 8);
  const removed = proposalAddons.selectProposalCatalogAddons(saved, [], [windows]);
  assert.equal(removed.length, 0);
});

test("changing inherited Window quantity recalculates the Proposal total without duplicate base charge", () => {
  const estimate = {
    finalPrice: 200, adjustments: [{ label: windows.addon_name, amount: 8, catalogAddonId: windows.id }],
    laborHours: 0, crewSize: 1, laborCost: 0, supplyCost: 0, manualDiscount: 0,
    recurringDiscount: 0, recurringDiscountPercent: 0, recurringPricingRuleId: null, recurringPricingRuleName: null,
    calculatorInput: { frequency: "One-Time" },
  };
  const input = { estimate, recurringRules: [], serviceName: "Cleaning", serviceDescription: null, frequency: "One-Time", adjustments: [], additionalLabor: 0, additionalMaterials: 0, manualDiscountPercent: 0, scope: [], terms: {} };
  const quantityOne = proposalAddons.replaceProposalCatalogAddons([], [{ catalogAddonId: windows.id, name: windows.addon_name, quantity: 1 }], [windows]);
  const quantityEight = proposalAddons.replaceProposalCatalogAddons(quantityOne, [{ catalogAddonId: windows.id, name: windows.addon_name, quantity: 8 }], [windows]);
  assert.equal(proposalPricing.calculateProposal({ ...input, adjustments: quantityOne }).perVisitTotal, 208);
  assert.equal(proposalPricing.calculateProposal({ ...input, adjustments: quantityEight }).perVisitTotal, 264);
  assert.equal(proposalPricing.calculateProposal({ ...input, adjustments: [] }).perVisitTotal, 200);
});

test("ProposalBuilder wires quantity snapshots into the shared picker", () => {
  const source = readFileSync(new URL("../components/proposals/ProposalBuilder.tsx", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../components/serviceCatalog/CatalogAddonPicker.tsx", import.meta.url), "utf8");
  assert.match(source, /snapshots=\{selectedAddonSnapshots\}/);
  assert.match(source, /setSnapshots=\{\(snapshots\) => setAdjustments/);
  assert.match(source, /quantity: addon\.quantity/);
  assert.match(picker, /Number\.isInteger\(quantity\).*quantity<1/);
});
