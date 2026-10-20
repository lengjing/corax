import { defineExtension } from "corax/extension";
import { z } from "zod";

import type { GitHubConfig, GitHubTokenSource } from "./lib/github-shell.ts";

export type { GitHubLeaseRule, GitHubTokenSource } from "./lib/github-shell.ts";
export type GitHubLeaseBroker = GitHubConfig["broker"];

const fn = <T>() => z.custom<T>((value) => typeof value === "function");

export default defineExtension({
  config: z.object({
    /**
     * Brokered GitHub access. When set, the extension contributes the
     * authenticated `gh` tool and the signed-commit pull request workflow.
     * `token` is an installation token or a function that mints one for the
     * declared repository. Without it, agents use the `gh` and `git` CLIs
     * from their own shell.
     */
    github: z
      .object({
        org: z.string().min(1),
        token: z.union([z.string().min(1), fn<Exclude<GitHubTokenSource, string>>()]),
        broker: fn<GitHubLeaseBroker>(),
      })
      .optional(),
  }),
});
