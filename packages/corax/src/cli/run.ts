import { Command, CommanderError } from "#compiled/commander/index.js";
import { registerBuildCommand, type BuildHost } from "#cli/commands/build.js";
import { resolveApplicationRoot } from "#internal/application/paths.js";
import { resolveInstalledPackageInfo } from "#internal/application/package.js";
import type { CliApplicationContext } from "#cli/application-command.js";
import { agentCommand } from "#cli/agent-command.js";
import { findCliApplicationRoot, resolveCliApplicationProject } from "#cli/application-root.js";
import { coraxCliBanner } from "#cli/banner.js";
import { registerDevelopmentCommand } from "#cli/dev/command.js";
import { resolveDevUiMode, resolveTuiDisplayOptions } from "#cli/dev/ui-options.js";
import { waitForShutdownSignal } from "#cli/shutdown.js";
import type { ProductionCliOptions } from "#cli/dev/command-options.js";
import type { RunDevelopmentTuiInput } from "#cli/dev/tui/tui.js";
import type { EvalCliOptions } from "#evals/cli/eval.js";
import { parsePortOption } from "#cli/option-parsers.js";
import { resolveCoraxProjectContext } from "#internal/project-context.js";
import { parseDevelopmentServerUrl } from "#cli/dev/url.js";
import { createCliTheme, renderCliTaggedLine } from "#cli/ui/output.js";
import { disabledCliTelemetry } from "#cli/telemetry/disabled.js";
import { canonicalCommand, type CoraxCliTelemetry } from "#cli/telemetry/index.js";
import type {
  DevelopmentServer,
  DevelopmentServerOptions,
  ProductionServerHandle,
} from "#internal/nitro/host/types.js";

export { resolveDevUiMode, resolveTuiDisplayOptions };

interface CliLogger {
  error(message: string): void;
  log(message: string): void;
}

interface CliRuntimeDependencies {
  findApplicationRoot(cwd: string): Promise<string | undefined>;
  buildHost: BuildHost;
  printApplicationInfo(
    logger: CliLogger,
    appRoot: string,
    options?: { json?: boolean },
  ): Promise<void>;
  runDevelopmentTui(input: RunDevelopmentTuiInput): Promise<void>;
  runEvalCommand(
    evalIds: readonly string[],
    options: EvalCliOptions,
    logger: CliLogger,
    appRoot: string,
  ): Promise<void>;
  startHost(appRoot: string, options?: DevelopmentServerOptions): DevelopmentServer;
  resolveApplicationProject: typeof resolveCliApplicationProject;
  startProductionHost(
    appRoot: string,
    options?: {
      host?: string;
      port?: number;
    },
  ): Promise<ProductionServerHandle>;
}

type CliRuntimeOverrides = Partial<CliRuntimeDependencies>;

async function loadPrintApplicationInfo(): Promise<CliRuntimeDependencies["printApplicationInfo"]> {
  return (await import("#cli/commands/info.js")).printApplicationInfo;
}

async function loadRunEvalCommand(): Promise<CliRuntimeDependencies["runEvalCommand"]> {
  return (await import("#evals/cli/eval.js")).runEvalCommand;
}

async function loadStartProductionHost(): Promise<CliRuntimeDependencies["startProductionHost"]> {
  return (await import("#internal/nitro/host.js")).startProductionServer;
}

