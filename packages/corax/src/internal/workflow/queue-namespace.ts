export const WORKFLOW_QUEUE_NAMESPACE_ENV = "WORKFLOW_QUEUE_NAMESPACE";

/** Derives a stable Workflow queue namespace from an corax agent's unique name. */
export function deriveCoraxWorkflowQueueNamespace(agentName: string): string {
  const encodedAgentName = Array.from(new TextEncoder().encode(agentName), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return `corax${encodedAgentName}`;
}

/** Derives the queue prefix consumed by an corax agent's workflow handler. */
export function deriveCoraxWorkflowQueuePrefix(agentName: string): string {
  return `__${deriveCoraxWorkflowQueueNamespace(agentName)}_wkf_workflow_`;
}

/** Derives the queue topic registered for an corax agent's workflow handler. */
export function deriveCoraxWorkflowQueueTopic(agentName: string): string {
  return `${deriveCoraxWorkflowQueuePrefix(agentName)}*`;
}

/** Builds the Vercel queue trigger that invokes an corax agent's flow function. */
export function createCoraxWorkflowQueueTrigger(agentName: string) {
  return {
    type: "queue/v2beta" as const,
    topic: deriveCoraxWorkflowQueueTopic(agentName),
    consumer: "default",
    retryAfterSeconds: 5,
    initialDelaySeconds: 0,
  };
}

/** Installs the agent-scoped namespace used by Workflow runtime operations. */
export function installCoraxWorkflowQueueNamespace(agentName: string): string {
  const namespace = deriveCoraxWorkflowQueueNamespace(agentName);
  process.env[WORKFLOW_QUEUE_NAMESPACE_ENV] = namespace;
  return namespace;
}
