import { scheduleAttentionPushAfterResponse } from "@/lib/push/postResponse";
import { enforceProposalPublicRateLimit, ProposalPublicRateLimitError } from "@/lib/proposalPublicRateLimit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type DeclineRequest = { token?: string; reason?: string };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DeclineRequest;
    await enforceProposalPublicRateLimit(request, "decline", body.token ?? "");
    const client = createSupabaseAdminClient() as unknown as ProposalActivityRpcClient;
    const { data, error } = await client.rpc(
      "decline_proposal_by_token",
      { p_token: body.token ?? "", p_reason: body.reason ?? null },
    );
    if (error) throw error;
    scheduleAttentionPushAfterResponse();
    return Response.json(data);
  } catch (error) {
    if (error instanceof ProposalPublicRateLimitError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined },
      );
    }
    return Response.json({ error: message(error, "The Proposal could not be declined.") }, { status: 400 });
  }
}

type ProposalActivityRpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

function message(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}
