import { createLogger } from "#internal/logging.js";
import { isObject } from "#shared/guards.js";

const log = createLogger("execution.session-callback");
const SESSION_CALLBACK_TIMEOUT_MS = 30_000;

/** Posts one framework callback payload with the shared callback transport policy. */
export async function postSessionCallbackRequest(input: {
  readonly body: unknown;
  /** Set false when the caller owns failure logging, such as best-effort activity. */
  readonly logFailures?: boolean;
  readonly timeoutMs?: number;
  readonly url: string;
}): Promise<Response> {
  const timeoutMs = input.timeoutMs ?? SESSION_CALLBACK_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(input.url, {
      body: JSON.stringify(input.body),
      headers: { "content-type": "application/json" },
      method: "POST",
      // Do not follow redirects: a validated callback host could otherwise
      // 3xx-bounce the framework to an internal/metadata address after the
      // path/token check has already passed.
      redirect: "error",
      signal,
    });
  } catch (error) {
    // Fetch errors can contain the capability URL or credentials in their
    // cause chain. Log a safe summary, but preserve the original rejection.
    if (input.logFailures !== false) {
      log.error("callback delivery failed", {
        ...callbackLogFields(input),
        failure: signal.aborted ? "timeout" : "transport",
        timeoutMs,
        error: new Error("Callback request failed before receiving a response."),
      });
    }
    throw error;
  }
  if (!response.ok && input.logFailures !== false) {
    log.error("callback delivery failed", {
      ...callbackLogFields(input),
      failure: "http",
      statusCode: response.status,
      error: new Error(`Callback request failed with HTTP ${response.status}.`),
    });
  }
  return response;
}

function callbackLogFields(input: { readonly body: unknown; readonly url: string }) {
  const url = URL.parse(input.url);
  const route = url?.pathname.match(/^(.*?\/(?:callback|activity))\//)?.[1];
  const fields: Record<string, string | number | undefined> = {
    callbackOrigin: url?.origin,
    callbackPath: route === undefined ? "[redacted]" : `${route}/[redacted]`,
  };
  if (isObject(input.body)) {
    for (const key of [
      "kind",
      "callId",
      "sessionId",
      "childSessionId",
      "subagentName",
      "updateEpoch",
    ]) {
      if (typeof input.body[key] === "string") fields[key] = input.body[key];
    }
    if (typeof input.body.updateIndex === "number") fields.updateIndex = input.body.updateIndex;
  }
  return fields;
}
