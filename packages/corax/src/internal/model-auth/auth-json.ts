import { isObject } from "#shared/guards.js";

/** Fetches a JSON authentication/catalog response with size and time limits. */
export async function authJson(
  url: string,
  init: RequestInit = {},
  maxBytes = 256_000,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
  const reader = response.body?.getReader();
  let raw = "";
  const decoder = new TextDecoder();
  if (reader) {
    try {
      let bytes = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        bytes += result.value.byteLength;
        if (bytes > maxBytes)
          throw new Error("Authentication response was too large. Retry /login.");
        raw += decoder.decode(result.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      await reader.cancel();
    }
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("The provider returned an invalid authentication response. Retry /login.");
  }
  if (!isObject(value))
    throw new Error("The provider returned an invalid authentication response. Retry /login.");
  if (!response.ok && typeof value.error !== "string")
    throw new Error(`Authentication failed (${response.status}). Retry /login.`);
  return value;
}
