import assert from "node:assert/strict";
import { join } from "node:path";
import test from "./support/test.mjs";
import { createCliProgram } from "../packages/corax/dist/src/cli/run.js";
import {
  seedInstrumentationProviders,
  getInstrumentationProviders,
} from "../packages/corax/dist/src/instrumentation/providers.js";
import { localDev } from "../packages/corax/dist/src/public/channels/auth.js";
import { resolveWorkflowWorldImport } from "../packages/corax/dist/src/internal/workflow/world-target.js";
import { resolveOutputDirectory } from "../packages/corax/dist/src/internal/application/paths.js";

test("the product CLI exposes local execution rather than hosted provisioning commands", () => {
  const program = createCliProgram({ log() {}, error() {} }, {}, { root: process.cwd() });
  const commands = program.commands.map((command) => command.name());
  assert.equal(program.name(), "corax");
  for (const local of ["dev", "build", "start", "info", "eval"])
    assert.ok(commands.includes(local));
  for (const hosted of ["deploy", "link", "integration", "registry", "init", "extension", "set", "telemetry"])
    assert.ok(!commands.includes(hosted));
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
