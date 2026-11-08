import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserProfile } from "@/types/auth";

export function designatedEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9._%+-]{0,63}@studioscrubz\.com$/.test(email) ? email : null;
}

export class PersonalEmailSetupError extends Error {
  readonly status = 403;
}

export async function resolvePersonalEmailSender(
  profile: Pick<UserProfile, "id" | "display_name" | "email">,
  db = createSupabaseAdminClient(),
) {
  const { data, error } = await db.from("personal_email_settings")
    .select("signature,sender_email").eq("user_id", profile.id).maybeSingle();
  if (error) throw error;
  const email = designatedEmail(data?.sender_email ?? profile.email);
  if (!email) throw new PersonalEmailSetupError("Ask a Master Admin to assign your StudioScrubz sender address in Settings → Email Signature.");
  const name = profile.display_name?.replace(/[\r\n<>"]/g, "").trim().slice(0, 100) || email.split("@")[0];
  return { from: `${name} <${email}>`, replyTo: email, signature: data?.signature ?? "" };
}

export async function resolvePersonalEmailSenderById(id: string, db = createSupabaseAdminClient()) {
  const { data, error } = await db.from("user_profiles").select("id,display_name,email,is_active").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data?.is_active) throw new PersonalEmailSetupError("An active staff profile is required to send email.");
  return resolvePersonalEmailSender(data, db);
}
