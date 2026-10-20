import { connectionEntries } from "#compiled/corax-catalog/index.js";

/** Catalog MCP endpoints probed for reachability, keyed by connection slug. */
const MCP_CATALOG_ENDPOINTS: readonly { readonly slug: string; readonly url: string }[] =
  connectionEntries().flatMap((entry) => {
    const url = entry.connection?.mcp?.url;
    return url === undefined ? [] : [{ slug: entry.slug, url }];
  });

const DEFAULT_PROBE_INTERVAL_MS = 60_000;

export type McpConnectionProbe = (input: {
  url: string;
  signal: AbortSignal;
}) => Promise<string | undefined>;

export async function probeMcpConnection(input: {
  url: string;
  signal: AbortSignal;
}): Promise<string | undefined> {
  try {
    const response = await fetch(input.url, {
      method: "POST",
      signal: input.signal,
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-03-26",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "corax-connection-probe",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "corax", version: "connection-probe" },
        },
      }),
    });
    if (response.ok || response.status === 401 || response.status === 403) return undefined;
    return `${input.url} is not reachable (HTTP ${response.status}).`;
  } catch (error) {
    if (input.signal.aborted) throw error;
    const message = error instanceof Error ? error.message : "connection failed";
    return `${input.url} is not reachable (${message}).`;
  }
}

export interface McpConnectionStatusTracker {
  current(): Readonly<Record<string, string>>;
  refresh(): void;
  dispose(): void;
}

interface McpConnectionStatusTrackerOptions {
  onChange: (disabledConnectionReasons: Readonly<Record<string, string>>) => void;
  probe?: McpConnectionProbe;
  intervalMs?: number;
}

export function createMcpConnectionStatusTracker(
  options: McpConnectionStatusTrackerOptions,
): McpConnectionStatusTracker {
  const probe = options.probe ?? probeMcpConnection;
  const intervalMs = options.intervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
  let disabledConnectionReasons: Readonly<Record<string, string>> = {};
  let disposed = false;
  let epoch = 0;
  let controller: AbortController | undefined;
  const interval = setInterval(() => refresh(), intervalMs);
  interval.unref();

  const refresh = (): void => {
    if (disposed) return;
    controller?.abort();
    controller = new AbortController();
    const currentController = controller;
    const currentEpoch = ++epoch;
    void Promise.all(
      MCP_CATALOG_ENDPOINTS.map(({ slug, url }) =>
        probe({ url, signal: currentController.signal }).then((reason) => [slug, reason] as const),
      ),
    )
      .then((results) => {
        if (disposed || currentEpoch !== epoch) return;
        disabledConnectionReasons = Object.fromEntries(
          results.flatMap(([slug, reason]) => (reason === undefined ? [] : [[slug, reason]])),
        );
        options.onChange(disabledConnectionReasons);
      })
      .catch(() => {
        if (currentController.signal.aborted) return;
      });
  };

  return {
    current: () => disabledConnectionReasons,
    refresh,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      epoch += 1;
      controller?.abort();
      controller = undefined;
      clearInterval(interval);
    },
  };
}
