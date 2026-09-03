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
    // The target user_id always comes from the verified session, never from client input.
    const { data: existing, error: lookupError } = await admin.from("browser_push_subscriptions").select("id,user_id").eq("endpoint", endpoint).maybeSingle();
    if (lookupError) throw new Error("Push subscription could not be registered.");

    if (!existing || existing.user_id === userId) {
      const { data, error } = await admin.from("browser_push_subscriptions").upsert({
        user_id: userId, endpoint, p256dh, auth, user_agent: userAgent, revoked_at: null,
      }, { onConflict: "endpoint" }).select().single();
      if (error || !data) throw new Error("Push subscription could not be registered.");
      return Response.json({ subscription: data });
    }

    // A different user still owns this physical browser/device endpoint. Reassigning user_id in
    // place would violate the composite FK from messaging_push_deliveries(subscription_id, user_id),
    // so the old row is retired first; ON DELETE CASCADE clears its historical delivery rows,
    // then a fresh row is inserted for the current authenticated user on the same endpoint.
    const { error: deleteError } = await admin.from("browser_push_subscriptions").delete().eq("id", existing.id);
    if (deleteError) throw new Error("Push subscription could not be registered.");

    const { data, error } = await admin.from("browser_push_subscriptions").insert({
      user_id: userId, endpoint, p256dh, auth, user_agent: userAgent, revoked_at: null,
    }).select().single();
    if (error || !data) throw new Error("Push subscription could not be registered.");
    return Response.json({ subscription: data });
  } catch (cause) {
    console.error("Push subscription registration failed", cause instanceof Error ? cause.message : "Unknown error");
    return Response.json({ error: "Push notifications could not be registered on this browser." }, { status: 500 });
  }
}
