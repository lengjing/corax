import { InvalidArgumentError, type Command } from "#compiled/commander/index.js";
import type { DevelopmentCliOptions } from "#cli/dev/command-options.js";
import { resolveTuiTitle } from "#cli/dev/tui/target.js";
import type { RunDevelopmentTuiInput } from "#cli/dev/tui/tui.js";
import { resolveTuiDisplayOptions } from "#cli/dev/ui-options.js";
import { parseDevelopmentHeaderOption, resolveDevelopmentUrlTarget } from "#cli/dev/url-target.js";
import { parseDevelopmentServerUrl } from "#cli/dev/url.js";
import {
  parseContextSizeOption,
  parseDisplayMode,
  parseLogsMode,
  parseStatsMode,
  parseSubagentDisplayMode,
} from "#cli/option-parsers.js";
import { installShutdownSignal } from "#cli/shutdown.js";

/** Connect to a self-hosted server without resolving or starting a local project. */
export function registerRemoteCommands(input: {
  readonly program: Command;
  readonly runtime: {
    readonly runDevelopmentTui?: (input: RunDevelopmentTuiInput) => Promise<void>;
    readonly isInteractiveTerminal?: () => boolean;
  };
}): void {
  const remote = input.program.command("remote").description("Connect to an existing corax agent.");
  remote.command("connect [url]")
    .description("Open the terminal UI for an existing corax server.")
    .option("--url <url>", "Server URL", parseDevelopmentServerUrl)
    .option("--header <header>", "HTTP request header (repeatable, Name: value)", parseDevelopmentHeaderOption)
    .option("--name <name>", "Title shown in the terminal UI")
    .option("--input <text>", "Pre-fill the prompt input")
    .option("--tools <mode>", "Tool calls: full | collapsed | auto-collapsed | hidden", parseDisplayMode)
    .option("--reasoning <mode>", "Reasoning: full | collapsed | auto-collapsed | hidden", parseDisplayMode)
    .option("--subagents <mode>", "Subagents: full | collapsed | hidden", parseSubagentDisplayMode)
    .option("--connection-auth <mode>", "Authorization: full | collapsed | auto-collapsed | hidden", parseDisplayMode)
    .option("--assistant-response-stats <mode>", "Response statistic: tokens | tokensPerSecond", parseStatsMode)
    .option("--context-size <tokens>", "Model context window size", parseContextSizeOption)
    .option("--logs <mode>", "Log severity: none | error | warn | debug | all", parseLogsMode)
    .action(async (url: string | undefined, options: DevelopmentCliOptions) => {
      const resolved = resolveDevelopmentUrlTarget(options, url);
      if (resolved === undefined) {
        throw new InvalidArgumentError("A server URL is required. Use corax remote connect --url <url>.");
      }
      const interactive = input.runtime.isInteractiveTerminal?.()
        ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
      if (!interactive) throw new InvalidArgumentError("corax remote connect requires an interactive terminal.");

      const runTui = input.runtime.runDevelopmentTui
        ?? (await import("#cli/dev/tui/tui.js")).runDevelopmentTui;
      const target = { kind: "remote" as const, serverUrl: resolved.serverUrl, workspaceRoot: process.cwd() };
      const lifecycle = installShutdownSignal();
      try {
        await runTui({
          ...resolveTuiDisplayOptions(options),
          target,
          headers: resolved.headers,
          name: resolveTuiTitle({ name: options.name, target }),
          initialInput: options.input,
          lifecycle,
        });
      } finally {
        lifecycle.dispose();
      }
    });
}
