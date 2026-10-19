/** Environment flag set for processes that belong to an `corax dev` session. */
export const CORAX_DEV_ENV_FLAG = "CORAX_DEV";

type InstrumentationEnvironment = "development" | "preview" | "production";

/** Reports whether this process belongs to an `corax dev` session. */
export function isCoraxDevEnvironment(): boolean {
  return process.env[CORAX_DEV_ENV_FLAG] === "1";
}

/** Resolves the deployment environment used by setup hooks and trace policies. */
export function resolveInstrumentationEnvironment(): InstrumentationEnvironment {
  return isCoraxDevEnvironment() ? "development" : "production";
}

/** Environment flag set for a server `corax eval` started to run against. */
export const CORAX_EVALUATION_ENV_FLAG = "CORAX_EVALUATION";

/** Stable identifier for the local eval run this server was started to serve. */
export const CORAX_EVALUATION_RUN_ID_ENV = "CORAX_EVALUATION_RUN_ID";

/**
 * Reports whether this process exists to serve an eval run.
 *
 * False for a server that `corax eval --url` merely points at: that process was
 * started to serve ordinary traffic and cannot know an eval is among it.
 */
function isCoraxEvaluationEnvironment(): boolean {
  return process.env[CORAX_EVALUATION_ENV_FLAG] === "1";
}

export function resolveCoraxEvaluationRunId(): string | undefined {
  if (!isCoraxEvaluationEnvironment()) return undefined;
  const runId = process.env[CORAX_EVALUATION_RUN_ID_ENV];
  return runId === undefined || runId.length === 0 ? undefined : runId;
}
