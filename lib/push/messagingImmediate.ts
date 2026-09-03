import "server-only";
import { processDirectMessagePush } from "@/lib/push/messagingServer";

export async function sendDirectMessagePushBestEffort(input: {
  recipientUserId: string;
  messageId: string;
  conversationId: string;
  senderDisplayName: string | null;
}): Promise<void> {
  try {
    await processDirectMessagePush(input);
  } catch (cause) {
    try {
      console.error("Immediate Direct Message push processing failed", sanitizeMessagingPushError(cause));
    } catch {
      // Logging must not turn a notification failure into an application failure.
    }
  }
}

function sanitizeMessagingPushError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Direct Message push processing failed.";
  return message
    .replace(/https?:\/\/\S+/gi, "[endpoint]")
    .replace(/Bearer\s+\S+/gi, "[credential]")
    .replace(/(SUPABASE_SERVICE_ROLE_KEY|WEB_PUSH_VAPID_PRIVATE_KEY)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 300);
}
