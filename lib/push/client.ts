export type ImmediateAttentionPushTrigger = () => Promise<unknown>;

export async function requestImmediateAttentionPush(
  send: typeof fetch = fetch,
): Promise<void> {
  try {
    await send("/api/attention/push/process", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    // Immediate push is best-effort and must not change the business result.
  }
}

export async function withImmediateAttentionPush<T>(
  mutate: () => Promise<T>,
  trigger: ImmediateAttentionPushTrigger = requestImmediateAttentionPush,
): Promise<T> {
  const result = await mutate();
  try {
    await trigger();
  } catch {
    // Keep mutation callers successful even if an injected trigger rejects.
  }
  return result;
}
