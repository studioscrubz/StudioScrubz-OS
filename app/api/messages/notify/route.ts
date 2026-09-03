import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendDirectMessagePushBestEffort } from "@/lib/push/messagingImmediate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await createSupabaseServerClient();
    const { data: authData } = await session.auth.getUser();
    const callerId = authData.user?.id ?? null;
    if (!callerId) return Response.json({ ok: false }, { status: 401 });

    const body = await request.json().catch(() => ({})) as { conversationId?: unknown; messageId?: unknown };
    const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    if (!conversationId || !messageId) return Response.json({ ok: false }, { status: 400 });

    // RLS-scoped reads: recipient/sender identity can only be resolved through real membership and ownership.
    const { data: message } = await session.from("messages").select("id,sender_user_id").eq("id", messageId).eq("conversation_id", conversationId).maybeSingle();
    if (!message || message.sender_user_id !== callerId) return Response.json({ ok: false }, { status: 403 });

    const { data: conversation } = await session.from("conversations").select("id").eq("id", conversationId).eq("kind", "Direct").maybeSingle();
    if (!conversation) return Response.json({ ok: false }, { status: 403 });

    const { data: members } = await session.from("conversation_members").select("user_id").eq("conversation_id", conversationId).is("left_at", null);
    const recipientId = (members ?? []).map((member) => member.user_id).find((userId) => userId !== callerId);
    if (!recipientId) return Response.json({ ok: true });

    const { data: senderProfile } = await session.from("user_profiles").select("display_name").eq("id", callerId).maybeSingle();

    await sendDirectMessagePushBestEffort({ recipientUserId: recipientId, messageId, conversationId, senderDisplayName: senderProfile?.display_name ?? null });
    return Response.json({ ok: true });
  } catch (cause) {
    console.error("Direct Message push notify failed", cause instanceof Error ? cause.message : "Unknown error");
    return Response.json({ ok: true }); // Push is best effort; the message itself is already authoritative.
  }
}
