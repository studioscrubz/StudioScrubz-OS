import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendAnnouncementPushBestEffort } from "@/lib/push/messagingImmediate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await createSupabaseServerClient();
    const { data: authData } = await session.auth.getUser();
    const callerId = authData.user?.id ?? null;
    if (!callerId) return Response.json({ ok: false }, { status: 401 });

    const body = await request.json().catch(() => ({})) as { messageId?: unknown };
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    if (!messageId) return Response.json({ ok: false }, { status: 400 });

    // RLS-scoped reads: sender identity, message, and Announcement kind can only be verified
    // through the caller's own authenticated membership, never trusted from client input.
    const { data: message } = await session.from("messages").select("id,conversation_id,sender_user_id,priority").eq("id", messageId).maybeSingle();
    if (!message || message.sender_user_id !== callerId) return Response.json({ ok: false }, { status: 403 });

    const { data: conversation } = await session.from("conversations").select("id,title").eq("id", message.conversation_id).eq("kind", "Announcement").maybeSingle();
    if (!conversation) return Response.json({ ok: false }, { status: 403 });

    const { data: members } = await session.from("conversation_members").select("user_id").eq("conversation_id", conversation.id).is("left_at", null);
    const recipientUserIds = (members ?? []).map((member) => member.user_id).filter((userId) => userId !== callerId);
    if (!recipientUserIds.length) return Response.json({ ok: true });

    await sendAnnouncementPushBestEffort({ messageId, recipientUserIds, title: conversation.title, priority: message.priority });
    return Response.json({ ok: true });
  } catch (cause) {
    console.error("Company Announcement push notify failed", cause instanceof Error ? cause.message : "Unknown error");
    return Response.json({ ok: true }); // Push is best effort; the announcement itself is already authoritative.
  }
}
