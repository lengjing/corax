import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "./support/test.mjs";

const execute = promisify(execFile);
const environmentModule = new URL(
  "../packages/corax/dist/src/cli/dev/environment.js",
  import.meta.url,
).href;

test("env edits block rebuilds without breaking existing credential requests", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "corax-broker-env-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "broker-probe", type: "module" }),
  );
  await writeFile(join(root, "agent.ts"), "export default {};\n");
  await writeFile(join(root, ".env"), "UNRELATED_COLOR=blue\n");
  const moduleUrl = (path) =>
    new URL(`../packages/corax/dist/src/${path}.js`, import.meta.url).href;
  const script = `
import { writeFile } from "node:fs/promises";
import { stageDevelopmentEnvironmentFiles } from ${JSON.stringify(environmentModule)};
import { handleDevelopmentModelCredentialRequest } from ${JSON.stringify(moduleUrl("internal/model-auth/development-broker-server"))};
import { DEVELOPMENT_WORKFLOW_TRANSPORT_HEADER } from ${JSON.stringify(moduleUrl("internal/workflow/development-world-protocol"))};
const host = { appRoot: process.cwd(), secret: "fixture-control" };
const request = () => new Request("http://localhost/corax/v1/dev/internal/model-credential?provider=openai", {
  headers: { [DEVELOPMENT_WORKFLOW_TRANSPORT_HEADER]: host.secret },
});
const before = await handleDevelopmentModelCredentialRequest(request(), host);
const initial = await before.json();
await writeFile(".env", "UNRELATED_COLOR=green\\n");
let restart;
try { stageDevelopmentEnvironmentFiles(process.cwd()); } catch (error) { restart = error.message; }
const after = await handleDevelopmentModelCredentialRequest(request(), host);
const current = await after.json();
delete process.env.OPENAI_API_KEY;
const unavailable = await handleDevelopmentModelCredentialRequest(request(), host);
console.log(JSON.stringify({ before: before.status, after: after.status, restart,
  sameCredential: initial.token === current.token && current.token === "fixture-key",
  unavailable: unavailable.status, message: (await unavailable.json()).error }));
`;
  const { stdout } = await execute(process.execPath, ["-e", script], {
    cwd: root,
    env: {
      ...process.env,
      OPENAI_API_KEY: "fixture-key",
      CORAX_DEV: "",
      CORAX_MODEL_CONNECTION: "",
      NODE_ENV: "production",
    },
    timeout: 30_000,
  });
  const result = JSON.parse(stdout);
  assert.equal(result.before, 200);
  assert.equal(result.after, 200);
  assert.equal(result.sameCredential, true);
  assert.match(result.restart, /Restart corax dev/);
  assert.equal(result.unavailable, 503);
  assert.match(result.message, /provider credentials/);
  assert.doesNotMatch(result.message, /\/login|\/model/);
});

for (const [name, contents, shell, expected, restarted] of [
  ["matching shell value", "CORAX_TEST_VALUE=pinned\n", "pinned", "pinned", "pinned"],
  ["distinct shell value", "CORAX_TEST_VALUE=original\n", "pinned", "pinned", "pinned"],
  [
    "Bun interpolation",
    "CORAX_TEST_BASE=first\nCORAX_TEST_VALUE=${CORAX_TEST_BASE}/api\n",
    undefined,
    "first/api",
    "second/api",
  ],
]) {
  test(`Bun env loading preserves ${name} and requires restart after edits`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "corax-env-startup-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "env-probe", type: "module" }),
    );
    await writeFile(join(root, "agent.ts"), "export default {};\n");
    await writeFile(join(root, ".env"), contents);
    await writeFile(
      join(root, "probe.mjs"),
      `
import { writeFile } from "node:fs/promises";
import { loadDevelopmentEnvironmentFiles, stageDevelopmentEnvironmentFiles } from ${JSON.stringify(environmentModule)};
await loadDevelopmentEnvironmentFiles(process.cwd());
const initial = process.env.CORAX_TEST_VALUE;
let error;
if (process.argv[2] === "edit") {
  await writeFile(".env", "CORAX_TEST_BASE=second\\nCORAX_TEST_VALUE=\${CORAX_TEST_BASE}/api\\n");
  try { stageDevelopmentEnvironmentFiles(process.cwd()); } catch (cause) { error = cause.message; }
}
console.log(JSON.stringify({ initial, current: process.env.CORAX_TEST_VALUE, error }));
`,
    );
    const env = { ...process.env, NODE_ENV: "development" };
    delete env.CORAX_TEST_VALUE;
    delete env.CORAX_TEST_BASE;
    if (shell !== undefined) env.CORAX_TEST_VALUE = shell;
    const run = async (action) => {
      const { stdout } = await execute(process.execPath, ["probe.mjs", action], {
        cwd: root,
        env,
        timeout: 30_000,
      });
      return JSON.parse(stdout);
    };
    const first = await run("edit");
    assert.equal(first.initial, expected);
    assert.equal(first.current, expected);
    assert.match(first.error, /Restart corax dev/);
    const second = await run("read");
    assert.equal(second.initial, restarted);
    assert.equal(second.current, restarted);
  });
}
