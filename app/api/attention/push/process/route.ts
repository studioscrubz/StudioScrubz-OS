import { processAttentionPushesBestEffort } from "@/lib/push/immediate";
import { handleImmediateAttentionPush } from "@/lib/push/immediateRoute";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MINIMUM_INTERVAL_MS = 5_000;
const lastInvocationByUser = new Map<string, number>();

export async function POST() {
  return handleImmediateAttentionPush({
    authenticate: authenticateActiveUser,
    process: processAttentionPushesBestEffort,
    allow: allowImmediateProcessing,
  });
}

async function authenticateActiveUser(): Promise<{ userId: string } | null> {
  const session = await createSupabaseServerClient();
  const { data: authData } = await session.auth.getUser();
  if (!authData.user) return null;

  const { data: profile, error } = await session
    .from("user_profiles")
    .select("id,is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (error || !profile?.is_active) return null;
  return { userId: authData.user.id };
}

function allowImmediateProcessing(userId: string): boolean {
  const now = Date.now();
  const previous = lastInvocationByUser.get(userId) ?? 0;
  if (now - previous < MINIMUM_INTERVAL_MS) return false;
  lastInvocationByUser.set(userId, now);
  if (lastInvocationByUser.size > 1_000) {
    for (const [id, timestamp] of lastInvocationByUser) {
      if (now - timestamp >= MINIMUM_INTERVAL_MS) lastInvocationByUser.delete(id);
    }
  }
  return true;
}
