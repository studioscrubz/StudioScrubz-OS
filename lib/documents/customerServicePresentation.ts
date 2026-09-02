type AddonLike = { label: string; catalogAddonId?: string | null };

export function addonDisplayLabel(addon: AddonLike & { quantity?: number; unitName?: string | null; unitPrice?: number }): string {
  if (!addon.quantity || !addon.unitName || addon.unitPrice === undefined) return addon.label;
  return `${addon.label} - ${addon.quantity} ${addon.unitName}${addon.quantity === 1 ? "" : "s"} x $${addon.unitPrice.toFixed(2)}`;
}

function comparable(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function catalogAddons<T extends AddonLike>(adjustments: T[]): T[] {
  return adjustments.filter((item) => Boolean(item.catalogAddonId));
}

export function includedServiceDetails(
  scope: string[],
  serviceName: string,
  adjustments: AddonLike[],
): string[] {
  const service = comparable(serviceName);
  const serviceBase = comparable(serviceName.replace(/\s+cleaning$/i, ""));
  const redundant = new Set<string>([
    service,
    comparable(`${serviceBase} cleaning`),
    comparable(`${serviceBase} residential cleaning`),
    comparable(`${serviceBase} commercial cleaning`),
    comparable(`${serviceName} residential cleaning`),
    comparable(`${serviceName} commercial cleaning`),
    ...adjustments.flatMap((item) => [
      comparable(item.label),
      comparable(`Add-On: ${item.label}`),
    ]),
  ]);

  return scope.map((item) => item.trim()).filter((item) => item && !redundant.has(comparable(item)));
}
