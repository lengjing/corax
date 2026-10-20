import { Client } from "#client/client.js";
import type { ClientOptions } from "#client/types.js";
import { resolveDevelopmentClientOptions } from "#services/dev-client/client-options.js";

import type { CoraxEvalTargetHandle } from "#evals/types.js";

/**
 * {@link ClientOptions} for an eval target: local needs no auth, remote stays
 * anonymous unless `CORAX_EVAL_AUTH_TOKEN` sets a static bearer.
 */
export function resolveEvalClientOptions(
  target: Pick<CoraxEvalTargetHandle, "kind" | "url">,
): ClientOptions {
  if (target.kind === "local") {
    return { host: target.url };
  }

  const options = resolveDevelopmentClientOptions(target.url);
  const explicitToken = process.env.CORAX_EVAL_AUTH_TOKEN?.trim();
  if (explicitToken) {
    return { ...options, auth: { bearer: explicitToken }, redirect: "manual" };
  }

  return options;
}

interface CreateEvalClientOptions {
  /** Working directory of the project under evaluation; kept for call-site compatibility. */
  readonly workspaceRoot?: string;
}

/** Creates one eval client. Remote targets only ever use explicit credentials. */
export async function createEvalClient(
  target: Pick<CoraxEvalTargetHandle, "kind" | "url">,
  _options: CreateEvalClientOptions = {},
): Promise<Client> {
  return new Client(resolveEvalClientOptions(target));
}
