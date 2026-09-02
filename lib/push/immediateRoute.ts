export type ImmediateAttentionPushRouteDependencies = {
  authenticate: () => Promise<{ userId: string } | null>;
  process: () => Promise<void>;
  allow: (userId: string) => boolean;
};

export async function handleImmediateAttentionPush(
  dependencies: ImmediateAttentionPushRouteDependencies,
): Promise<Response> {
  const identity = await dependencies.authenticate();
  if (!identity) {
    return Response.json({ error: "Authentication is required." }, { status: 401 });
  }

  if (dependencies.allow(identity.userId)) {
    try {
      await dependencies.process();
    } catch {
      // Keep this boundary defensive even though the best-effort processor never rejects.
    }
  }

  return Response.json({ accepted: true }, { status: 202 });
}
