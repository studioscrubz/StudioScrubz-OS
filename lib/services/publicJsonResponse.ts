const DEFAULT_RECONCILIATION_MESSAGE =
  "The server response could not be read. Refresh this page to confirm whether your request completed before trying again.";

type ErrorPayload = { error?: unknown };

export async function parsePublicJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = await response.text();
  let payload: T & ErrorPayload;

  if (!body.trim()) {
    throw new Error(response.ok ? DEFAULT_RECONCILIATION_MESSAGE : fallbackMessage);
  }

  try {
    payload = JSON.parse(body) as T & ErrorPayload;
  } catch {
    throw new Error(response.ok ? DEFAULT_RECONCILIATION_MESSAGE : fallbackMessage);
  }

  if (!response.ok) {
    throw new Error(typeof payload.error === "string" && payload.error.trim() ? payload.error : fallbackMessage);
  }

  return payload;
}
