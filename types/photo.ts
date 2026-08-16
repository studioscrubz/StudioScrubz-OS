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
};

export type OperationalPhotoWithUrl = OperationalPhoto & { signedUrl: string | null };
export type PendingOperationalPhoto = { id: string; file: File; category: OperationalPhotoCategory; caption: string; source: "camera" | "library" };
