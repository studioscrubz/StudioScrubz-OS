import type { UserProfile } from "@/types/auth";

export function isMasterAdmin(profile: UserProfile | null): boolean { return profile?.is_active === true && profile.role === "Master Admin"; }
export const canAccessFinances = isMasterAdmin;
export const canAccessPayrollPrep = isMasterAdmin;
export const canAccessArchives = isMasterAdmin;
export const canPermanentlyDelete = isMasterAdmin;
export const canManageSystem = isMasterAdmin;
