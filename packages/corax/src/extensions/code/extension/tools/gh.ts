import { defineDynamic } from "corax/tools";

import { deprecatedGitHubConfigured, gh } from "../lib/github-compat.ts";

/** @deprecated Mount `corax/extensions/git` with `github` config. */
export default defineDynamic({
  events: {
    "session.started": () => (deprecatedGitHubConfigured() ? gh : null),
  },
});
