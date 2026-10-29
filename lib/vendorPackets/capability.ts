import type { CorporateCapabilityProfile } from "@/types/corporateCapability";
import { about, cta, disclaimer, intro, modules, process, strengths } from "./content";

export const VENDOR_DOCUMENT_KINDS = ["service-packet", "corporate-capability-statement"] as const;
export type VendorDocumentKind = (typeof VENDOR_DOCUMENT_KINDS)[number];

export const VENDOR_DOCUMENT_VERSIONS = {
  "service-packet": "service-packet-v1",
  "corporate-capability-statement": "corporate-capability-statement-v1",
} as const satisfies Record<VendorDocumentKind, string>;

export const CORPORATE_CAPABILITY_MODULE_LIMIT = 4;

export type CapabilityBusinessIdentity = {
  name: string;
  tagline: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  contactName: string | null;
  contactTitle: string | null;
};

export type CapabilityCoreCompetency = {
  id: string;
  title: string;
  bullets: readonly string[];
  note: string | null;
};

export type CapabilityDataEntry = { label: string; value: string };
export type CapabilityProcessStep = { title: string; copy: string };

export type CapabilityContentSnapshot = {
  schemaVersion: 1;
  documentKind: VendorDocumentKind;
  documentVersion: string;
  title: string;
  summary: string;
  preparedFor: string;
  propertyLabel: string | null;
  business: CapabilityBusinessIdentity;
  overview: readonly string[];
  coreCompetencies: readonly CapabilityCoreCompetency[];
  process: readonly CapabilityProcessStep[];
  differentiators: readonly string[];
  pastPerformance: readonly string[];
  corporateData: readonly CapabilityDataEntry[];
  serviceAreas: readonly string[];
  closing: string | null;
  disclaimer: string;
  selectedModuleIds: readonly string[];
};

export type CapabilityStatementModel = CapabilityContentSnapshot & {
  contentSnapshot: Readonly<CapabilityContentSnapshot>;
};

export type BuildCapabilityStatementInput = {
  documentKind?: VendorDocumentKind;
  clientName: string;
  propertyLabel?: string | null;
  business: {
    name: string;
    tagline?: string | null;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    address?: string | null;
  };
  corporateProfile?: CorporateCapabilityProfile | null;
  moduleIds: readonly string[];
};

export class CapabilityModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityModelError";
  }
}

export function normalizeDocumentKind(value: unknown): VendorDocumentKind {
  if (value == null || value === "") return "service-packet";
  if (value === "service-packet" || value === "corporate-capability-statement") return value;
  throw new CapabilityModelError("Select a valid vendor document type.");
}

export function validateSelectedModuleIds(documentKind: VendorDocumentKind, values: unknown): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.some(value => typeof value !== "string")) {
    throw new CapabilityModelError("Select at least one valid capability module.");
  }
  const requested = values as string[];
  const unique = new Set(requested);
  if (unique.size !== requested.length || requested.some(id => !modules.some(module => module.id === id))) {
    throw new CapabilityModelError("Select valid capability modules without duplicates.");
  }
  if (documentKind === "corporate-capability-statement" && requested.length > CORPORATE_CAPABILITY_MODULE_LIMIT) {
    throw new CapabilityModelError(`Select no more than ${CORPORATE_CAPABILITY_MODULE_LIMIT} capability modules for a Corporate Capability Statement.`);
  }
  if (requested.length > modules.length) throw new CapabilityModelError("Select valid capability modules.");
  return modules.filter(module => unique.has(module.id)).map(module => module.id);
}

export function buildCapabilityStatementModel(input: Omit<BuildCapabilityStatementInput, "documentKind">): CapabilityStatementModel {
  return buildVendorCapabilityDocumentModel({ ...input, documentKind: "corporate-capability-statement" });
}

