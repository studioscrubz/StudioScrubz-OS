import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendWebPush, webPushStatus } from "@/lib/push/server";
import { sendVerifiedTestNotification, TestPushError } from "@/lib/push/testNotification";
import type { BrowserPushSubscription } from "@/types/pushNotification";

export const runtime = "nodejs";
const recent = new Map<string, number>();
export async function POST(request: Request) {
  try {
    const session = await createSupabaseServerClient(); const { data: authData } = await session.auth.getUser();
    const body = await request.json().catch(() => ({})) as { endpoint?: unknown }; const endpoint = typeof body.endpoint === "string" ? body.endpoint : ""; const userId = authData.user?.id ?? null;
    if (!userId) throw new TestPushError("Authentication required.", 401);
    enforceRateLimit(`${userId}:${endpoint}`);
    const admin = createSupabaseAdminClient();
    await sendVerifiedTestNotification({ userId, endpoint,
      async loadSubscription(ownerId, currentEndpoint) { const { data } = await admin.from("browser_push_subscriptions").select("*").eq("user_id", ownerId).eq("endpoint", currentEndpoint).maybeSingle(); return data as BrowserPushSubscription | null; },
      send: sendWebPush,
      async revoke(id) { await admin.from("browser_push_subscriptions").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId); },
      failureStatus: webPushStatus,
    });
    return Response.json({ ok: true });
  } catch (cause) { const status = cause instanceof TestPushError ? cause.status : 500; const message = cause instanceof TestPushError ? cause.message : "Test notification could not be sent."; if (status === 500) console.error("Test push failed", cause instanceof Error ? cause.message : "Unknown error"); return Response.json({ error: message }, { status }); }
}
function enforceRateLimit(key: string) { const now = Date.now(), previous = recent.get(key) ?? 0; if (now - previous < 15_000) throw new TestPushError("Please wait before sending another test notification.", 429); recent.set(key, now); if (recent.size > 500) for (const [entry, time] of recent) if (now - time > 60_000) recent.delete(entry); }
