import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ProposalPublicAction = "view" | "decline";

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number;
};

export class ProposalPublicRateLimitError extends Error {
  constructor(
    message: string,
    public readonly status: 429 | 503,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export async function enforceProposalPublicRateLimit(
  request: Request,
  action: ProposalPublicAction,
  token: string,
): Promise<void> {
  const clientFingerprint = hash(clientIdentity(request));
  const tokenFingerprint = hash(token.trim() || "missing-token");
  const database = createSupabaseAdminClient() as unknown as RateLimitClient;
  const { data, error } = await database.rpc("consume_proposal_public_rate_limit", {
    p_action: action,
    p_client_hash: clientFingerprint,
    p_token_hash: tokenFingerprint,
  });

  if (error) {
    throw new ProposalPublicRateLimitError(
      "Proposal activity is temporarily unavailable. Please try again shortly.",
      503,
    );
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.allowed !== "boolean") {
    throw new ProposalPublicRateLimitError(
      "Proposal activity is temporarily unavailable. Please try again shortly.",
      503,
    );
  }

  if (!result.allowed) {
    throw new ProposalPublicRateLimitError(
      "Too many requests. Please wait before trying again.",
      429,
      Math.max(1, Number(result.retry_after_seconds) || 60),
    );
  }
}

type RateLimitClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: RateLimitResult | RateLimitResult[] | null; error: unknown }>;
};

function clientIdentity(request: Request): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? request.headers.get("x-real-ip");
  const address = forwarded?.split(",")[0]?.trim();
  if (address) return address;
  return `unknown:${request.headers.get("user-agent")?.slice(0, 200) ?? "no-user-agent"}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
