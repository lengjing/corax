import { ClientSessionStrandedError } from "#client/client-error.js";
import { resolveInstalledPackageInfo } from "#internal/application/package.js";

/**
 * One notice naming the session, the cause, the version pair, and the
 * command that gets the user unstuck; `undefined` for any other error. The
 * server's corax version is known only when the TUI runs its own dev server.
 */
export function formatStrandedSessionNotice(
  error: unknown,
  input: { readonly localServer: boolean; readonly sessionId: string | undefined },
): string | undefined {
  if (!(error instanceof ClientSessionStrandedError)) return undefined;
  const versions = [
    error.coraxVersion === undefined ? undefined : `built by corax ${error.coraxVersion}`,
    input.localServer
      ? `this dev server runs corax ${resolveInstalledPackageInfo().version}`
      : undefined,
  ].filter((part) => part !== undefined);
  const detail = versions.length === 0 ? "" : ` (${versions.join("; ")})`;
  const session = `Session ${input.sessionId ?? "unknown"}`;
  return `${session} is stranded${detail}: the deployment that ran it is no longer available. The session cannot continue. Run /new to end it and start a fresh session.`;
}
