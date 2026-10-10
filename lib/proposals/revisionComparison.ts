import type { PublicProposal } from "@/types/publicProposal";

export type ProposalRevisionChange = {
  category: "Service" | "Add-on" | "Discount" | "Frequency" | "Scope" | "Price";
  kind: "Added" | "Removed" | "Modified";
  label: string;
  previous?: string;
  current?: string;
  amountDelta?: number;
};

export function compareProposalRevisions(
  previous: PublicProposal,
  current: PublicProposal,
): ProposalRevisionChange[] {
  const changes: ProposalRevisionChange[] = [];
  changed(changes, "Service", "Service", previous.service_name, current.service_name);
  changed(changes, "Service", "Description", previous.service_description ?? "", current.service_description ?? "");
  changed(changes, "Frequency", "Frequency", previous.frequency, current.frequency);
  moneyChanged(changes, "Price", "Base service price", previous.base_price ?? previous.per_visit_total, current.base_price ?? current.per_visit_total);
  moneyChanged(changes, "Discount", "Recurring discount", previous.recurring_discount_amount ?? 0, current.recurring_discount_amount ?? 0);
  moneyChanged(changes, "Discount", "Manual / custom discount", previous.manual_discount ?? previous.discount, current.manual_discount ?? current.discount);

  const previousAdjustments = keyed(previous.adjustments, (item) => item.catalogAddonId || normalize(item.label));
  const currentAdjustments = keyed(current.adjustments, (item) => item.catalogAddonId || normalize(item.label));
  for (const key of new Set([...previousAdjustments.keys(), ...currentAdjustments.keys()])) {
    const before = previousAdjustments.get(key);
    const after = currentAdjustments.get(key);
    if (!before && after) changes.push({ category: "Add-on", kind: "Added", label: after.label, current: money(after.amount), amountDelta: after.amount });
    else if (before && !after) changes.push({ category: "Add-on", kind: "Removed", label: before.label, previous: money(before.amount), amountDelta: -before.amount });
    else if (before && after && (before.amount !== after.amount || before.label !== after.label)) changes.push({ category: "Add-on", kind: "Modified", label: after.label, previous: money(before.amount), current: money(after.amount), amountDelta: after.amount - before.amount });
  }

  const previousScope = keyed(previous.scope, (item) => item.id || normalize(item.text));
  const currentScope = keyed(current.scope, (item) => item.id || normalize(item.text));
  for (const key of new Set([...previousScope.keys(), ...currentScope.keys()])) {
    const before = previousScope.get(key);
    const after = currentScope.get(key);
    if (!before && after) changes.push({ category: "Scope", kind: "Added", label: after.text });
    else if (before && !after) changes.push({ category: "Scope", kind: "Removed", label: before.text });
    else if (before && after && before.text !== after.text) changes.push({ category: "Scope", kind: "Modified", label: "Scope item", previous: before.text, current: after.text });
  }

  moneyChanged(changes, "Price", "Final per-visit total", previous.per_visit_total, current.per_visit_total);
  return changes;
}

function keyed<T>(items: T[], key: (item: T) => string) {
  return new Map(items.map((item) => [key(item), item]));
}
function normalize(value: string) { return value.trim().toLowerCase(); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
function changed(changes: ProposalRevisionChange[], category: ProposalRevisionChange["category"], label: string, previous: string, current: string) {
  if (previous !== current) changes.push({ category, kind: "Modified", label, previous, current });
}
function moneyChanged(changes: ProposalRevisionChange[], category: ProposalRevisionChange["category"], label: string, previous: number, current: number) {
  if (previous !== current) changes.push({ category, kind: "Modified", label, previous: money(previous), current: money(current), amountDelta: current - previous });
}
