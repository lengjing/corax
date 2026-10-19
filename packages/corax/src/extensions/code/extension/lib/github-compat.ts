/**
 * Deprecated `code({ github })` support. GitHub moved to `corax/extensions/git`;
 * these contributions resolve only while the deprecated `github` config is set,
 * so `code({})` contributes no GitHub tool, instructions, or pull request skill.
 */
import { defineGhTool } from "corax/extensions/git/sandbox";

import extension from "../extension.ts";

export function deprecatedGitHubConfigured(): boolean {
  return extension.config.github !== undefined;
}

/** @deprecated Mount `corax/extensions/git` with `github` config, or import `gh` from `corax/extensions/git/tools`. */
export const gh = defineGhTool(() => extension.config.github);
