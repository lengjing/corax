import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../packages/corax/dist/src/cli/run.js";

const logger = { log() {}, error() {} };
const localForbidden = () => { throw new Error("Remote connect must not access a local project or server"); };
const runtime = {
  isInteractiveTerminal: () => true,
  resolveApplicationProject: localForbidden,
  startHost: localForbidden,
  startProductionHost: localForbidden,
};

test("remote connect opens the remote TUI without a local project and restores signal listeners", async () => {
  const before = process.listenerCount("SIGINT");
  let calls = 0;
  await runCli(["remote", "connect", "--url", "http://localhost:3000", "--input", "hello", "--tools", "full"], logger, {
    ...runtime,
    async runDevelopmentTui(input) {
      calls++;
      assert.deepEqual(input.target, { kind: "remote", serverUrl: "http://localhost:3000/", workspaceRoot: process.cwd() });
      assert.equal(input.name, "localhost:3000");
      assert.equal(input.initialInput, "hello");
      assert.equal(input.tools, "full");
      assert.equal(input.headers, undefined);
      assert.equal(input.lifecycle.signal.aborted, false);
    },
  });
  assert.equal(calls, 1);
  assert.equal(process.listenerCount("SIGINT"), before);
});

test("remote connect extracts Basic auth, permits explicit header overrides and hides URL credentials", async () => {
  await runCli(["remote", "connect", "http://admin:p%40ss@localhost:3000/prefix", "--header", "X-Tenant: alice"], logger, {
    ...runtime,
    async runDevelopmentTui(input) {
      assert.equal(input.target.serverUrl, "http://localhost:3000/prefix");
      assert.equal(input.name, "localhost:3000");
      assert.equal(input.headers.Authorization, `Basic ${Buffer.from("admin:p@ss").toString("base64")}`);
      assert.equal(input.headers["X-Tenant"], "alice");
    },
  });
  await runCli(["remote", "connect", "--url", "https://admin:secret@example.com", "--header", "authorization: Bearer explicit", "--header", "X-Tenant: bob"], logger, {
    ...runtime,
    async runDevelopmentTui(input) {
      assert.deepEqual(input.headers, { authorization: "Bearer explicit", "X-Tenant": "bob" });
      assert.equal(input.target.serverUrl, "https://example.com/");
    },
  });
});

test("remote connect validates arguments and terminal mode before launching the TUI", async () => {
  for (const [args, message] of [
    [[], /server URL is required/],
    [["--url", "file:///tmp/agent"], /http\(s\) URL/],
    [["--url", "https://example.com", "https://other.example.com"], /not both/],
    [["--url", "http://localhost:3000", "--header", "invalid"], /Name: value/],
  ]) {
    await assert.rejects(runCli(["remote", "connect", ...args], logger, { ...runtime, runDevelopmentTui: localForbidden }), message);
  }
  await assert.rejects(runCli(["remote", "connect", "--url", "http://localhost:3000"], logger, {
    ...runtime, isInteractiveTerminal: () => false, runDevelopmentTui: localForbidden,
  }), /interactive terminal/);
});

test("remote TUI errors propagate without leaking command signal listeners", async () => {
  const before = process.listenerCount("SIGTERM");
  await assert.rejects(runCli(["remote", "connect", "http://localhost:3000"], logger, {
    ...runtime, async runDevelopmentTui() { throw new Error("connection failed"); },
  }), /connection failed/);
  assert.equal(process.listenerCount("SIGTERM"), before);
});
