import "server-only";
import { after } from "next/server";
import { processAttentionPushesBestEffort } from "@/lib/push/immediate";

export function scheduleAttentionPushAfterResponse(): void {
  try {
    after(processAttentionPushesBestEffort);
  } catch {
    // The hourly processor remains the fallback if lifecycle registration is unavailable.
  }
}
