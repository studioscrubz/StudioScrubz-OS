export type CorporateCapabilityProfile = {
  version: 1;
  overview: string;
  differentiators: string[];
  pastPerformance: string[];
  naicsCodes: string[];
  certifications: string[];
  uei: string;
  cageCode: string;
  serviceAreas: string;
  contactName: string;
  contactTitle: string;
};

export const CORPORATE_CAPABILITY_LIMITS = {
  totalBytes: 32_768,
  overview: 2_500,
  differentiators: { count: 12, item: 300 },
  pastPerformance: { count: 12, item: 500 },
  naicsCodes: { count: 20, item: 6 },
  certifications: { count: 20, item: 160 },
  serviceAreas: 1_000,
  contactName: 120,
  contactTitle: 120,
} as const;

const profileKeys: Array<keyof CorporateCapabilityProfile> = [
  "version",
  "overview",
  "differentiators",
  "pastPerformance",
  "naicsCodes",
  "certifications",
  "uei",
  "cageCode",
  "serviceAreas",
  "contactName",
  "contactTitle",
];

export function emptyCorporateCapabilityProfile(): CorporateCapabilityProfile {
  return {
    version: 1,
    overview: "",
    differentiators: [],
    pastPerformance: [],
    naicsCodes: [],
    certifications: [],
    uei: "",
    cageCode: "",
    serviceAreas: "",
    contactName: "",
    contactTitle: "",
  };
}

export function validateCorporateCapabilityProfile(input: unknown): CorporateCapabilityProfile {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("The corporate capability profile must be an object.");
  }

  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== profileKeys.length || keys.some((key) => !profileKeys.includes(key as keyof CorporateCapabilityProfile))) {
    throw new Error("The corporate capability profile contains an unsupported or missing field.");
  }
  if (record.version !== 1) throw new Error("The corporate capability profile version is unsupported.");

  const overview = normalizedText(record.overview, "Overview", CORPORATE_CAPABILITY_LIMITS.overview);
  const differentiators = normalizedList(record.differentiators, "Differentiators", CORPORATE_CAPABILITY_LIMITS.differentiators.count, CORPORATE_CAPABILITY_LIMITS.differentiators.item);
  const pastPerformance = normalizedList(record.pastPerformance, "Past performance", CORPORATE_CAPABILITY_LIMITS.pastPerformance.count, CORPORATE_CAPABILITY_LIMITS.pastPerformance.item);
  const naicsCodes = normalizedList(record.naicsCodes, "NAICS codes", CORPORATE_CAPABILITY_LIMITS.naicsCodes.count, CORPORATE_CAPABILITY_LIMITS.naicsCodes.item);
  const certifications = normalizedList(record.certifications, "Certifications", CORPORATE_CAPABILITY_LIMITS.certifications.count, CORPORATE_CAPABILITY_LIMITS.certifications.item);
  const uei = normalizedText(record.uei, "UEI", 12).toUpperCase();
  const cageCode = normalizedText(record.cageCode, "CAGE code", 5).toUpperCase();
  const serviceAreas = normalizedText(record.serviceAreas, "Service areas", CORPORATE_CAPABILITY_LIMITS.serviceAreas);
  const contactName = normalizedText(record.contactName, "Contact name", CORPORATE_CAPABILITY_LIMITS.contactName);
  const contactTitle = normalizedText(record.contactTitle, "Contact title", CORPORATE_CAPABILITY_LIMITS.contactTitle);

  if (naicsCodes.some((code) => !/^\d{2,6}$/.test(code))) {
    throw new Error("Each NAICS code must contain 2 to 6 digits.");
  }
  if (uei && !/^[A-Z0-9]{12}$/.test(uei)) throw new Error("UEI must contain exactly 12 letters or numbers.");
  if (cageCode && !/^[A-Z0-9]{5}$/.test(cageCode)) throw new Error("CAGE code must contain exactly 5 letters or numbers.");

  const profile: CorporateCapabilityProfile = {
    version: 1,
    overview,
    differentiators,
    pastPerformance,
    naicsCodes,
    certifications,
    uei,
    cageCode,
    serviceAreas,
    contactName,
    contactTitle,
  };
  if (new TextEncoder().encode(JSON.stringify(profile)).byteLength > CORPORATE_CAPABILITY_LIMITS.totalBytes) {
    throw new Error("The corporate capability profile is too large.");
  }
  return profile;
}

function normalizedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return normalized;
}

function normalizedList(value: unknown, label: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  if (value.length > maxItems) throw new Error(`${label} may contain no more than ${maxItems} items.`);
  const normalized = value.map((item, index) => {
    if (typeof item !== "string") throw new Error(`${label} item ${index + 1} must be text.`);
    const text = item.trim();
    if (!text) throw new Error(`${label} item ${index + 1} cannot be blank.`);
    if (text.length > maxLength) throw new Error(`${label} item ${index + 1} must be ${maxLength} characters or fewer.`);
    return text;
  });
  if (new Set(normalized.map((item) => item.toLocaleLowerCase())).size !== normalized.length) {
    throw new Error(`${label} cannot contain duplicate items.`);
  }
  return normalized;
}
