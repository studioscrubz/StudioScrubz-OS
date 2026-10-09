import { enforceProposalPublicRateLimit, ProposalPublicRateLimitError } from "@/lib/proposalPublicRateLimit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ViewRequest = { token?: string };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ViewRequest;
    await enforceProposalPublicRateLimit(request, "view", body.token ?? "");
    const client = createSupabaseAdminClient() as unknown as ProposalActivityRpcClient;
    const { data, error } = await client.rpc(
      "record_proposal_view_by_token",
      { p_token: body.token ?? "" },
    );
    if (error) throw error;
    return Response.json(data);
  } catch (error) {
    if (error instanceof ProposalPublicRateLimitError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined },
      );
    }
    return Response.json({ error: message(error, "The Proposal view could not be recorded.") }, { status: 400 });
  }
}

type ProposalActivityRpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

function message(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}
