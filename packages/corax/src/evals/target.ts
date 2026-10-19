import { setTimeout as sleep } from "node:timers/promises";

import { Client } from "#client/client.js";
import type { AgentInfoResult } from "#client/types.js";
import { createCoraxDevDispatchSchedulePath } from "#protocol/routes.js";
import { toErrorMessage } from "#shared/errors.js";
import { stripNpmPackageScope } from "#shared/package-name.js";
import { EvalSessionManager } from "#evals/session-manager.js";
import type {
  CoraxEvalScheduleDispatchResult,
  CoraxEvalSession,
  CoraxEvalTargetCapabilities,
  CoraxEvalTargetHandle,
} from "#evals/types.js";

const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_TIMEOUT_MS = 60_000;

export async function resolveEvalTargetHandle(input: {
  readonly client: Client;
  readonly expectedAgentName?: string;
  readonly kind: "local" | "remote";
  readonly url: string;
}): Promise<CoraxEvalTargetHandle> {
  await waitForTargetHealth(input.client, input.url);
  const info = await input.client.info();
  assertAgentInfoShape(info, input.url);

  if (
    input.expectedAgentName !== undefined &&
    !matchesExpectedAgentName(input.expectedAgentName, info.agent.name)
  ) {
    throw new Error(
      `Expected eval target ${JSON.stringify(input.expectedAgentName)} at ${input.url}, but ${JSON.stringify(info.agent.name)} is responding there.`,
    );
  }

  const target = createEvalTargetHandle({
    capabilities: capabilitiesFromInfo(info),
    client: input.client,
    kind: input.kind,
    url: input.url,
  });
  toolsByTarget.set(target, {
    dynamic: info.tools.dynamic.length > 0,
    static: info.tools.static.map((tool) => tool.name),
  });
  return target;
}

/** The root agent's static tool names, and whether it has a dynamic tool resolver. */
export interface TargetTools {
  readonly dynamic: boolean;
  readonly static: readonly string[];
}

const toolsByTarget = new WeakMap<CoraxEvalTargetHandle, TargetTools>();

/** The tools of a target resolved from `/corax/v1/info`; undefined for a hand-built handle. */
export function targetTools(target: CoraxEvalTargetHandle): TargetTools | undefined {
  return toolsByTarget.get(target);
}

export function createEvalTargetHandle(input: {
  readonly capabilities: CoraxEvalTargetCapabilities;
  readonly client: Client;
  readonly kind: "local" | "remote";
  readonly url: string;
}): CoraxEvalTargetHandle {
  return createHandle({
    capabilities: input.capabilities,
    client: input.client,
    kind: input.kind,
    sessions: undefined,
    url: input.url,
  });
}

export function scopeEvalTargetHandle(
  target: CoraxEvalTargetHandle,
  input: {
    readonly sessions?: EvalSessionManager;
  },
): CoraxEvalTargetHandle {
  return createHandle({
    capabilities: target.capabilities,
    client: undefined,
    delegate: target,
    kind: target.kind,
    sessions: input.sessions,
    url: target.url,
  });
}

function createHandle(input: {
  readonly capabilities: CoraxEvalTargetCapabilities;
  readonly client: Client | undefined;
  readonly delegate?: CoraxEvalTargetHandle;
  readonly kind: "local" | "remote";
  readonly sessions: EvalSessionManager | undefined;
  readonly url: string;
}): CoraxEvalTargetHandle {
  const base = input.delegate;
  const client = input.client;

  const fetchTarget = async (path: string, init?: RequestInit): Promise<Response> => {
    if (base !== undefined) return await base.fetch(path, init);
    if (client === undefined) throw new Error("Eval target cannot fetch without a client.");
    return await client.fetch(path, init);
  };

  return {
    capabilities: input.capabilities,
    kind: input.kind,
    url: input.url,

    async attachSession(
      sessionId: string,
      opts?: { readonly startIndex?: number },
    ): Promise<CoraxEvalSession> {
      if (input.sessions !== undefined) {
        return await input.sessions.attachSession(sessionId, opts);
      }

      if (base !== undefined) {
        return await base.attachSession(sessionId, opts);
      }

      if (client === undefined) {
        throw new Error("Eval target cannot attach sessions without a client.");
      }

      const sessions = new EvalSessionManager({ client });
      return await sessions.attachSession(sessionId, opts);
    },

    watchTurn(sessionId: string, opts?: { readonly startIndex?: number }) {
      if (input.sessions !== undefined) {
        return input.sessions.watchTurn(sessionId, opts);
      }

      if (base !== undefined) {
        return base.watchTurn(sessionId, opts);
      }

      if (client === undefined) {
        throw new Error("Eval target cannot watch sessions without a client.");
      }

      const sessions = new EvalSessionManager({ client });
      return sessions.watchTurn(sessionId, opts);
    },

    async dispatchSchedule(scheduleId: string): Promise<CoraxEvalScheduleDispatchResult> {
      if (!input.capabilities.devRoutes) {
        throw new Error("target.dispatchSchedule() requires a target with dev routes enabled.");
      }

      const response = await fetchTarget(createCoraxDevDispatchSchedulePath(scheduleId), {
        method: "POST",
      });
      if (!response.ok) {
        const body = await readResponseBodySafely(response);
        throw new Error(
          `Schedule dispatch failed: ${response.status} ${response.statusText}` +
            (body.length > 0 ? `, ${body}` : ""),
        );
      }

      return parseScheduleDispatchResult(await response.json());
    },

    async fetch(path: string, init?: RequestInit): Promise<Response> {
      return await fetchTarget(path, init);
    },
  };
}

function capabilitiesFromInfo(info: AgentInfoResult): CoraxEvalTargetCapabilities {
  return {
    devRoutes: info.capabilities?.devRoutes ?? info.mode === "development",
  };
}

function matchesExpectedAgentName(expected: string, actual: string): boolean {
  return actual === expected || actual === stripNpmPackageScope(expected);
}

async function waitForTargetHealth(client: Client, url: string): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    try {
      await client.health();
      return;
    } catch (error) {
      lastError = toErrorMessage(error);
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }
  }

  throw new Error(
    `Timed out waiting for eval target health at ${url}.` +
      (lastError === undefined ? "" : ` Last error: ${lastError}`),
  );
}

function assertAgentInfoShape(info: AgentInfoResult, url: string): void {
  if (info.kind !== "corax-agent-info" || info.version !== 5) {
    throw new Error(`Eval target ${url} returned an unrecognized /corax/v1/info payload.`);
  }
}

function parseScheduleDispatchResult(payload: unknown): CoraxEvalScheduleDispatchResult {
  if (
    payload === null ||
    typeof payload !== "object" ||
    !("scheduleId" in payload) ||
    typeof payload.scheduleId !== "string" ||
    !("sessionIds" in payload) ||
    !Array.isArray(payload.sessionIds) ||
    payload.sessionIds.some((sessionId) => typeof sessionId !== "string")
  ) {
    throw new Error(
      `Schedule dispatch returned an unexpected response shape: ${JSON.stringify(payload)}`,
    );
  }

  return {
    scheduleId: payload.scheduleId,
    sessionIds: [...payload.sessionIds],
  };
}

async function readResponseBodySafely(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}
