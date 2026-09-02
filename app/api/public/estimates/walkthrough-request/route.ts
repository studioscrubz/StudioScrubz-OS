import { scheduleAttentionPushAfterResponse } from "@/lib/push/postResponse";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { PublicEstimateWalkthroughRequest } from "@/types/publicEstimate";

const attempts = new Map<string, { count: number; reset: number }>();

export async function POST(request: Request) {
  const key = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && entry.reset > now && entry.count >= 10) {
    return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }
  attempts.set(key, {
    count: entry && entry.reset > now ? entry.count + 1 : 1,
    reset: entry && entry.reset > now ? entry.reset : now + 15 * 60_000,
  });

  try {
    const body = await request.json() as PublicEstimateWalkthroughRequest & { token?: string };
    const { data, error } = await createSupabaseAdminClient().rpc("request_estimate_walkthrough_by_token", {
      p_token: body.token ?? "",
      p_client_name: body.clientName,
      p_email: body.email,
      p_phone: body.phone,
      p_preferred_contact_method: body.preferredContactMethod,
    });
    if (error) throw error;
    scheduleAttentionPushAfterResponse();
    return Response.json(data);
  } catch {
    return Response.json({ error: "Your walkthrough request could not be submitted." }, { status: 400 });
  }
}