export function buildVendorCapabilityDocumentModel(input: BuildCapabilityStatementInput): CapabilityStatementModel {
  const documentKind = normalizeDocumentKind(input.documentKind);
  const selectedModuleIds = validateSelectedModuleIds(documentKind, input.moduleIds);
  const preparedFor = requiredText(input.clientName, "A client name is required.");
  const businessName = requiredText(input.business.name, "A business name is required.");
  const profile = cleanProfile(input.corporateProfile);
  const coreCompetencies = modules
    .filter(module => selectedModuleIds.includes(module.id))
    .map(module => ({
      id: module.id,
      title: module.title,
      bullets: module.bullets.map(clean).filter(Boolean).slice(0, documentKind === "corporate-capability-statement" ? 5 : undefined),
      note: documentKind === "corporate-capability-statement" ? null : cleanOrNull(module.note),
    }));
  const business: CapabilityBusinessIdentity = {
    name: businessName,
    tagline: cleanOrNull(input.business.tagline),
    email: cleanOrNull(input.business.email),
    phone: cleanOrNull(input.business.phone),
    website: cleanOrNull(input.business.website),
    address: cleanOrNull(input.business.address),
    contactName: profile ? cleanOrNull(profile.contactName) : null,
    contactTitle: profile ? cleanOrNull(profile.contactTitle) : null,
  };
  const statement = documentKind === "corporate-capability-statement";
  const corporateData = statement && profile ? compactEntries([
    { label: "Unique Entity ID (UEI)", value: profile.uei },
    { label: "CAGE Code", value: profile.cageCode },
    { label: "NAICS Codes", value: cleanList(profile.naicsCodes).join(", ") },
    { label: "Certifications", value: cleanList(profile.certifications).join(", ") },
  ]) : [];
  const overview = statement
    ? (profile && clean(profile.overview) ? [clean(profile.overview)] : [...intro])
    : [...intro, ...about];
  const snapshot: CapabilityContentSnapshot = {
    schemaVersion: 1,
    documentKind,
    documentVersion: VENDOR_DOCUMENT_VERSIONS[documentKind],
    title: documentTitle(documentKind),
    summary: documentSummary(documentKind, coreCompetencies.length),
    preparedFor,
    propertyLabel: cleanOrNull(input.propertyLabel),
    business,
    overview,
    coreCompetencies,
    process: statement ? [] : process.map(step => ({ title: step.title, copy: step.copy })),
    differentiators: statement && profile
      ? cleanList(profile.differentiators)
      : strengths.map(item => `${item.title}: ${item.copy}`),
    pastPerformance: statement && profile ? cleanList(profile.pastPerformance) : [],
    corporateData,
    serviceAreas: statement && profile && clean(profile.serviceAreas) ? [clean(profile.serviceAreas)] : [],
    closing: statement ? null : cta,
    disclaimer,
    selectedModuleIds,
  };
  const contentSnapshot = freezeSnapshot(snapshot);
  return Object.freeze({ ...contentSnapshot, contentSnapshot });
}

export function capabilityModelFromSnapshot(value: unknown): CapabilityStatementModel {
  const snapshot = readSnapshot(value);
  const contentSnapshot = freezeSnapshot(snapshot);
  return Object.freeze({ ...contentSnapshot, contentSnapshot });
}

export function documentTitle(kind: VendorDocumentKind): string {
  return kind === "corporate-capability-statement"
    ? "Corporate Capability Statement"
    : "Professional Cleaning & Property Service Capabilities";
}

export function documentSummary(kind: VendorDocumentKind, moduleCount: number): string {
  const count = Number.isInteger(moduleCount) && moduleCount > 0 ? moduleCount : 0;
  const capabilities = `${count} selected service ${count === 1 ? "capability" : "capabilities"}`;
  return kind === "corporate-capability-statement" ? `Corporate qualifications and ${capabilities}` : `Service overview with ${capabilities}`;
}

function cleanProfile(value: CorporateCapabilityProfile | null | undefined): CorporateCapabilityProfile | null {
  if (!value || value.version !== 1) return null;
  return value;
}

