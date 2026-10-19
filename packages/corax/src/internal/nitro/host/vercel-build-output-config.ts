import { CORAX_INTERNAL_AGENT_WORKSPACE_MEMBER_ENV } from "#internal/application/build-output-environment.js";
import { resolveInstalledPackageInfo } from "#internal/application/package.js";
import { CORAX_PACKAGE_NAME } from "#internal/package-name.js";
import { createCoraxWorkflowQueueTrigger } from "#internal/workflow/queue-namespace.js";
import {
  createCoraxScheduleQueueTrigger,
  CORAX_SCHEDULE_COLLECTION_CONSUMER_ROUTE_PATH,
} from "#internal/schedules/consumer-route.js";
import { CORAX_WORKFLOW_FLOW_ROUTE_PATH } from "#internal/workflow-bundle/corax-service-route-output.js";
import {
  CORAX_PUBLIC_ROUTE_PREFIX_ENV,
  normalizePublicRoutePrefix,
} from "#shared/public-route-prefix.js";

export { CORAX_WORKFLOW_FLOW_ROUTE_PATH };

/**
 * Builds corax's Vercel preset options.
 *
 * The flow route's `functionRules` entry makes Nitro emit a dedicated
 * `flow.func` from the same build output, carrying the agent's queue trigger,
 * an extended execution window, and the environment the deployed workflow
 * runtime needs. Every other function setting (runtime, memory, streaming) is
 * inherited from the base server function config.
 */
export function createCoraxVercelOptions(input: {
  agentName: string;
  enabled: boolean;
  hasVercelScheduleCollections?: boolean;
  publicRoutePrefix?: string;
  workspaceMember?: boolean;
}) {
  if (!input.enabled) {
    return undefined;
  }

  const environment: Record<string, string> = {
    // Reject replay decisions made from an event log that missed a
    // concurrent wake.
    WORKFLOW_PRECONDITION_GUARD: "1",
  };

  // Bake the agent's public mount into the flow function so callback-URL
  // minting inside the deployed workflow runtime resolves a routable path
  // when a multi-agent host proxies the agent behind a prefix.
  const publicRoutePrefix = normalizePublicRoutePrefix(input.publicRoutePrefix);
  if (publicRoutePrefix !== undefined) {
    environment[CORAX_PUBLIC_ROUTE_PREFIX_ENV] = publicRoutePrefix;
  }
  if (input.workspaceMember === true) {
    environment[CORAX_INTERNAL_AGENT_WORKSPACE_MEMBER_ENV] = "1";
  }

  return {
    config: {
      version: 3 as const,
      framework: {
        slug: CORAX_PACKAGE_NAME,
        version: resolveInstalledPackageInfo().version,
      },
    },
    functionRules: {
      [CORAX_WORKFLOW_FLOW_ROUTE_PATH]: {
        maxDuration: "max" as const,
        experimentalTriggers: [createCoraxWorkflowQueueTrigger(input.agentName)],
        environment,
      },
      // The consumer only exists when a collection stores its schedules in Vercel Schedules.
      ...(input.hasVercelScheduleCollections === true && {
        [CORAX_SCHEDULE_COLLECTION_CONSUMER_ROUTE_PATH]: {
          maxDuration: "max" as const,
          experimentalTriggers: [createCoraxScheduleQueueTrigger(input.agentName)],
          environment,
        },
      }),
    },
  };
}
