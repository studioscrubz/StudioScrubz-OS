export type AttentionPushProcessor = () => Promise<unknown>;
export type AttentionPushFailureLogger = (message: string, detail: string) => void;

export async function runAttentionPushBestEffort(
  process: AttentionPushProcessor,
  log: AttentionPushFailureLogger = console.error,
): Promise<void> {
  try {
    await process();
  } catch (cause) {
    try {
      log("Immediate Attention push processing failed", sanitizeAttentionPushError(cause));
    } catch {
      // Logging must not turn a notification failure into an application failure.
    }
  }
}

export function sanitizeAttentionPushError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Attention push processing failed.";
  return message
    .replace(/https?:\/\/\S+/gi, "[endpoint]")
    .replace(/Bearer\s+\S+/gi, "[credential]")
    .replace(/(CRON_SECRET|WEB_PUSH_VAPID_PRIVATE_KEY|SUPABASE_SERVICE_ROLE_KEY)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 300);
}
