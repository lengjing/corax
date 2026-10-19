import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PromptCommandHandler } from "./runner.js";
import type { DevelopmentTuiTarget } from "./target.js";

function displayEndpoint(): string {
  try {
    const url = new URL(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1");
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "configured endpoint";
  }
}

export function createLocalPromptCommandHandler(
  target: DevelopmentTuiTarget,
): PromptCommandHandler {
  return {
    async handle(command) {
      if (target.kind !== "local") return { message: "Change configuration on the agent host." };
      const root = process.env.CORAX_CONFIG_ROOT || target.workspaceRoot;
      if (command.name === "model") {
        const model = command.argument.trim();
        if (!model) {
          return {
            message: `Model: ${process.env.CORAX_MODEL || "gpt-4.1-mini"}\nEndpoint: ${displayEndpoint()}\nUse /model <model-id> to save a model for the next restart.`,
          };
        }
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/.test(model)) {
          return {
            message: "Use /model <model-id> without spaces or control characters.",
            failed: true,
          };
        }
        const path = join(root, ".env");
        const existing = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        });
        const lines = existing
          .split(/\r?\n/)
          .filter((line) => !/^\s*(?:export\s+)?CORAX_MODEL\s*=/.test(line));
        while (lines.at(-1) === "") lines.pop();
        await writeFile(path, [...lines, `CORAX_MODEL=${model}`, ""].join("\n"), { mode: 0o600 });
        return {
          message: `Saved CORAX_MODEL=${model}. Restart dev, or rebuild the production application, to apply it.`,
        };
      }
      if (command.name === "login") {
        return {
          message: `Set OPENAI_API_KEY and OPENAI_BASE_URL in ${join(root, ".env")}, then restart. No hosted account login is required.`,
        };
      }
      if (command.name === "add") {
        return {
          message:
            "Add tools, skills, MCP/OpenAPI connections, and schedules as files under agent/. Hosted integration provisioning is not used.",
        };
      }
      return {
        message:
          "Deploy the built application with your own process manager or container platform.",
        failed: true,
      };
    },
  };
}
