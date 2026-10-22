export const WORKFLOW_QUEUE_NAMESPACE_ENV = "WORKFLOW_QUEUE_NAMESPACE";

/** Derives a stable Workflow queue namespace from a corax agent's unique name. */
export function deriveCoraxWorkflowQueueNamespace(agentName: string): string {
  const encodedAgentName = Array.from(new TextEncoder().encode(agentName), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return `corax${encodedAgentName}`;
}

/** Derives the queue prefix consumed by a corax agent's workflow handler. */
export function deriveCoraxWorkflowQueuePrefix(agentName: string): string {
  return `__${deriveCoraxWorkflowQueueNamespace(agentName)}_wkf_workflow_`;
}

/** Installs the agent-scoped namespace used by Workflow runtime operations. */
export function installCoraxWorkflowQueueNamespace(agentName: string): string {
  const namespace = deriveCoraxWorkflowQueueNamespace(agentName);
  process.env[WORKFLOW_QUEUE_NAMESPACE_ENV] = namespace;
  return namespace;
}
