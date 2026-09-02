import "server-only";
import { runAttentionPushBestEffort } from "@/lib/push/bestEffort";
import { processAttentionPushes } from "@/lib/push/server";

export async function processAttentionPushesBestEffort(): Promise<void> {
  await runAttentionPushBestEffort(processAttentionPushes);
}
