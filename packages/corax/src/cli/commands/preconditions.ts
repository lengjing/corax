import type { CoraxProjectContext } from "#internal/project-context.js";
import { findCoraxProjectContext } from "#internal/project-context.js";
import { isCoraxProject } from "#setup/scaffold/index.js";

/**
 * Refusal shown by agent-scoped commands (`corax link`, `corax deploy`,
 * `corax channels …`) when the working directory holds no corax agent.
 */
export const NOT_AN_AGENT_MESSAGE =
  "No corax agent in this directory. Run `corax init <name>`, then run this command from inside the new project.";

interface ProjectCommandLogger {
  error(message: string): void;
}

/** Validate that a Vercel project command targets a workspace root or an corax app. */
export async function validateWorkspaceProjectCommand(input: {
  readonly appRoot: string;
  readonly isCoraxProject?: typeof isCoraxProject;
  readonly logger: ProjectCommandLogger;
  readonly workspaceMemberMessage: (
    workspace: Extract<CoraxProjectContext, { kind: "workspace" }>["workspace"],
  ) => string;
}): Promise<boolean> {
  const projectContext = await findCoraxProjectContext(input.appRoot);
  if (projectContext?.kind === "workspace-member") {
    input.logger.error(input.workspaceMemberMessage(projectContext.workspace));
    process.exitCode = 1;
    return false;
  }
  if (
    projectContext === undefined ||
    (projectContext.kind === "standalone" &&
      !(await (input.isCoraxProject ?? isCoraxProject)(input.appRoot)))
  ) {
    input.logger.error(NOT_AN_AGENT_MESSAGE);
    process.exitCode = 1;
    return false;
  }
  return true;
}

/** True when stdin and stdout are both TTYs — the default interactivity gate. */
export function hasInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
