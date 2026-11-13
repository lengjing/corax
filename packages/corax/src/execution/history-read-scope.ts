import { AsyncLocalStorage } from "node:async_hooks";

interface HistoryReadScope {
  readonly sessionId: string;
  tail?: Promise<number>;
}

// Nitro and registry runtime module copies must share the carrier, not tail values
// across requests. A finite response owns its fixed boundary even during appends.
const key = Symbol.for("@coraxjs/core:finite-history-read-scope:v1");
const container = globalThis as typeof globalThis & {
  [key]?: AsyncLocalStorage<HistoryReadScope>;
};
const historyReads = (container[key] ??= new AsyncLocalStorage<HistoryReadScope>());

export function withHistoryReadScope<T>(sessionId: string, read: () => T): T {
  return historyReads.run({ sessionId }, read);
}

export function readScopedTail(sessionId: string, read: () => Promise<number>): Promise<number> {
  const scope = historyReads.getStore();
  if (!scope || scope.sessionId !== sessionId) return read();
  return (scope.tail ??= Promise.resolve().then(read));
}
