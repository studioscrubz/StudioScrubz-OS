import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await createSupabaseServerClient();
    const { data: authData } = await session.auth.getUser();
    const userId = authData.user?.id ?? null;
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });

    const body = await request.json().catch(() => ({})) as {
      endpoint?: unknown; p256dh?: unknown; auth?: unknown; userAgent?: unknown;
    };
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const p256dh = typeof body.p256dh === "string" ? body.p256dh : "";
    const auth = typeof body.auth === "string" ? body.auth : "";
    const userAgent = typeof body.userAgent === "string" ? body.userAgent : null;
    if (!endpoint || !p256dh || !auth) return Response.json({ error: "The browser returned an incomplete push subscription." }, { status: 400 });

    const admin = createSupabaseAdminClient();
    // Reassigns this browser/device's subscription row to the authenticated caller only;
    // the target user_id always comes from the verified session, never from client input.
    const { data, error } = await admin.from("browser_push_subscriptions").upsert({
      user_id: userId, endpoint, p256dh, auth, user_agent: userAgent, revoked_at: null,
    }, { onConflict: "endpoint" }).select().single();
    if (error || !data) throw new Error("Push subscription could not be registered.");
    return Response.json({ subscription: data });
  } catch (cause) {
    console.error("Push subscription registration failed", cause instanceof Error ? cause.message : "Unknown error");
    return Response.json({ error: "Push notifications could not be registered on this browser." }, { status: 500 });
  }
}
