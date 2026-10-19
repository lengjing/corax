import type { RuntimeTraceContext } from "#protocol/message.js";
import type {
  CoraxEval,
  CoraxEvalResult,
  CoraxEvalRunSummary,
  CoraxEvalTarget,
  CoraxEvalTraceContext,
} from "#evals/types.js";

/** Context delivered when one eval is scheduled for execution. */
export interface CoraxEvalStartEvent {
  readonly evaluation: CoraxEval;
  readonly startedAt: string;
  readonly target: CoraxEvalTarget;
}

/** Context delivered once the runner observes a session's first trace. */
export interface CoraxEvalSessionStartEvent extends CoraxEvalStartEvent {
  readonly primary: boolean;
  readonly sessionId: string;
  readonly traceContext: RuntimeTraceContext;
}

/** Additional run context delivered with a completed eval result. */
export interface CoraxEvalCompleteContext {
  readonly evaluation: CoraxEval;
  readonly target: CoraxEvalTarget;
  readonly traceContexts: readonly CoraxEvalTraceContext[];
}

/**
 * Reporter lifecycle interface. The runner calls these methods at defined
 * points during an eval run. Methods may return a promise for reporters
 * that perform asynchronous work (e.g. uploading to a remote service).
 *
 * Run-level reporters (console, JUnit) observe every eval in the run.
 * Eval-defined reporters observe only the evals that reference them.
 */
export interface EvalReporter {
  /**
   * The runner calls this once before any eval executes, with the evals
   * this reporter observes.
   */
  onRunStart(evaluations: readonly CoraxEval[], target: CoraxEvalTarget): void | Promise<void>;

  /** The runner calls this when an observed eval is scheduled. */
  onEvalStart?(event: CoraxEvalStartEvent): void | Promise<void>;

  /**
   * The runner calls this once per session when its first trace context is
   * observed. Sessions without trace instrumentation do not trigger it.
   */
  onSessionStart?(event: CoraxEvalSessionStartEvent): void | Promise<void>;

  /**
   * The runner calls this after each observed eval completes, with its
   * checks, scores, and verdict.
   */
  onEvalComplete(result: CoraxEvalResult, context?: CoraxEvalCompleteContext): void | Promise<void>;

  /**
   * The runner calls this once when the run finishes, with the aggregated
   * summary of the evals this reporter observes.
   */
  onRunComplete(summary: CoraxEvalRunSummary): void | Promise<void>;
}
