import { githubInstructions } from "corax/extensions/git/sandbox";
import { defineDynamic, defineInstructions } from "corax/instructions";

import { deprecatedGitHubConfigured } from "../lib/github-compat.ts";

/** @deprecated Mount `corax/extensions/git` with `github` config. */
export default defineDynamic({
  events: {
    "session.started": () =>
      deprecatedGitHubConfigured()
        ? defineInstructions({ content: githubInstructions(true) })
        : null,
  },
});
