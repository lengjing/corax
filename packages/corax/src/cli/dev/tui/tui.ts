import { Client } from "#client/index.js";
import type { DevBootProgressReporter } from "#internal/dev-boot-progress.js";
import { resolveInstalledPackageInfo } from "#internal/application/package.js";
import { appendUserAgentProduct } from "#internal/user-agent.js";
import type { CommandLifecycle } from "#cli/shutdown.js";
import {
  resolveDevelopmentClientOptions,
  resolveLocalDevelopmentClientOptions,
} from "#services/dev-client/client-options.js";
import { createDevDiagnostics, type DevDiagnostics } from "../diagnostics.js";
import { promptCommandsFor, type ArgumentTypeaheadCommand } from "./prompt-commands.js";
import { CoraxTUIRunner, type CoraxTUIRunnerOptions } from "./runner.js";
import { TerminalRenderer } from "./terminal-renderer.js";
import type { PromptArgumentSuggestion } from "./argument-typeahead.js";
import type { DevelopmentTuiTarget } from "./target.js";
import type { TuiDisplayOptions } from "./types.js";

export type { DevelopmentTuiTarget } from "./target.js";

export interface RunDevelopmentTuiInput extends TuiDisplayOptions {
  /** The local server or remote URL used by this TUI session. */
  readonly target: DevelopmentTuiTarget;
  /** Additional request headers sent by this TUI client. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Text to seed the prompt input with after the UI launches. Applies to the first prompt only. */
  readonly initialInput?: string;
  /** Reports local CLI boot phases. Omitted for remote and programmatic TUI runs. */
  readonly onBootProgress?: DevBootProgressReporter;
  readonly lifecycle?: CommandLifecycle;
  /** Prepared editing-only startup UI reused by the initialized local runner. */
  startup?: DevelopmentTuiStartup;
}

async function inlineArgumentSuggestions(
  command: ArgumentTypeaheadCommand,
): Promise<readonly PromptArgumentSuggestion[]> {
  if (command === "loglevel") {
    return [
      { value: "none", label: "none", hint: "Hide logs" },
      { value: "error", label: "error", hint: "Errors only (default)" },
      { value: "warn", label: "warn", hint: "Warnings and errors" },
      { value: "debug", label: "debug", hint: "All severity-tagged logs" },
      { value: "all", label: "all", hint: "Include raw stdout and sandbox output" },
    ];
  }
  return [];
}

export interface DevelopmentTuiStartup {
  readonly diagnostics: DevDiagnostics | undefined;
  readonly renderer: TerminalRenderer;
  finish(): { draft: string; queuedPrompt: string | undefined };
  shutdown(): Promise<void>;
}

export async function startDevelopmentTuiStartup(
  input: TuiDisplayOptions & {
    readonly appRoot: string;
    readonly initialInput?: string;
    readonly onExitRequest: () => void;
  },
): Promise<DevelopmentTuiStartup> {
  const diagnostics = await createDevDiagnostics(input.appRoot).catch(() => undefined);
  const renderer = new TerminalRenderer({
    ...input,
    diagnostics,
    argumentSuggestions: inlineArgumentSuggestions,
    onExitRequest: input.onExitRequest,
  });
  renderer.beginStartupDraft({
    initialDraft: input.initialInput,
    title: input.name ?? "corax",
  });
  return {
    diagnostics,
    renderer,
    finish: () => renderer.finishStartupDraft(),
    async shutdown() {
      renderer.shutdown();
      await diagnostics?.close();
    },
  };
}

function withTuiUserAgent(
  headers: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const resolved = new Headers(headers);
  appendUserAgentProduct(resolved, `corax-tui/${resolveInstalledPackageInfo().version}`);
  return Object.fromEntries(resolved.entries());
}

/**
 * Runs the `corax dev` terminal UI against the given server URL until the
 * user exits.
 *
 * The configured client is handed to the runner so its subagent
 * child-session streams inherit the same auth. Turn-dispatch failures are
 * formatted into the inline error region rather than crashing the command.
 */
export async function runDevelopmentTui(input: RunDevelopmentTuiInput): Promise<void> {
  const { target, headers, initialInput, onBootProgress, lifecycle, startup, ...display } = input;
  const { serverUrl } = target;
  const headerOptions = { headers: withTuiUserAgent(headers) };

  const client = new Client(
    target.kind === "local"
      ? resolveLocalDevelopmentClientOptions({
          ...headerOptions,
          interactiveClient: true,
          serverUrl,
        })
      : { ...resolveDevelopmentClientOptions(serverUrl), ...headerOptions, redirect: "manual" },
  );

  const options: CoraxTUIRunnerOptions = {
    ...display,
    client,
    serverUrl,
    availablePromptCommands: promptCommandsFor(target.kind),
    argumentSuggestions: inlineArgumentSuggestions,
  };
  if (target.kind === "local") {
    options.appRoot = target.workspaceRoot;
  }
  if (initialInput !== undefined) options.initialInput = initialInput;
  if (startup !== undefined) {
    options.renderer = startup.renderer;
    options.startup = startup;
  }
  if (onBootProgress !== undefined) options.onBootProgress = onBootProgress;
  if (lifecycle !== undefined) options.lifecycle = lifecycle;

  const diagnostics =
    startup?.diagnostics ??
    (target.kind === "local"
      ? await createDevDiagnostics(target.workspaceRoot).catch(() => undefined)
      : undefined);
  if (diagnostics !== undefined) options.diagnostics = diagnostics;
  try {
    await new CoraxTUIRunner(options).run();
  } finally {
    await diagnostics?.close();
  }
}
