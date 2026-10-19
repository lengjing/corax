import { prSkillDescription, prSkillMarkdown } from "corax/extensions/git/sandbox";
import { defineDynamic, defineSkill } from "corax/skills";

import { deprecatedGitHubConfigured } from "../lib/github-compat.ts";

/** @deprecated Mount `corax/extensions/git`, which contributes the same skill as `git__pr`. */
export default defineDynamic({
  events: {
    "session.started": () =>
      deprecatedGitHubConfigured()
        ? defineSkill({ description: prSkillDescription(true), markdown: prSkillMarkdown(true) })
        : null,
  },
});
