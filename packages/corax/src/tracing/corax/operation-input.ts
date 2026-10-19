import type { SpanContext } from "#compiled/@opentelemetry/api/index.js";

import { resolveConversationId } from "#shared/conversation-identity.js";
import type { AgentTraceStateStore } from "#tracing/corax/agent-trace-state.js";
import {
  createAgentTracing,
  type AgentTelemetry,
  type AgentTracing,
  type TraceCheckpointer,
} from "#compiled/corax-tracing/index.js";

export function traceSessionIdOf(scope: {
  readonly traceSessionId?: string;
  readonly rootSessionId?: string;
  readonly sessionId: string;
}): string {
  return scope.traceSessionId ?? scope.rootSessionId ?? scope.sessionId;
}

export function checkpointContent(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  // Historical checkpoints contain truncated JSON; omit payloads, not the operation.
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Identity of one corax turn within the shared tracing library. */
export function coraxTurnIdentity(input: {
  readonly sessionId: string;
  readonly rootSessionId?: string;
  readonly turnId: string;
}) {
  return {
    conversationId: resolveConversationId(input.rootSessionId ?? input.sessionId),
    runId: input.sessionId,
    turnId: input.turnId,
  };
}

/** Content flags are recorded by corax's content processor, not withheld by the library. */
export function coraxCapture(reference: SpanContext | undefined) {
  return {
    emit: ((reference?.traceFlags ?? 1) & 1) !== 0,
    recordInputs: true,
    recordOutputs: true,
  };
}

/** corax's agent tracing, checkpointed in its workflow-context trace state. */
export function createCoraxTracing(input: {
  readonly telemetry: AgentTelemetry;
  readonly stateStore: AgentTraceStateStore;
}): AgentTracing {
  const checkpointer: TraceCheckpointer = {
    get: (key) => input.stateStore.get("checkpoint", key),
    set: (key, value) => input.stateStore.set("checkpoint", key, value),
    delete: (key) => input.stateStore.delete("checkpoint", key),
  };
  return createAgentTracing({ telemetry: input.telemetry, checkpointer });
}
