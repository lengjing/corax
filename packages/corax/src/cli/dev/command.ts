import { InvalidArgumentError, type Command } from "#compiled/commander/index.js";
import type { CliApplicationContext } from "#cli/application-command.js";
import { agentCommand } from "#cli/agent-command.js";
import { coraxCliBanner } from "#cli/banner.js";
import { FORCED_EXIT_BACKSTOP_MS, installShutdownSignal } from "#cli/shutdown.js";
import { startCliLiveRow } from "#cli/ui/live-row.js";
import { createCliTheme, renderCliTaggedLine } from "#cli/ui/output.js";
import { noDevelopmentExtensions } from "#compiler/development-extensions.js";
import type { DevelopmentServer, DevelopmentServerOptions } from "#internal/nitro/host/types.js";

import { createDevBootProgressReporter } from "./boot-progress.js";
import type { DevelopmentCliOptions } from "./command-options.js";
import { runInteractiveDevelopmentUi } from "./run-interactive-ui.js";
import type { DevelopmentTuiStartup, RunDevelopmentTuiInput } from "./tui/tui.js";
import { resolveDevUiMode, resolveTuiDisplayOptions } from "./ui-options.js";
import { waitForServerOrStop, waitForUiOrServer } from "./wait-for-ui.js";
import {
  parseContextSizeOption,
  parseDisplayMode,
  parseLogsMode,
  parsePortOption,
  parseStatsMode,
  parseSubagentDisplayMode,
} from "../option-parsers.js";

interface DevelopmentCommandLogger {
  log(message: string): void;
}

interface DevelopmentCommandRuntime {
  runDevelopmentTui?: (input: RunDevelopmentTuiInput) => Promise<void>;
  startHost?: (appRoot: string, options?: DevelopmentServerOptions) => DevelopmentServer;
}

async function loadDevelopmentTuiModule() {
  return await import("#cli/dev/tui/tui.js");
}

async function loadStartHost(): Promise<NonNullable<DevelopmentCommandRuntime["startHost"]>> {
  return (await import("#cli/dev/local-server-process.js")).createDevelopmentServer;
}

function hasInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Registers the local development server command. */
export function registerDevelopmentCommand(input: {
  applicationContext: CliApplicationContext;
  logger: DevelopmentCommandLogger;
  program: Command;
  runtime: DevelopmentCommandRuntime;
}): void {
  const { applicationContext, logger, program, runtime } = input;
  const theme = createCliTheme();

  agentCommand(program.command("dev"), applicationContext)
    .description("Start the local corax development server.")
    .option("--host <host>", "Host interface to bind")
    .option("--port <port>", "Port to listen on (defaults to $PORT, then 2000)", parsePortOption)
    .option("--no-ui", "Start the server without an interactive UI")
    .option("--resume", "Attempt recovery of retained runs from previous local dev invocations")
    .option(
      "--default-extensions",
      "Mount the built-in development extensions (self-modification, computer-use, git)",
    )
    .option("--name <name>", "Title shown in the terminal UI (defaults to the app folder name)")
    .option("--input <text>", "Pre-fill the prompt input")
    .option(
      "--tools <mode>",
      "How tool calls render: full | collapsed | auto-collapsed | hidden",
      parseDisplayMode,
    )
    .option(
      "--reasoning <mode>",
      "How reasoning renders: full | collapsed | auto-collapsed | hidden",
      parseDisplayMode,
    )
    .option(
      "--subagents <mode>",
      "How subagent tasks render: full | collapsed | hidden",
      parseSubagentDisplayMode,
    )
    .option(
      "--connection-auth <mode>",
      "How connection authorization renders: full | collapsed | auto-collapsed | hidden",
      parseDisplayMode,
    )
    .option(
      "--assistant-response-stats <mode>",
      "Assistant header statistic: tokens | tokensPerSecond",
      parseStatsMode,
    )
    .option(
      "--context-size <tokens>",
      "Model context window size, shown as a usage percentage",
      parseContextSizeOption,
    )
    .option("--logs <mode>", "Log severity: none | error | warn | debug | all", parseLogsMode)
    .action(async (options: DevelopmentCliOptions) => {
      const interactive = hasInteractiveTerminal();
      const mode = resolveDevUiMode({ options, interactive });
      if (mode === "headless") logger.log(coraxCliBanner());
      if (options.input !== undefined && mode === "headless") {
        throw new InvalidArgumentError("--input requires the interactive UI.");
      }
      const buildProgress = mode === "tui" ? startCliLiveRow(logger, { elapsed: true }) : undefined;
      const onBootProgress = createDevBootProgressReporter(buildProgress);
      buildProgress?.update("Starting your agent");

      let server: DevelopmentServer | undefined;
      let closePromise: Promise<void> | undefined;
      const closeServer = () => {
        if (server === undefined) return Promise.resolve();
        closePromise ??= server.close();
        void closePromise.catch(() => undefined);
        return closePromise;
      };
      const lifecycle = installShutdownSignal({
        exitAfterMs: FORCED_EXIT_BACKSTOP_MS,
        onStop: () => {
          void closeServer();
        },
      });

      let tuiStartup: DevelopmentTuiStartup | undefined;
      const tuiStartupPromise =
        mode === "tui" && runtime.runDevelopmentTui === undefined
          ? loadDevelopmentTuiModule().then((module) => {
              onBootProgress({ type: "before-first-paint" });
              return module.startDevelopmentTuiStartup({
                appRoot: applicationContext.root,
                initialInput: options.input,
                onExitRequest: lifecycle.requestStop,
                ...resolveTuiDisplayOptions(options),
              });
            })
          : undefined;

      try {
        const startHost = runtime.startHost ?? (await loadStartHost());
        server = startHost(applicationContext.root, {
          // Built-in extensions stay off unless requested so dev matches `build`/`start`.
          ...(options.defaultExtensions
            ? {}
            : { developmentExtensions: noDevelopmentExtensions() }),
          resume: options.resume,
          existing: mode === "tui" ? "attach-if-unconfigured" : "reject",
          host: options.host,
          onBootProgress,
          port: options.port,
        });
        const [outcome, startup] = await Promise.all([
          Promise.race([
            server.start().then((handle) => ({ handle })),
            lifecycle.stopped.then(() => ({ handle: undefined })),
          ]),
          tuiStartupPromise,
        ]);
        const handle = outcome.handle;
        if (handle === undefined) {
          tuiStartup = startup;
          await tuiStartup?.shutdown();
          return;
        }
        tuiStartup = startup;

        if (mode !== "tui") {
          logger.log(
            renderCliTaggedLine(theme, {
              message: `server listening at ${handle.url}`,
              tag: "dev",
              tone: "success",
            }),
          );
        }

        if (mode === "headless") {
          if (options.ui !== false && !interactive) {
            logger.log(
              renderCliTaggedLine(theme, {
                message: "Interactive UI disabled because the current terminal is not a TTY.",
                tag: "dev",
                tone: "warning",
              }),
            );
          }

          await waitForServerOrStop(server, lifecycle);
          return;
        }

        await waitForUiOrServer({
          handle,
          lifecycle,
          server,
          runUi: async () =>
            await runInteractiveDevelopmentUi({
              applicationRoot: applicationContext.root,
              lifecycle,
              options,
              report: onBootProgress,
              runDevelopmentTui: runtime.runDevelopmentTui,
              server: { appRoot: handle.appRoot, serverUrl: handle.url },
              startup: tuiStartup,
            }),
        });
      } finally {
        buildProgress?.stop();
        if (tuiStartup === undefined) {
          tuiStartup = await tuiStartupPromise?.catch(() => undefined);
          await tuiStartup?.shutdown();
        }
        await closeServer();
        lifecycle.dispose();
      }
    });
}
