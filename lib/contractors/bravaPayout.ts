// Base partner payouts from BRAVA Exhibit B, expressed in cents.
const payouts: Record<string, Record<string, number>> = {
  "standard cleaning": {
    "0:1": 11300,
    "1:1": 11300,
    "1:1.5": 13050,
    "2:1": 12800,
    "2:1.5": 13550,
    "2:2": 14300,
    "2:2.5": 16050,
    "3:1": 14600,
    "3:1.5": 15450,
    "3:2": 16300,
    "3:2.5": 18050,
    "3:3": 18300,
    "3:3.5": 20050,
    "4:1": 18400,
    "4:1.5": 19100,
    "4:2": 19800,
    "4:2.5": 21550,
    "4:3": 21800,
    "4:3.5": 23550,
    "4:4": 23749,
    "4:4.5": 25499,
    "5:1": 21800,
    "5:1.5": 23550,
    "5:2": 23900,
    "5:2.5": 25650,
    "5:3": 25900,
    "5:3.5": 26900,
    "5:4": 27900,
    "5:4.5": 28900,
    "5:5": 29900,
    "5:5.5": 31650,
  },
  "brazilian deep clean": {
    "1:1": 19300,
    "1:1.5": 21400,
    "2:1": 22300,
    "2:1.5": 24400,
    "2:2": 24800,
    "2:2.5": 26900,
    "3:1": 26200,
    "3:1.5": 27250,
    "3:2": 28300,
    "3:2.5": 30400,
    "3:3": 31300,
    "3:3.5": 33400,
    "4:1": 30800,
    "4:1.5": 32900,
    "4:2": 33800,
    "4:2.5": 35900,
    "4:3": 36800,
    "4:3.5": 38900,
    "4:4": 39950,
    "4:4.5": 42050,
    "5:1": 32500,
    "5:1.5": 34600,
    "5:2": 36700,
    "5:2.5": 38800,
    "5:3": 40900,
    "5:3.5": 43000,
    "5:4": 43450,
    "5:4.5": 45550,
    "5:5": 46530,
    "5:5.5": 48630,
  },
  "move-in / move-out cleaning": {
    "1:1": 21800,
    "1:1.5": 23900,
    "2:1": 24800,
    "2:1.5": 26900,
    "2:2": 27800,
    "2:2.5": 29900,
    "3:1": 28300,
    "3:1.5": 30400,
    "3:2": 31800,
    "3:2.5": 33900,
    "3:3": 34800,
    "3:3.5": 36900,
    "4:1": 34300,
    "4:1.5": 36400,
    "4:2": 38300,
    "4:2.5": 40400,
    "4:3": 41300,
    "4:3.5": 43400,
    "4:4": 44430,
    "4:4.5": 46530,
    "5:1": 37800,
    "5:1.5": 39900,
    "5:2": 42000,
    "5:2.5": 44100,
    "5:3": 46200,
    "5:3.5": 47065,
    "5:4": 47930,
    "5:4.5": 50030,
    "5:5": 51200,
    "5:5.5": 53300,
  },
};

export function bookingClientKind(name: string) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "rose company") return "rose";
  if (/^brava home cleaning(?:,? llc)?$/.test(normalized)) return "brava";
  return null;
}

export function bravaPayout(service: string, bedrooms: unknown, bathrooms: unknown, addOns: string) {
  // Additional services can require quantities or separate approval.
  if (!/^(?:none|no add[- ]ons)$/i.test(addOns.trim())) return null;
  const serviceKey = service.toLowerCase().trim().replace(/\s*\/\s*/g, " / ");
  const bed = String(bedrooms ?? "").trim().toLowerCase();
  const bath = String(bathrooms ?? "").trim();
  if (!/^(?:studio|\d+)$/.test(bed) || !/^\d+(?:\.\d+)?$/.test(bath)) return null;
  const cents = payouts[serviceKey]?.[`${bed === "studio" ? 0 : Number(bed)}:${Number(bath)}`];
  return cents === undefined ? null : cents / 100;
}
