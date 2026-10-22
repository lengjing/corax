import { devBootPhase, type DevBootProgressReporter } from "#internal/dev-boot-progress.js";
import { findCoraxProjectContext } from "#internal/project-context.js";

import type { DevelopmentCliOptions } from "./command-options.js";
import { resolveTuiDisplayOptions } from "./ui-options.js";
import type { DevelopmentTuiStartup, RunDevelopmentTuiInput } from "./tui/tui.js";
import { resolveTuiTitle } from "./tui/target.js";
import type { CommandLifecycle } from "../shutdown.js";

export async function runInteractiveDevelopmentUi(input: {
  readonly applicationRoot: string;
  readonly lifecycle?: CommandLifecycle;
  readonly options: DevelopmentCliOptions;
  readonly report?: DevBootProgressReporter;
  readonly runDevelopmentTui?: (input: RunDevelopmentTuiInput) => Promise<void>;
  readonly server: { readonly appRoot?: string; readonly serverUrl: string };
  readonly startup?: DevelopmentTuiStartup;
}): Promise<void> {
  const runDevelopmentTui = await devBootPhase(
    "loading interactive UI",
    async () => input.runDevelopmentTui ?? (await import("#cli/dev/tui/tui.js")).runDevelopmentTui,
    input.report,
  );
  const projectContext = await findCoraxProjectContext(input.applicationRoot);
  const workspaceRoot =
    projectContext?.environmentRoot ?? input.server.appRoot ?? input.applicationRoot;
  const agentRoot =
    projectContext?.kind === "workspace-member" ? projectContext.member.appRoot : undefined;
  const target = {
    kind: "local" as const,
    serverUrl: input.server.serverUrl,
    workspaceRoot,
    agentRoot,
  };
  const display = resolveTuiDisplayOptions(input.options);
  const name = resolveTuiTitle({ name: input.options.name, target });
  if (name !== undefined) display.name = name;

  const tuiInput: RunDevelopmentTuiInput = {
    target,
    initialInput: input.options.input,
    onBootProgress: input.report,
    lifecycle: input.lifecycle,
    ...display,
  };
  if (input.startup !== undefined) tuiInput.startup = input.startup;
  await runDevelopmentTui(tuiInput);
}
