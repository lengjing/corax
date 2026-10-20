import type { ClientOptions } from "#client/index.js";
import { LOCAL_DEV_INTERACTIVE_CLIENT_HEADER } from "#runtime/local-dev-capability.js";

type DevelopmentClientHeaders = Readonly<Record<string, string>>;

/** Returns whether development request headers explicitly own HTTP authorization. */
export function hasDevelopmentAuthorizationHeader(
  headers: DevelopmentClientHeaders | undefined,
): headers is DevelopmentClientHeaders {
  return (
    headers !== undefined &&
    Object.keys(headers).some((name) => name.toLowerCase() === "authorization")
  );
}

/**
 * Builds anonymous {@link ClientOptions} for a development target. Locality is
 * not an authorization decision, so remote URLs receive no ambient
 * credentials through this default path.
 */
export function resolveDevelopmentClientOptions(serverUrl: string): ClientOptions {
  return { host: serverUrl };
}

/** Builds a local client without ambient credentials; callers may explicitly provide a token. */
export function resolveLocalDevelopmentClientOptions(input: {
  readonly headers?: DevelopmentClientHeaders;
  readonly interactiveClient?: boolean;
  readonly serverUrl: string;
  readonly token?: () => Promise<string>;
}): ClientOptions {
  const headers =
    input.interactiveClient === true
      ? { ...input.headers, [LOCAL_DEV_INTERACTIVE_CLIENT_HEADER]: "1" }
      : input.headers;
  const options = {
    host: input.serverUrl,
    redirect: "manual",
  } satisfies ClientOptions;

  if (hasDevelopmentAuthorizationHeader(headers) || input.token === undefined) {
    return { ...options, headers };
  }

  const authorizedOptions = {
    ...options,
    auth: { bearer: input.token },
  } satisfies ClientOptions;

  if (headers !== undefined) {
    return { ...authorizedOptions, headers };
  }
  return authorizedOptions;
}
