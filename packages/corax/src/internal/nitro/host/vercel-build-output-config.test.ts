import { describe, expect, it } from "vitest";

import { resolveInstalledPackageInfo } from "#internal/application/package.js";
import { CORAX_PACKAGE_NAME } from "#internal/package-name.js";
import {
  createCoraxVercelOptions,
  CORAX_WORKFLOW_FLOW_ROUTE_PATH,
} from "#internal/nitro/host/vercel-build-output-config.js";
import { deriveCoraxWorkflowQueueTopic } from "#internal/workflow/queue-namespace.js";
import { CORAX_SCHEDULE_COLLECTION_CONSUMER_ROUTE_PATH } from "#internal/schedules/consumer-route.js";
import { deriveCoraxScheduleQueueTopic } from "#runtime/schedules/queue-namespace.js";

describe("createCoraxVercelOptions", () => {
  it("returns undefined when the Vercel build output is disabled", () => {
    expect(createCoraxVercelOptions({ agentName: "test-agent", enabled: false })).toBeUndefined();
  });

  it("emits both framework slug and version so the proxy keeps the framework object", () => {
    expect(createCoraxVercelOptions({ agentName: "test-agent", enabled: true })?.config).toEqual({
      version: 3,
      framework: {
        slug: CORAX_PACKAGE_NAME,
        version: resolveInstalledPackageInfo().version,
      },
    });
  });

  it("declares the queue-triggered workflow flow function through functionRules", () => {
    const options = createCoraxVercelOptions({ agentName: "test-agent", enabled: true });

    expect(options?.functionRules).toEqual({
      [CORAX_WORKFLOW_FLOW_ROUTE_PATH]: {
        maxDuration: "max",
        experimentalTriggers: [
          {
            type: "queue/v2beta",
            topic: deriveCoraxWorkflowQueueTopic("test-agent"),
            consumer: "default",
            retryAfterSeconds: 5,
            initialDelaySeconds: 0,
          },
        ],
        environment: {
          WORKFLOW_PRECONDITION_GUARD: "1",
        },
      },
    });
  });

  it("conditionally declares the private schedule collection consumer", () => {
    const withoutCollections = createCoraxVercelOptions({
      agentName: "test-agent",
      enabled: true,
    });
    const withCollections = createCoraxVercelOptions({
      agentName: "test-agent",
      enabled: true,
      hasVercelScheduleCollections: true,
    });

    expect(withoutCollections?.functionRules).not.toHaveProperty(
      CORAX_SCHEDULE_COLLECTION_CONSUMER_ROUTE_PATH,
    );
    expect(withCollections?.functionRules[CORAX_SCHEDULE_COLLECTION_CONSUMER_ROUTE_PATH]).toEqual({
      maxDuration: "max",
      experimentalTriggers: [
        {
          type: "queue/v2beta",
          topic: deriveCoraxScheduleQueueTopic("test-agent"),
          retryAfterSeconds: 5,
          initialDelaySeconds: 0,
          maxDeliveries: 10,
        },
      ],
      environment: { WORKFLOW_PRECONDITION_GUARD: "1" },
    });
  });

  it("omits the public route prefix from the flow environment when none is set", () => {
    for (const publicRoutePrefix of [undefined, ""]) {
      const options = createCoraxVercelOptions({
        agentName: "test-agent",
        enabled: true,
        publicRoutePrefix,
      });
      expect(options?.functionRules[CORAX_WORKFLOW_FLOW_ROUTE_PATH]!.environment).not.toHaveProperty(
        "CORAX_PUBLIC_ROUTE_PREFIX",
      );
    }
  });

  it("bakes the normalized public route prefix into the flow function environment", () => {
    const options = createCoraxVercelOptions({
      agentName: "test-agent",
      enabled: true,
      publicRoutePrefix: "corax/support/",
    });

    expect(options?.functionRules[CORAX_WORKFLOW_FLOW_ROUTE_PATH]!.environment).toEqual({
      WORKFLOW_PRECONDITION_GUARD: "1",
      CORAX_PUBLIC_ROUTE_PREFIX: "/corax/support",
    });
  });

  it("marks workspace-member flow functions without marking standalone agents", () => {
    const standalone = createCoraxVercelOptions({
      agentName: "test-agent",
      enabled: true,
      publicRoutePrefix: "/support",
    });
    const workspaceMember = createCoraxVercelOptions({
      agentName: "test-agent",
      enabled: true,
      publicRoutePrefix: "/support",
      workspaceMember: true,
    });

    expect(standalone?.functionRules[CORAX_WORKFLOW_FLOW_ROUTE_PATH]!.environment).not.toHaveProperty(
      "CORAX_INTERNAL_AGENT_WORKSPACE_MEMBER",
    );
    expect(workspaceMember?.functionRules[CORAX_WORKFLOW_FLOW_ROUTE_PATH]!.environment).toMatchObject(
      {
        CORAX_INTERNAL_AGENT_WORKSPACE_MEMBER: "1",
      },
    );
  });
});
