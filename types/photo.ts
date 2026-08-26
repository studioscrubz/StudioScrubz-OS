export const OPERATIONAL_PHOTO_BUCKET = "operational-photos";
export const MAX_OPERATIONAL_PHOTO_BYTES = 10 * 1024 * 1024;
export const OPERATIONAL_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

export type OperationalPhotoRecordType = "walkthroughs" | "jobs";
export type WalkthroughPhotoCategory = "General" | "Exterior" | "Interior" | "Kitchen" | "Bathroom" | "Flooring" | "Damage / Concern" | "Other";
export type JobPhotoCategory = "Before" | "After" | "Damage / Issue" | "Other";
export type OperationalPhotoCategory = WalkthroughPhotoCategory | JobPhotoCategory;

export type OperationalPhoto = {
  id: string;
  storagePath: string;
  category: OperationalPhotoCategory;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
  caption: string | null;
  source: "camera" | "library";
  customerVisible: boolean;
};

export type OperationalPhotoWithUrl = OperationalPhoto & { signedUrl: string | null };
export type PendingOperationalPhoto = { id: string; file: File; category: OperationalPhotoCategory; caption: string; source: "camera" | "library"; customerVisible: boolean };

export type InvoiceJobPhoto = {
  id: string;
  invoice_id: string;
  job_id: string;
  job_photo_id: string;
  storage_path: string;
  category: OperationalPhotoCategory | "Pricing";
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  caption: string | null;
  uploaded_at: string;
  uploaded_by: string;
  source: "camera" | "library";
  customer_visible: boolean;
  created_at: string;
};

export type InvoiceJobPhotoWithUrl = InvoiceJobPhoto & { signedUrl: string | null };
