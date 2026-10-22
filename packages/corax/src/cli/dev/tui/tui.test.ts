import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CoraxTUIRunnerOptions } from "./runner.js";

const mocks = vi.hoisted<{ runnerOptions: CoraxTUIRunnerOptions[] }>(() => ({
  runnerOptions: [],
}));

vi.mock("./runner.js", () => ({
  CoraxTUIRunner: class {
    constructor(options: CoraxTUIRunnerOptions) {
      mocks.runnerOptions.push(options);
    }

    async run(): Promise<void> {}
  },
}));

import { runDevelopmentTui, type DevelopmentTuiTarget } from "./tui.js";

describe("runDevelopmentTui", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.runnerOptions.length = 0;
  });

  it("creates a fresh client and defers session creation until the first prompt", async () => {
    const target = {
      kind: "local",
      serverUrl: "http://127.0.0.1:4321/",
      workspaceRoot: "/tmp/app",
    } satisfies DevelopmentTuiTarget;
    await runDevelopmentTui({ target });
    await runDevelopmentTui({ target });

    expect(mocks.runnerOptions).toHaveLength(2);
    const [first, second] = mocks.runnerOptions;
    if (first === undefined || second === undefined) {
      throw new Error("Expected two TUI runner invocations.");
    }
    expect(first.client).not.toBe(second.client);
  });

  it("offers log levels for inline argument completion", async () => {
    await runDevelopmentTui({
      target: {
        kind: "local",
        serverUrl: "http://127.0.0.1:4321/",
        workspaceRoot: "/tmp/app",
      },
    });

    const suggestions = await mocks.runnerOptions[0]?.argumentSuggestions?.("loglevel");
    expect(suggestions?.map((suggestion) => suggestion.value)).toEqual([
      "none",
      "error",
      "warn",
      "debug",
      "all",
    ]);
  });

  it.each([
    [
      "remote",
      {
        kind: "remote",
        serverUrl: "https://remote.example.com/",
        workspaceRoot: "/tmp/app",
      },
    ],
    [
      "local",
      {
        kind: "local",
        serverUrl: "http://127.0.0.1:4321/",
        workspaceRoot: "/tmp/app",
      },
    ],
  ] satisfies Array<readonly [string, DevelopmentTuiTarget]>)(
    "passes explicit headers to %s TUI client requests",
    async (_name, target) => {
      await runDevelopmentTui({
        headers: {
          authorization: "Basic dGVzdDpzZWNyZXQ=",
          "User-Agent": "caller/1.0",
          "x-tenant": "acme",
        },
        target,
      });

      const client = mocks.runnerOptions[0]?.client;
      if (client === undefined) {
        throw new Error("Expected a TUI client.");
      }

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
      await client.fetch("/corax/v1/info");

      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      expect(headers.get("authorization")).toBe("Basic dGVzdDpzZWNyZXQ=");
      expect(headers.get("user-agent")).toMatch(/^caller\/1\.0 corax-tui\/.+/);
      expect(headers.get("x-tenant")).toBe("acme");
    },
  );
});
