import { designatedEmail } from "@/lib/email/personalSender";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function authenticatedProfile() {
  const session = await createSupabaseServerClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return null;
  const { data, error } = await session.from("user_profiles").select("id,email,role,is_active").eq("id", user.id).maybeSingle();
  if (error) throw error;
  return data?.is_active ? data : null;
}

const privateResponse = { headers: { "Cache-Control": "private, no-store" } };

export async function GET() {
  try {
    const profile = await authenticatedProfile();
    if (!profile) return Response.json({ error: "An active OS account is required." }, { status: 403 });
    const db = createSupabaseAdminClient();
    const { data, error } = await db.from("personal_email_settings").select("signature,sender_email").eq("user_id", profile.id).maybeSingle();
    if (error) throw error;
    let accounts: Array<{ id: string; label: string; profileEmail: string | null; override: string | null }> = [];
    if (profile.role === "Master Admin") {
      const [profiles, settings] = await Promise.all([
        db.from("user_profiles").select("id,display_name,email").eq("is_active", true).order("display_name"),
        db.from("personal_email_settings").select("user_id,sender_email"),
      ]);
      if (profiles.error || settings.error) throw profiles.error ?? settings.error;
      const overrides = new Map(settings.data.map(row => [row.user_id, row.sender_email]));
      accounts = profiles.data.map(row => ({ id: row.id, label: row.display_name || row.email || row.id,
        profileEmail: designatedEmail(row.email), override: overrides.get(row.id) ?? null }));
    }
    return Response.json({ signature: data?.signature ?? "", senderEmail: designatedEmail(data?.sender_email ?? profile.email), accounts }, privateResponse);
  } catch {
    return Response.json({ error: "Email settings could not be loaded." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const profile = await authenticatedProfile();
    if (!profile) return Response.json({ error: "An active OS account is required." }, { status: 403 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return Response.json({ error: "Invalid email settings." }, { status: 400 });
    const db = createSupabaseAdminClient();
    if (body.action === "signature") {
      if (typeof body.signature !== "string" || body.signature.length > 2000)
        return Response.json({ error: "Use a signature of 2,000 characters or fewer." }, { status: 400 });
      const { error } = await db.from("personal_email_settings").upsert({ user_id: profile.id, signature: body.signature.trim() }, { defaultToNull: false });
      if (error) throw error;
    } else if (body.action === "sender") {
      if (profile.role !== "Master Admin") return Response.json({ error: "Master Admin access is required." }, { status: 403 });
      if (typeof body.userId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.userId) || typeof body.senderEmail !== "string")
        return Response.json({ error: "Choose a user and enter a StudioScrubz email address." }, { status: 400 });
      const sender = designatedEmail(body.senderEmail);
      if (body.senderEmail.trim() && !sender)
        return Response.json({ error: "Use a valid @studioscrubz.com address." }, { status: 400 });
      const { data, error: profileError } = await db.from("user_profiles").select("id").eq("id", body.userId).eq("is_active", true).maybeSingle();
      if (profileError) throw profileError;
      if (!data) return Response.json({ error: "Choose an active OS user." }, { status: 404 });
      const { error } = await db.from("personal_email_settings").upsert({ user_id: data.id, sender_email: sender }, { defaultToNull: false });
      if (error) throw error;
    } else {
      return Response.json({ error: "Invalid email settings action." }, { status: 400 });
    }
    return Response.json({ ok: true }, privateResponse);
  } catch {
    return Response.json({ error: "Email settings could not be saved." }, { status: 503 });
  }
}
