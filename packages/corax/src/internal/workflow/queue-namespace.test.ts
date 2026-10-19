import { describe, expect, it, vi } from "vitest";

import {
  deriveCoraxWorkflowQueueNamespace,
  deriveCoraxWorkflowQueuePrefix,
  deriveCoraxWorkflowQueueTopic,
  installCoraxWorkflowQueueNamespace,
  WORKFLOW_QUEUE_NAMESPACE_ENV,
} from "#internal/workflow/queue-namespace.js";

describe("workflow queue namespace", () => {
  it("derives a valid, collision-free namespace from the agent name", () => {
    expect(deriveCoraxWorkflowQueueNamespace("weather-agent")).toBe("corax776561746865722d6167656e74");
    expect(deriveCoraxWorkflowQueueNamespace("weatheragent")).not.toBe(
      deriveCoraxWorkflowQueueNamespace("weather-agent"),
    );
    expect(deriveCoraxWorkflowQueueNamespace("weather-agent")).toMatch(/^[a-z][a-z0-9]*$/);
  });

  it("derives the workflow queue prefix and topic from the same namespace", () => {
    expect(deriveCoraxWorkflowQueuePrefix("weather-agent")).toBe(
      "__corax776561746865722d6167656e74_wkf_workflow_",
    );
    expect(deriveCoraxWorkflowQueueTopic("weather-agent")).toBe(
      "__corax776561746865722d6167656e74_wkf_workflow_*",
    );
  });

  it("installs the derived namespace for Workflow runtime operations", () => {
    vi.stubEnv(WORKFLOW_QUEUE_NAMESPACE_ENV, "previous");

    try {
      expect(installCoraxWorkflowQueueNamespace("weather-agent")).toBe(
        "corax776561746865722d6167656e74",
      );
      expect(process.env[WORKFLOW_QUEUE_NAMESPACE_ENV]).toBe("corax776561746865722d6167656e74");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
