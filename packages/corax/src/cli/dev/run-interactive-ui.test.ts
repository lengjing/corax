import { describe, expect, it, vi } from "vitest";

import type { CoraxProjectContext } from "#internal/project-context.js";

const { findCoraxProjectContext } = vi.hoisted(() => ({
  findCoraxProjectContext: vi.fn<() => Promise<CoraxProjectContext | undefined>>(),
}));

vi.mock("#internal/project-context.js", () => ({ findCoraxProjectContext }));

import { runInteractiveDevelopmentUi } from "./run-interactive-ui.js";

describe("runInteractiveDevelopmentUi", () => {
  it("preserves the selected workspace member when the server owns the workspace root", async () => {
    const memberRoot = "/workspace/agents/bar";
    findCoraxProjectContext.mockResolvedValue({
      environmentRoot: "/workspace",
      kind: "workspace-member",
      member: { appRoot: memberRoot, name: "bar" },
      workspace: {
        root: "/workspace",
        members: [{ appRoot: memberRoot, name: "bar" }],
      },
    });
    const runDevelopmentTui = vi.fn(async () => {});

    await runInteractiveDevelopmentUi({
      applicationRoot: memberRoot,
      options: {},
      runDevelopmentTui,
      server: { appRoot: "/workspace", serverUrl: "http://localhost:2000" },
    });

    expect(findCoraxProjectContext).toHaveBeenCalledWith(memberRoot);
    expect(runDevelopmentTui).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          agentRoot: memberRoot,
          kind: "local",
          serverUrl: "http://localhost:2000",
          workspaceRoot: "/workspace",
        },
      }),
    );
  });
});
