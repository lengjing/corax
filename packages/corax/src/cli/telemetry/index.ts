/**
 * Minimal CLI telemetry surface. Corax does not collect or forward CLI
 * telemetry; these types and helpers only describe the hooks the CLI wiring
 * and the dev TUI still call, backed by {@link ./disabled.js}.
 */

export type CoraxCliSetupFlow = "init" | "extension_init" | "onboarding";
export type CoraxCliSetupStep =
  | "resolve_target"
  | "scaffold"
  | "install_dependencies"
  | "initialize_git"
  | "handoff"
  | "connection_ready"
  | "first_response"
  | "model_provider"
  | "model_settings"
  | "registry_channels"
  | "registry_integrations"
  | "registry_review"
  | "registry_install";
export type CoraxCliSetupTerminalResult = "completed" | "cancelled" | "error";

/** A bounded, non-sensitive reason for a failed setup terminal event. */
export type CoraxCliSetupFailureCode =
  | "target_resolution"
  | "target_conflict"
  | "target_invalid"
  | "target_filesystem"
  | "workspace_input"
  | "scaffolding"
  | "package_manager_not_found"
  | "package_manager_start_failed"
  | "workspace_probe_failed"
  | "workspace_probe_unrecognized"
  | "dependency_installation"
  | "git_initialization"
  | "handoff"
  | "onboarding";

export type CoraxCliSetupStepEvent = {
  flow: CoraxCliSetupFlow;
  step: CoraxCliSetupStep;
  registrySelectedCount?: number;
};

export type CoraxCliSetupTerminalEvent = {
  flow: CoraxCliSetupFlow;
  step: CoraxCliSetupStep;
  result: CoraxCliSetupTerminalResult;
  failureCode?: CoraxCliSetupFailureCode;
};

export type CoraxCliTelemetry = {
  trackCommand(command: string): void;
  trackDevContext(context: { target: "local" | "remote"; ui: "tui" | "headless" }): void;
  trackSetupStep(input: CoraxCliSetupStepEvent): void;
  trackSetupTerminal(input: CoraxCliSetupTerminalEvent): void;
  trackOutcome(outcome: "success" | "usage_error" | "error"): void;
  notify(logger: { error(message: string): void }): Promise<void>;
  flush(): Promise<void>;
};

const CLI_COMMANDS = new Map<string, string>([
  ["build", "build"],
  ["dev", "dev"],
  ["eval", "eval"],
  ["info", "info"],
  ["logs", "logs:show"],
  ["logs:list", "logs:list"],
  ["logs:show", "logs:show"],
  ["start", "start"],
  ["traces", "traces"],
  ["traces:list", "traces:list"],
  ["traces:show", "traces:show"],
]);

/** Returns only a known command path; it never includes user input. */
export function canonicalCommand(argv: readonly string[]): string {
  const firstArgument = argv[0];
  if (firstArgument === "--help" || firstArgument === "-h") return "help";
  if (firstArgument === "--version" || firstArgument === "-V") return "version";

  const commandIndex = argv.findIndex((argument) => !argument.startsWith("-"));
  const command = argv[commandIndex];
  if (command === undefined || /^https?:\/\//.test(command)) return "dev";

  const nested = argv.slice(commandIndex + 1).find((argument) => !argument.startsWith("-"));
  if (nested !== undefined) {
    const normalizedNested = nested === "ls" ? "list" : nested;
    const nestedCommand = CLI_COMMANDS.get(`${command}:${normalizedNested}`);
    if (nestedCommand !== undefined) return nestedCommand;
  }
  if (command === "logs" || command === "traces") return `${command}:show`;
  return CLI_COMMANDS.get(command) ?? "unknown";
}
