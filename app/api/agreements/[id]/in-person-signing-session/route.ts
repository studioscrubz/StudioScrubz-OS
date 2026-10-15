import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPublicSiteUrl } from "@/lib/publicSiteUrl";

type SessionRpc = {
  rpc(name: "create_in_person_agreement_signing_session", args: {
    p_agreement_id: string;
    p_session_id: string;
    p_token: string;
  }): PromiseLike<{ data: Array<{ session_id: string; expires_at: string }> | null; error: { message: string } | null }>;
};

export async function POST(_request: Request, context: RouteContext<"/api/agreements/[id]/in-person-signing-session">) {
  try {
    const { id } = await context.params;
    const server = await createSupabaseServerClient();
    const { data: { user } } = await server.auth.getUser();
    if (!user) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const token = secureToken();
    const sessionId = crypto.randomUUID();
    const { data, error } = await (server as unknown as SessionRpc).rpc("create_in_person_agreement_signing_session", {
      p_agreement_id: id,
      p_session_id: sessionId,
      p_token: token,
    });
    if (error) throw new Error(error.message);
    const session = data?.[0];
    if (!session) throw new Error("The signing session could not be created.");
    return Response.json({
      sessionId: session.session_id,
      expiresAt: session.expires_at,
      signingUrl: `${getPublicSiteUrl()}/agreement/in-person/${encodeURIComponent(token)}`,
    });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "The signing session could not be created." }, { status: 400 });
  }
}

function secureToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}
