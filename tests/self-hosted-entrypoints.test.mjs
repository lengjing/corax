import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "./support/test.mjs";
import { createCliProgram } from "../packages/corax/dist/src/cli/run.js";
import { disabledCliTelemetry } from "../packages/corax/dist/src/cli/telemetry/disabled.js";
import { createLocalPromptCommandHandler } from "../packages/corax/dist/src/cli/dev/tui/local-commands.js";
import {
  seedInstrumentationProviders,
  getInstrumentationProviders,
} from "../packages/corax/dist/src/instrumentation/providers.js";
import { localDev } from "../packages/corax/dist/src/public/channels/auth.js";
import { resolveWorkflowWorldImport } from "../packages/corax/dist/src/internal/workflow/world-target.js";
import { resolveOutputDirectory } from "../packages/corax/dist/src/internal/application/paths.js";

test("the product CLI exposes local execution rather than hosted provisioning commands", () => {
  const program = createCliProgram(
    { log() {}, error() {} },
    {},
    { root: process.cwd() },
    disabledCliTelemetry,
  );
  const commands = program.commands.map((command) => command.name());
  assert.equal(program.name(), "corax");
  for (const local of ["dev", "build", "start", "info", "eval"])
    assert.ok(commands.includes(local));
  for (const hosted of ["deploy", "link", "integration", "registry", "init", "extension", "set", "telemetry"])
    assert.ok(!commands.includes(hosted));
});

test("model configuration preserves local secrets and does not enter a cloud login flow", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "corax-config-"));
  const previous = process.env.CORAX_CONFIG_ROOT;
  process.env.CORAX_CONFIG_ROOT = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.CORAX_CONFIG_ROOT;
    else process.env.CORAX_CONFIG_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(
    join(root, ".env"),
    "# Local credentials\nOPENAI_API_KEY=test-only-secret\nCORAX_MODEL=old-model\n",
  );
  const handler = createLocalPromptCommandHandler({
    kind: "local",
    workspaceRoot: root,
    serverUrl: "http://127.0.0.1:2000",
  });
  const outcome = await handler.handle({
    type: "extension",
    name: "model",
    argument: "private/model-v2",
  });
  assert.match(outcome.message, /Restart/);
  const contents = await readFile(join(root, ".env"), "utf8");
  assert.match(contents, /OPENAI_API_KEY=test-only-secret/);
  assert.match(contents, /CORAX_MODEL=private\/model-v2/);
  assert.doesNotMatch(outcome.message, /test-only-secret/);
  assert.equal(
    (
      await handler.handle({
        type: "extension",
        name: "model",
        argument: "bad\nOPENAI_API_KEY=changed",
      })
    ).failed,
    true,
  );
  assert.equal(await readFile(join(root, ".env"), "utf8"), contents);
  assert.match(
    (await handler.handle({ type: "extension", name: "login", argument: "" })).message,
    /No hosted account login/,
  );
});

test("cloud environment markers cannot change local output paths or seed hosted exporters", (t) => {
  const old = { vercel: process.env.VERCEL, environment: process.env.VERCEL_ENV };
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  t.after(() => {
    if (old.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = old.vercel;
    if (old.environment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = old.environment;
  });
  assert.equal(resolveOutputDirectory("/srv/private-agent"), join("/srv/private-agent", ".output"));
  seedInstrumentationProviders();
  assert.ok(!getInstrumentationProviders().some(({ slot }) => slot === "agent-runs"));
});

test("displaying model settings does not echo endpoint credentials", async (t) => {
  const previous = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL =
    "https://test-user:test-secret@example.invalid/v1?key=test-secret#test-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previous;
  });
  const handler = createLocalPromptCommandHandler({
    kind: "local",
    workspaceRoot: process.cwd(),
    serverUrl: "http://127.0.0.1:2000",
  });
  const outcome = await handler.handle({ type: "extension", name: "model", argument: "" });
  assert.match(outcome.message, /https:\/\/example\.invalid\/v1/);
  assert.doesNotMatch(outcome.message, /test-secret|test-user|key=/);
});

test("foreign development markers cannot bypass production channel authentication", async (t) => {
  const old = {
    dev: process.env.CORAX_DEV,
    vercel: process.env.VERCEL,
    environment: process.env.VERCEL_ENV,
  };
  delete process.env.CORAX_DEV;
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "development";
  t.after(() => {
    for (const [key, value] of [
      ["CORAX_DEV", old.dev],
      ["VERCEL", old.vercel],
      ["VERCEL_ENV", old.environment],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const authenticate = localDev();
  assert.equal(await authenticate(new Request("http://localhost")), null);
  process.env.CORAX_DEV = "1";
  assert.equal((await authenticate(new Request("http://localhost"))).authenticator, "local-dev");
});

test("workflow configuration accepts self-hosted backends and rejects hosted-only targets", () => {
  assert.equal(resolveWorkflowWorldImport("local"), "@workflow/world-local");
  assert.equal(resolveWorkflowWorldImport("@company/world-postgres"), "@company/world-postgres");
  for (const target of ["vercel", "@workflow/world-vercel"]) {
    assert.throws(
      () => resolveWorkflowWorldImport(target),
      /Select local or an installed self-hosted World/,
    );
  }
});
