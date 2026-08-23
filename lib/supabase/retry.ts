type SupabaseReadError = { code?: string | null; message?: string | null };
type SupabaseReadResult = { error: SupabaseReadError | null };

export const AUTH_SYNCHRONIZATION_MESSAGE = "Authentication synchronization is temporarily delayed. Please try again in a moment.";

export class AuthSynchronizationError extends Error {
  constructor() {
    super(AUTH_SYNCHRONIZATION_MESSAGE);
    this.name = "AuthSynchronizationError";
  }
}

export async function retryJwtIssuedAtFuture<T extends SupabaseReadResult>(read: () => PromiseLike<T>, delayMs = 1500): Promise<T> {
  const first = await read();
  if (!isJwtIssuedAtFuture(first.error)) return first;
  await delay(delayMs);
  const second = await read();
  if (isJwtIssuedAtFuture(second.error)) throw new AuthSynchronizationError();
  return second;
}

export function isJwtIssuedAtFuture(error: SupabaseReadError | null | undefined): boolean {
  return error?.code === "PGRST303" || error?.message?.toLocaleLowerCase().includes("jwt issued at future") === true;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
