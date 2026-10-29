import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Client, type AgentInfoResult } from "#client/index.js";
import { createTestAgentInfoResult } from "#internal/testing/agent-info-fixture.js";

import { CoraxTUIRunner, type AgentTUIRenderer } from "./runner.js";
import { detectSetupIssues, formatSetupIssuesLine, type SetupIssue } from "./setup-issues.js";
import { TerminalRenderer } from "./terminal-renderer.js";
import { MockScreen, MockUserInput } from "./test/mock-terminal.js";
import { parsePromptCommand } from "./prompt-commands.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE_GATEWAY_INFO = createTestAgentInfoResult({
  agentRoot: "/app/agent",
  appRoot: "/app",
  modelId: "openai/gpt-5.5",
  name: "Agent",
});
const DISCONNECTED_GATEWAY_INFO: AgentInfoResult = {
  ...BASE_GATEWAY_INFO,
  agent: {
    ...BASE_GATEWAY_INFO.agent,
    model: {
      endpoint: { kind: "gateway", connected: false },
      id: "openai/gpt-5.5",
      routing: { kind: "gateway", target: "openai" },
    },
  },
};

async function linkedAppRoot(): Promise<string> {
  const appRoot = await mkdtemp(join(tmpdir(), "corax-boot-detect-"));
  await mkdir(join(appRoot, ".vercel"), { recursive: true });
  await writeFile(join(appRoot, ".vercel", "project.json"), "{}", "utf8");
  return appRoot;
}

describe("BOOT_DETECTIONS against a real directory", () => {
  it("stays quiet when a compiled gateway model has a credential present", async () => {
    const appRoot = await linkedAppRoot();
    const issues = await detectSetupIssues({
      appRoot,
      env: { AI_GATEWAY_API_KEY: "k" },
      info: DISCONNECTED_GATEWAY_INFO,
    });
    expect(issues).toEqual([]);
  });

  it("defers model diagnosis when runtime info is unavailable", async () => {
    const appRoot = await linkedAppRoot();
    expect(await detectSetupIssues({ appRoot, env: {} })).toEqual([]);
  });

  it("diagnoses a linked project with disconnected model access", async () => {
    const appRoot = await linkedAppRoot();
    const issues = await detectSetupIssues({
      appRoot,
      env: {},
      info: DISCONNECTED_GATEWAY_INFO,
    });

    expect(issues).toEqual([
      {
        kind: "attention",
        label: "AI Gateway credentials missing",
        helper: expect.stringContaining("AI_GATEWAY_API_KEY"),
      },
    ]);
    const screen = new MockScreen({ columns: 240, rows: 30 });
    const renderer = new TerminalRenderer({
      input: new MockUserInput(),
      output: screen,
      captureForeignOutput: false,
      unicode: true,
    });
    renderer.renderSetupWarning(formatSetupIssuesLine(issues));
    const rendered = screen.snapshot();
    renderer.shutdown();
    expect(rendered).toContain("AI_GATEWAY_API_KEY");
    expect(rendered).toContain("restart corax dev");
    expect(rendered).not.toMatch(/\/(?:login|model)\b/);
    expect(parsePromptCommand("/login")).toBeNull();
    expect(parsePromptCommand("/model")).toBeNull();
    for (const issue of issues) {
      if (issue.command !== undefined) expect(parsePromptCommand(issue.command)).not.toBeNull();
    }
  });

  it("renders boot setup issues before opening the composer when inspection is unavailable", async () => {
    const appRoot = await linkedAppRoot();
    const client = new Client({ host: "http://localhost:3000" });
    vi.spyOn(client, "info").mockRejectedValue(new Error("inspection unavailable"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ revision: "snapshot-a" })),
    );
    const order: string[] = [];
    const issue: SetupIssue = {
      kind: "attention",
      label: "Local configuration needs attention",
      command: "/info",
    };
    const renderSetupWarning = vi.fn(() => {
      order.push("warning");
    });
    const readInput = vi.fn(async () => {
      order.push("prompt");
      return undefined;
    });
    const renderer: AgentTUIRenderer = {
      readInput,
      renderSetupWarning,
    };
    const runner = new CoraxTUIRunner({
      appRoot,
      client,
      bootDetections: [{ id: "test-configuration", detect: () => [issue] }],
      renderer,
      serverUrl: "http://localhost:3000",
    });

    await runner.run();

    expect(renderSetupWarning).toHaveBeenCalledExactlyOnceWith(formatSetupIssuesLine([issue]));
    expect(readInput).toHaveBeenCalledOnce();
    expect(order).toEqual(["warning", "prompt"]);
  });
});
