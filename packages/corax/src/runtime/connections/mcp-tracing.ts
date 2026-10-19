import { stripCoraxTraceBaggage } from "#protocol/baggage.js";
import { createMcpTraceFetch as traceFetch } from "#tracing/corax/mcp.js";
import { createMcpTracing } from "#tracing/corax/mcp.js";

export function createMcpTraceFetch(input: Parameters<typeof traceFetch>[0]): typeof fetch {
  return traceFetch({ ...input, filterCarrier: stripCoraxTraceBaggage });
}

export function withMcpToolsListSpan<T>(input: {
  connectionName: string;
  protocolVersion?: string;
  execute: () => Promise<T>;
}): Promise<T> {
  return createMcpTracing().list(input);
}

export function withMcpToolCallSpan<T>(input: {
  connectionName: string;
  protocolVersion?: string;
  toolName: string;
  arguments: unknown;
  execute: () => Promise<T>;
}): Promise<T> {
  return createMcpTracing().call(input);
}
