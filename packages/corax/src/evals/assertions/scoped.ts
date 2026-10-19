import { AssertionCollector, type RunAssertion } from "#evals/assertions/collector.js";
import * as RunAssertions from "#evals/assertions/run.js";
import type { CoraxEvalAssertionSubject } from "#evals/assertions/run.js";
import type { CoraxEvalEventMatch } from "#evals/match.js";
import { assertReportedToolName } from "#evals/reported-tool-name.js";
import type {
  CoraxEvalAssertions,
  CoraxEvalOutputAssertions,
  CoraxEvalTaskResult,
} from "#evals/types.js";

type AssertionScope =
  | {
      readonly timing: "final";
      select(result: CoraxEvalTaskResult): CoraxEvalAssertionSubject;
    }
  | {
      readonly timing: "snapshot";
      select(): CoraxEvalAssertionSubject;
    };

/** Binds the shared assertion vocabulary to one aggregate, session, or turn scope. */
export function createScopedAssertions(
  collector: AssertionCollector,
  scope: AssertionScope,
): CoraxEvalAssertions {
  const record = createRecorder(collector, scope);
  const toolName = (name: string) => {
    assertReportedToolName(name, collector.tools);
    return name;
  };

  return {
    succeeded: () => record(RunAssertions.succeeded()),
    parked: () => record(RunAssertions.parked()),
    messageIncludes: (token) => record(RunAssertions.messageIncludes(token)),
    calledTool: (name, options) => record(RunAssertions.calledTool(toolName(name), options)),
    loadedSkill: (skill, options) => record(RunAssertions.loadedSkill(skill, options)),
    notCalledTool: (name) => record(RunAssertions.notCalledTool(toolName(name))),
    toolOrder: (names) => record(RunAssertions.toolOrder(names.map(toolName))),
    usedNoTools: () => record(RunAssertions.usedNoTools()),
    maxToolCalls: (max) => record(RunAssertions.maxToolCalls(max)),
    calledSubagent: (name, options) => record(RunAssertions.calledSubagent(name, options)),
    noFailedActions: () => record(RunAssertions.noFailedActions()),
    event: (type, options) =>
      record(RunAssertions.typedEvent({ ...options, type } as CoraxEvalEventMatch)),
    notEvent: (type, options) =>
      record(RunAssertions.notEvent({ ...options, type } as CoraxEvalEventMatch)),
    eventOrder: (matchers) => record(RunAssertions.eventOrder(matchers)),
    eventsSatisfy: (label, predicate) => record(RunAssertions.eventsSatisfy(label, predicate)),
  };
}

/** Binds output-only assertions to a session or immutable turn snapshot. */
export function createOutputAssertions(
  collector: AssertionCollector,
  scope: Extract<AssertionScope, { timing: "snapshot" }>,
): CoraxEvalOutputAssertions {
  const record = createRecorder(collector, scope);
  return {
    outputEquals: (value) => record(RunAssertions.outputEquals(value)),
    outputMatches: (schema) => record(RunAssertions.outputMatches(schema)),
  };
}

function createRecorder(
  collector: AssertionCollector,
  scope: AssertionScope,
): (assertion: RunAssertion) => import("#evals/types.js").AssertionHandle {
  if (scope.timing === "final") {
    return (assertion) => collector.recordScoped(assertion, scope.select);
  }
  return (assertion) => {
    const subject = scope.select();
    return collector.recordScoped(assertion, () => subject);
  };
}
