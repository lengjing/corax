import type { CompiledAgentManifest } from "#compiler/manifest.js";
import { isVercelSchedulesDevEnvironment } from "#internal/schedules/dev-environment.js";
import { deriveCoraxScheduleQueueTopic } from "#runtime/schedules/queue-namespace.js";

export const CORAX_SCHEDULE_COLLECTION_CONSUMER_ROUTE_PATH = "/.well-known/corax/v1/schedules/consumer";

/** Deliveries the queue attempts before giving up on an occurrence. */
export const CORAX_SCHEDULE_CONSUMER_MAX_DELIVERIES = 10;

/** The queue trigger that delivers an agent's scheduled occurrences to its consumer. */
export function createCoraxScheduleQueueTrigger(agentName: string) {
  return {
    type: "queue/v2beta" as const,
    topic: deriveCoraxScheduleQueueTopic(agentName),
    retryAfterSeconds: 5,
    initialDelaySeconds: 0,
    maxDeliveries: CORAX_SCHEDULE_CONSUMER_MAX_DELIVERIES,
  };
}

export function usesLocalVercelSchedules(
  manifest: Pick<CompiledAgentManifest, "scheduleCollections">,
): boolean {
  return isVercelSchedulesDevEnvironment() && hasVercelScheduleCollections(manifest);
}

/** Whether a build needs the Vercel schedule consumer: its route and its queue trigger. */
export function hasVercelScheduleCollections(manifest: {
  readonly scheduleCollections?: readonly { readonly providerKind: string }[];
}): boolean {
  return (
    manifest.scheduleCollections?.some((collection) => collection.providerKind === "vercel") ??
    false
  );
}
