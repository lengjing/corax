// ---------------------------------------------------------------------------
// Eval definition
// ---------------------------------------------------------------------------

export { defineEval } from "#evals/define-eval.js";
export { defineEvalConfig } from "#evals/define-eval-config.js";
export { CoraxEvalTurnFailedError } from "#evals/session.js";
export { mockModel } from "#evals/mock-model.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { RuntimeIdentity, RuntimeTraceContext } from "#protocol/message.js";
export type { InputRequest } from "#shared/input.js";
export type { CancelSessionResult } from "#client/types.js";

export type {
  CoraxEvalCountMatcher,
  CoraxEvalEventMatch,
  CoraxEvalInputRequestMatchOptions,
  CoraxEvalValueMatcher,
  CoraxEvalToolCallMatchOptions,
  CoraxEvalSkillLoadMatchOptions,
  CoraxEvalSubagentCallMatchOptions,
} from "#evals/match.js";

export type {
  Assertion,
  AssertionEvaluation,
  AssertionHandle,
  AssertionResult,
  AssertionSeverity,
  CoraxEvalActionStatus,
  CoraxEvalAgentSession,
  CoraxEvalAssertions,
  CoraxEvalContext,
  CoraxEvalDerivedFacts,
  CoraxEvalJudgeConfig,
  CoraxEvalRunSummary,
  CoraxEvalSession,
  CoraxEvalSessionResult,
  CoraxEvalScheduleDispatchResult,
  CoraxEvalSkillLoad,
  CoraxEvalSubagentCall,
  CoraxEval,
  CoraxEvalConfig,
  CoraxEvalConfigInput,
  CoraxEvalConfigContext,
  CoraxEvalDefinition,
  CoraxEvalInput,
  CoraxEvalLiveTurn,
  CoraxEvalResult,
  CoraxEvalTarget,
  CoraxEvalTargetCapabilities,
  CoraxEvalTargetHandle,
  CoraxEvalTaskResult,
  CoraxEvalTraceContext,
  CoraxEvalToolCall,
  CoraxEvalTurn,
  CoraxEvalStreamEvent,
  CoraxEvalWaitForEventOptions,
  CoraxEvalVerdict,
  JudgeBatch,
  JudgeInput,
  JudgeQuestion,
  JudgeContext,
  JudgeOpts,
  ScoreInput,
} from "#evals/types.js";

export type {
  MockModelMessage,
  MockModelOptions,
  MockModelRequest,
  MockModelResponder,
  MockModelResponse,
  MockModelTool,
  MockModelToolCall,
  MockModelToolResult,
  MockModelUsage,
} from "#evals/mock-model.js";
export type { ToolStub, ToolStubOutcome } from "#tool-stubs/types.js";
