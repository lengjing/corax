const AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const CORAX_NAMED_AGENT_ROUTE_PREFIX = "/corax";

export function resolveCoraxAgentHost(input: {
  readonly agent?: string;
  readonly host?: string;
}): string {
  if (input.agent === undefined) {
    return input.host ?? "";
  }

  if (input.host !== undefined) {
    throw new Error("useCoraxAgent cannot combine agent and host. Use one target option.");
  }

  assertValidAgentName(input.agent);
  return `${CORAX_NAMED_AGENT_ROUTE_PREFIX}/${input.agent}`;
}

function assertValidAgentName(name: string): void {
  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new Error(
      `corax agent name ${JSON.stringify(
        name,
      )} is invalid. Use lowercase letters, numbers, underscores, or hyphens, starting with a letter or number.`,
    );
  }
}
