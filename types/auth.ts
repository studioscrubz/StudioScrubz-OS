import type { Session, User } from "@supabase/supabase-js";

export const USER_ROLES = ["Master Admin", "Administrator", "Manager", "Sales", "Crew Lead", "Scrub Technician"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type UserProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: UserRole;
  is_active: boolean;
  employee_id: string | null;
  created_at: string;
  updated_at: string;
};
export type AuthUser = User;
export type AuthState = {
  session: Session | null;
  user: AuthUser | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
};
export type UserProfileInput = {
  auth_user_id: string;
  email: string;
  display_name: string;
  role: UserRole;
  employee_id: string | null;
  is_active: boolean;
};
