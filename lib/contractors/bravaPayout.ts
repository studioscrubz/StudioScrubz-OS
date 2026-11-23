// BRAVA Exhibit B, effective November 23, 2026. Amounts are in cents.
export const BRAVA_RATE_EFFECTIVE_DATE = "2026-11-23";

const payouts: Record<string, Record<string, number>> = {
  standard: {
    "1:1": 11300,
    "1:1.5": 13050,
    "1:2": 14800,
    "2:1": 12800,
    "2:1.5": 13550,
    "2:2": 14300,
    "2:2.5": 16050,
    "2:3": 17800,
    "3:1": 14600,
    "3:1.5": 15450,
    "3:2": 16300,
    "3:2.5": 18050,
    "3:3": 18300,
    "3:3.5": 20050,
    "3:4": 21800,
    "4:1": 18400,
    "4:1.5": 19100,
    "4:2": 19800,
    "4:2.5": 21550,
    "4:3": 21800,
    "4:3.5": 23550,
    "4:4": 23749,
    "4:4.5": 25499,
    "4:5": 27249,
    "5:1": 21800,
    "5:1.5": 23550,
    "5:2": 23900,
    "5:2.5": 25650,
    "5:3": 25900,
    "5:3.5": 26900,
    "5:4": 27900,
    "5:4.5": 28900,
    "5:5": 29900,
  },
  deep: {
    "1:1": 19300,
    "1:1.5": 21400,
    "1:2": 23500,
    "2:1": 22300,
    "2:1.5": 24400,
    "2:2": 24800,
    "2:2.5": 26900,
    "2:3": 29000,
    "3:1": 26200,
    "3:1.5": 27250,
    "3:2": 28300,
    "3:2.5": 30400,
    "3:3": 31300,
    "3:3.5": 33400,
    "3:4": 35500,
    "4:1": 30800,
    "4:1.5": 32900,
    "4:2": 33800,
    "4:2.5": 35900,
    "4:3": 36800,
    "4:3.5": 38900,
    "4:4": 39950,
    "4:4.5": 42050,
    "4:5": 44200,
    "5:1": 32500,
    "5:1.5": 34600,
    "5:2": 36700,
    "5:2.5": 38800,
    "5:3": 40900,
    "5:3.5": 43000,
    "5:4": 43450,
    "5:4.5": 45550,
    "5:5": 46530,
  },
  move: {
    "1:1": 21800,
    "1:1.5": 23900,
    "1:2": 26000,
    "2:1": 24800,
    "2:1.5": 26900,
    "2:2": 27800,
    "2:2.5": 29900,
    "2:3": 32000,
    "3:1": 28300,
    "3:1.5": 30400,
    "3:2": 31800,
    "3:2.5": 33900,
    "3:3": 34800,
    "3:3.5": 36900,
    "3:4": 39000,
    "4:1": 34300,
    "4:1.5": 36400,
    "4:2": 38300,
    "4:2.5": 40400,
    "4:3": 41300,
    "4:3.5": 43400,
    "4:4": 44430,
    "4:4.5": 46530,
    "4:5": 48630,
    "5:1": 37800,
    "5:1.5": 39900,
    "5:2": 42000,
    "5:2.5": 44100,
    "5:3": 46200,
    "5:3.5": 47065,
    "5:4": 47930,
    "5:4.5": 50030,
    "5:5": 51200,
  },
};

export function bookingClientKind(name: string) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "rose company") return "rose";
  if (/^brava home cleaning(?:,? llc)?$/.test(normalized)) return "brava";
  return null;
}

type PayoutLine = { label: string; cents: number };

const tiers = {
  windows: [2800, 5600, 8400],
  blinds: [2100, 4900, 7700],
};

function tierIndex(low: number, high: number) {
  if (low < 1 || low > high) return -1;
  if (high <= 6) return 0;
  if (low >= 7 && high <= 10) return 1;
  if (low >= 11 && high <= 15) return 2;
  if (low >= 16 && high <= 20) return 3;
  return -1;
}

function bravaAddOn(text: string, category: string) {
  const included = category === "move";
  if (/^(?:brava\s+)?appliance special(?:\s*[-–—:]\s*(?:inside\s+)?oven\s*(?:\+|and|&)\s*(?:inside\s+)?(?:refrigerator|fridge))?$/.test(text))
    return { keys: ["oven", "fridge"], label: "Appliance Special", cents: included ? 0 : 6500 };
  if (/^(?:inside\s+)?oven(?:\s+(?:interior|cleaning))?$/.test(text))
    return { keys: ["oven"], label: "Inside oven", cents: included ? 0 : 3500 };
  if (/^(?:inside\s+)?(?:refrigerator|fridge)(?:\s+(?:interior|cleaning))?$/.test(text))
    return { keys: ["fridge"], label: "Inside refrigerator", cents: included ? 0 : 3000 };
  if (/^balcony glass(?: cleaning)?$/.test(text))
    return { keys: ["balcony"], label: "Balcony glass", cents: 1400 };

  const quantity = "(\\d+)(?:\\s*[-–—]\\s*(\\d+))?";
  const item = "(interior windows?|(?:detailed )?blinds?)";
  const after = text.match(new RegExp(`^${item}(?:\\s+cleaning)?\\s*[:(]?\\s*${quantity}\\)?$`));
  const before = text.match(new RegExp(`^${quantity}\\s*(?:x\\s*)?${item}$`));
  if (!after && !before) return null;
  const name = after?.[1] ?? before?.[3] ?? "";
  const low = Number(after?.[2] ?? before?.[1]);
  const high = Number(after?.[3] ?? before?.[2] ?? low);
  const index = tierIndex(low, high);
  if (index < 0) return null;
  const key = name.includes("window") ? "windows" : "blinds";
  if (index === 0 && category === "standard") return null;
  const label = key === "windows" ? "Interior windows" : "Detailed blinds";
  return { keys: [key], label, cents: included || index === 0 ? 0 : tiers[key][index - 1] };
}

export function bravaPayout(service: string, bedrooms: unknown, bathrooms: unknown, addOns: string, serviceDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || serviceDate < BRAVA_RATE_EFFECTIVE_DATE) return null;
  const serviceKey = service.toLowerCase().trim().replace(/[–—]/g, "-").replace(/\s*\/\s*/g, " / ");
  const category = /^standard clean(?:ing)?$/.test(serviceKey) ? "standard"
    : /^(?:brazilian )?deep clean(?:ing)?$/.test(serviceKey) ? "deep"
    : /^move[- ](?:in(?: \/ move[- ]out)?|out) clean(?:ing)?$/.test(serviceKey) ? "move" : null;
  const bed = String(bedrooms ?? "").trim();
  const bath = String(bathrooms ?? "").trim();
  if (!category || !/^\d+$/.test(bed) || !/^\d+(?:\.\d+)?$/.test(bath)) return null;
  const base = payouts[category][`${Number(bed)}:${Number(bath)}`];
  if (base === undefined) return null;

  const lines: PayoutLine[] = [{ label: service.trim(), cents: base }];
  const extras = addOns.trim().toLowerCase();
  if (!/^(?:none|n\/a|no add[- ]?ons|)$/.test(extras)) {
    const seen = new Set<string>();
    for (const text of extras.split(/[,;\n]+/)) {
      const addOn = bravaAddOn(text.trim(), category);
      if (!addOn || addOn.keys.some(key => seen.has(key))) return null;
      addOn.keys.forEach(key => seen.add(key));
      lines.push({ label: addOn.label, cents: addOn.cents });
    }
  }
  return { lines, total: lines.reduce((sum, line) => sum + line.cents, 0) / 100 };
}
