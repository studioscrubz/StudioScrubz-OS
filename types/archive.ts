export const ARCHIVE_RECORD_TYPES = [
  "Clients", "Properties", "Estimates", "Walkthroughs", "Proposals", "Jobs",
  "Employees", "Crews", "Invoices", "Expenses", "Vehicles", "Mileage",
  "Time Entries", "Service Agreements", "Services", "Service Add-Ons",
] as const;

export type ArchiveRecordType = (typeof ARCHIVE_RECORD_TYPES)[number];

export type ArchivedRecord = {
  id: string;
  type: ArchiveRecordType;
  label: string;
  relatedName: string | null;
  archivedAt: string;
  status: string;
  href: string;
};

export type ArchiveDeleteCheck = {
  allowed: boolean;
  reason: string | null;
  dependencyCount: number;
};