function readSnapshot(value: unknown): CapabilityContentSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new CapabilityModelError("The saved vendor document snapshot is invalid.");
  const documentKind = normalizeDocumentKind(value.documentKind);
  if (value.documentVersion !== VENDOR_DOCUMENT_VERSIONS[documentKind]) throw new CapabilityModelError("The saved vendor document version is unsupported.");
  const selectedModuleIds = validateSelectedModuleIds(documentKind, value.selectedModuleIds);
  const coreCompetencies = recordArray(value.coreCompetencies).map(entry => ({
    id: requiredText(entry.id, "The saved capability module is invalid."),
    title: requiredText(entry.title, "The saved capability module is invalid."),
    bullets: stringArray(entry.bullets),
    note: nullableString(entry.note),
  }));
  if (coreCompetencies.length !== selectedModuleIds.length || coreCompetencies.some((entry, index) => entry.id !== selectedModuleIds[index])) {
    throw new CapabilityModelError("The saved capability modules do not match the document snapshot.");
  }
  const businessValue = value.business;
  if (!isRecord(businessValue)) throw new CapabilityModelError("The saved business identity is invalid.");
  return {
    schemaVersion: 1,
    documentKind,
    documentVersion: VENDOR_DOCUMENT_VERSIONS[documentKind],
    title: requiredText(value.title, "The saved document title is invalid."),
    summary: requiredText(value.summary, "The saved document summary is invalid."),
    preparedFor: requiredText(value.preparedFor, "The saved client name is invalid."),
    propertyLabel: nullableString(value.propertyLabel),
    business: {
      name: requiredText(businessValue.name, "The saved business identity is invalid."),
      tagline: nullableString(businessValue.tagline),
      email: nullableString(businessValue.email),
      phone: nullableString(businessValue.phone),
      website: nullableString(businessValue.website),
      address: nullableString(businessValue.address),
      contactName: nullableString(businessValue.contactName),
      contactTitle: nullableString(businessValue.contactTitle),
    },
    overview: stringArray(value.overview),
    coreCompetencies,
    process: recordArray(value.process).map(entry => ({
      title: requiredText(entry.title, "The saved process step is invalid."),
      copy: requiredText(entry.copy, "The saved process step is invalid."),
    })),
    differentiators: stringArray(value.differentiators),
    pastPerformance: stringArray(value.pastPerformance),
    corporateData: recordArray(value.corporateData).map(entry => ({
      label: requiredText(entry.label, "The saved corporate data is invalid."),
      value: requiredText(entry.value, "The saved corporate data is invalid."),
    })),
    serviceAreas: stringArray(value.serviceAreas),
    closing: nullableString(value.closing),
    disclaimer: requiredText(value.disclaimer, "The saved document disclaimer is invalid."),
    selectedModuleIds,
  };
}

function freezeSnapshot(snapshot: CapabilityContentSnapshot): Readonly<CapabilityContentSnapshot> {
  Object.freeze(snapshot.business);
  snapshot.coreCompetencies.forEach(entry => { Object.freeze(entry.bullets); Object.freeze(entry); });
  snapshot.process.forEach(Object.freeze);
  snapshot.corporateData.forEach(Object.freeze);
  Object.freeze(snapshot.overview);
  Object.freeze(snapshot.coreCompetencies);
  Object.freeze(snapshot.process);
  Object.freeze(snapshot.differentiators);
  Object.freeze(snapshot.pastPerformance);
  Object.freeze(snapshot.corporateData);
  Object.freeze(snapshot.serviceAreas);
  Object.freeze(snapshot.selectedModuleIds);
  return Object.freeze(snapshot);
}

function compactEntries(values: Array<{ label: string; value: string | null | undefined }>): CapabilityDataEntry[] {
  return values.map(entry => ({ label: clean(entry.label), value: clean(entry.value) })).filter(entry => entry.label && entry.value);
}
function cleanList(values: readonly string[] | null | undefined): string[] { return Array.isArray(values) ? values.map(clean).filter(Boolean) : []; }
function clean(value: string | null | undefined): string { return typeof value === "string" ? value.trim() : ""; }
function cleanOrNull(value: string | null | undefined): string | null { return clean(value) || null; }
function requiredText(value: unknown, message: string): string { if (typeof value !== "string" || !value.trim()) throw new CapabilityModelError(message); return value.trim(); }
function nullableString(value: unknown): string | null { if (value == null || value === "") return null; if (typeof value !== "string") throw new CapabilityModelError("The saved vendor document snapshot is invalid."); return value.trim() || null; }
function stringArray(value: unknown): string[] { if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) throw new CapabilityModelError("The saved vendor document snapshot is invalid."); return value.map(item => (item as string).trim()); }
function recordArray(value: unknown): Record<string, unknown>[] { if (!Array.isArray(value) || value.some(item => !isRecord(item))) throw new CapabilityModelError("The saved vendor document snapshot is invalid."); return value as Record<string, unknown>[]; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