export function createCliProgram(
  logger: CliLogger,
  runtime: CliRuntimeOverrides,
  applicationContext: CliApplicationContext,
  telemetry: Pick<CoraxCliTelemetry, "trackDevContext" | "trackSetupStep" | "trackSetupTerminal">,
): Command {
  const packageVersion = resolveInstalledPackageInfo().version;
  const program = new Command();
  const theme = createCliTheme();

  program
    .name("corax")
    .description("Discover, build and run local agent projects with Bun.")
    .version(packageVersion)
    .option("--root <directory>", "Agent project directory (defaults to current directory)")
    .showHelpAfterError()
    .exitOverride()
    .hook("preAction", (_program, actionCommand) => {
      const { json } = actionCommand.opts<{ json?: boolean }>();
      if (!json && actionCommand.name() === "info") {
        logger.log(coraxCliBanner());
      }
    })
    .configureOutput({
      writeErr: (message) => {
        logger.error(message.trimEnd());
      },
      writeOut: (message) => {
        logger.log(message.trimEnd());
      },
    });

  registerBuildCommand({
    applicationContext,
    buildHost: runtime.buildHost,
    logger,
    program,
  });

  agentCommand(program.command("start"), applicationContext)
    .description("Start a built corax application.")
    .option("--host <host>", "Host interface to bind")
    .option("--port <port>", "Port to listen on (defaults to $PORT, then 3000)", parsePortOption)
    .action(async (options: ProductionCliOptions) => {
      const { loadDevelopmentEnvironmentFiles } = await import("#cli/dev/environment.js");

      await loadDevelopmentEnvironmentFiles(applicationContext.root);

      const startProductionHost = runtime.startProductionHost ?? (await loadStartProductionHost());
      const server = await startProductionHost(applicationContext.root, {
        host: options.host,
        port: options.port,
      });

      logger.log(
        renderCliTaggedLine(theme, {
          message: `server listening at ${server.url}`,
          tag: "start",
          tone: "success",
        }),
      );

      await waitForShutdownSignal({ close: () => server.close(), wait: () => server.wait() });
    });


  registerDevelopmentCommand({
    applicationContext,
    logger,
    program,
    runtime,
    telemetry,
  });

  const logs = program
    .command("logs")
    .description("Inspect local `corax dev` diagnostic logs (.corax/logs).");

  agentCommand(logs.command("show [logid]", { isDefault: true }), applicationContext)
    .description("Print a diagnostic log (the most recent when logid is omitted).")
    .option("--dump", "Prepend the log's environment dump (.dump sibling)")
    .option("--events", "Interleave session events from the local workflow store")
    .action(async (logId: string | undefined, options: { dump?: boolean; events?: boolean }) => {
      const { runLogsShowCommand } = await import("#cli/commands/logs.js");
      await runLogsShowCommand(logger, applicationContext.root, logId, options);
    });

  agentCommand(logs.command("list").alias("ls"), applicationContext)
    .description("List diagnostic logs, most recent first.")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      const { runLogsListCommand } = await import("#cli/commands/logs.js");
      await runLogsListCommand(logger, applicationContext.root, options);
    });

  const traces = program
    .command("traces")
    .usage("[options] [trace]\n       corax traces list [options]")
    .description("Inspect local `corax dev` traces.");

  agentCommand(traces.command("show [trace]", { isDefault: true }), applicationContext)
    .description("Show a local trace (the most recent when trace is omitted).")
    .option("--verbose", "Expand every span with all attributes and events")
    .option("--json", "Output as JSON")
    .action(
      async (reference: string | undefined, options: { json?: boolean; verbose?: boolean }) => {
        const { runTraceShowCommand } = await import("#cli/commands/trace.js");
        await runTraceShowCommand(logger, applicationContext.root, reference, options);
      },
    );

  agentCommand(traces.command("list").alias("ls"), applicationContext)
    .description("List local traces, most recent first.")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      const { runTraceListCommand } = await import("#cli/commands/trace.js");
      await runTraceListCommand(logger, applicationContext.root, options);
    });

  agentCommand(program.command("info"), applicationContext)
    .description("Print resolved application information.")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      const printApplicationInfo =
        runtime.printApplicationInfo ?? (await loadPrintApplicationInfo());
      await printApplicationInfo(logger, applicationContext.root, options);
    });

  agentCommand(
    program.command("eval"),
    applicationContext,
    (command) => command.opts<EvalCliOptions>().url === undefined,
  )
    .description("Run evals against an corax agent.")
    .argument(
      "[evalIds...]",
      "Eval ids (or directory prefixes) to run (all discovered evals when omitted)",
    )
    .option("--url <url>", "Remote agent URL (skip local host startup)", parseDevelopmentServerUrl)
    .option("--tag <tag...>", "Run only evals carrying a tag")
    .option("--exclude-tag <tag...>", "Skip evals carrying a tag")
    .option("--strict", "Fail the exit code when any score falls below its threshold")
    .option("--list", "Print discovered evals without running them")
    .option("--timeout <ms>", "Per-eval timeout in milliseconds")
    .option("--max-concurrency <n>", "Max concurrent eval executions")
    .option("--json", "Output results as JSON")
    .option("--junit <path>", "Write JUnit XML results to a file")
    .option("--skip-report", "Skip eval-defined reporters (e.g. Braintrust)")
    .option("--verbose", "Stream per-eval logs and workflow run IDs to stdout")
    .action(async (evalIds: string[], options: EvalCliOptions) => {
      const runEvalCommand = runtime.runEvalCommand ?? (await loadRunEvalCommand());
      await runEvalCommand(evalIds, options, logger, applicationContext.root);
    });

  return program;
}

/** Runs the corax CLI entrypoint. */
export async function runCli(
  argv: string[] = process.argv.slice(2),
  logger: CliLogger = console,
  runtime: CliRuntimeOverrides = {},
): Promise<void> {
  const applicationContext: CliApplicationContext = {
    root: resolveApplicationRoot(),
    async resolve() {
      const project = await (runtime.resolveApplicationProject ?? resolveCliApplicationProject)(
        applicationContext.root,
      );
      applicationContext.project = project;
      applicationContext.root = project.appRoot;
    },
    async resolveAgent() {
      return resolveCoraxProjectContext(applicationContext.root);
    },
  };
  const telemetry = disabledCliTelemetry;
  const program = createCliProgram(logger, runtime, applicationContext, telemetry);
  let input = argv;
  if (input.length === 0) {
    const findApplicationRoot = runtime.findApplicationRoot ?? findCliApplicationRoot;
    const appRoot = await findApplicationRoot(applicationContext.root);
    if (appRoot === undefined) {
      input = ["dev"];
    } else {
      applicationContext.root = appRoot;
      input = ["dev"];
    }
  }
  const command = canonicalCommand(input);
  telemetry.trackCommand(command);
  if (command !== "telemetry") await telemetry.notify(logger);

  try {
    await program.parseAsync(input, {
      from: "user",
    });
    telemetry.trackOutcome("success");
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      telemetry.trackOutcome("success");
      return;
    }

    telemetry.trackOutcome(error instanceof CommanderError ? "usage_error" : "error");
    if (error instanceof CommanderError) {
      throw new Error(error.message);
    }

    throw error;
  } finally {
    await telemetry.flush();
  }
}
