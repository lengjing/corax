import { resolve } from "node:path";

import type { Command } from "#compiled/commander/index.js";
import type { CliApplicationContext } from "#cli/application-command.js";
import { createCliTheme, renderCliTaggedLine } from "#cli/ui/output.js";
import type { ApplicationBuildOptions } from "#internal/nitro/host/types.js";
import {
  CORAX_PUBLIC_ROUTE_PREFIX_ENV,
  normalizePublicRoutePrefix,
} from "#shared/public-route-prefix.js";

export type BuildHost = (appRoot: string, options: ApplicationBuildOptions) => Promise<string>;

interface BuildCommandLogger {
  log(message: string): void;
}

interface BuildCliOptions {
  profile?: string;
  skipSandboxPrewarm?: boolean;
}

/** Registers the production application build command. */
export function registerBuildCommand(input: {
  readonly applicationContext: CliApplicationContext;
  readonly buildHost?: BuildHost;
  readonly logger: BuildCommandLogger;
  readonly program: Command;
}): void {
  const theme = createCliTheme();

  input.program
    .command("build")
    .hook("preAction", async () => {
      const context = await input.applicationContext.resolveAgent();
      if (context.kind !== "workspace") await input.applicationContext.resolve();
    })
    .description("Build the current corax application.")
    .option("--profile <path>", "Write best-effort timing and output-size profile JSON to a file")
    .option("--skip-sandbox-prewarm", "Skip sandbox preparation; output may not be deployable")
    .action(async (options: BuildCliOptions) => {
      const { loadDevelopmentEnvironmentFiles } = await import("#cli/dev/environment.js");

      await loadDevelopmentEnvironmentFiles(input.applicationContext.root);

      const projectContext = await input.applicationContext.resolveAgent();
      if (projectContext.kind === "workspace") {
        throw new Error(
          "`corax build` must run from an individual agent directory. Run it inside the agent, or pass --agent <name>.",
        );
      }
      const buildHost =
        input.buildHost ?? (await import("#internal/nitro/host.js")).buildApplication;
      const profileOutputPath =
        options.profile === undefined
          ? undefined
          : resolve(input.applicationContext.root, options.profile);
      const buildOptions: {
        profileOutputPath?: string;
        readonly publicRoutePrefix: ApplicationBuildOptions["publicRoutePrefix"];
        readonly skipSandboxPrewarm: boolean;
        readonly workspaceMember: boolean;
      } = {
        publicRoutePrefix: normalizePublicRoutePrefix(process.env[CORAX_PUBLIC_ROUTE_PREFIX_ENV]),
        skipSandboxPrewarm: options.skipSandboxPrewarm === true,
        workspaceMember: projectContext.kind === "workspace-member",
      };
      if (profileOutputPath !== undefined) {
        buildOptions.profileOutputPath = profileOutputPath;
      }
      const outputDir = await buildHost(input.applicationContext.root, buildOptions);
      input.logger.log(
        renderCliTaggedLine(theme, {
          message: `built output at ${outputDir}`,
          tag: "build",
          tone: "success",
        }),
      );
    });
}
