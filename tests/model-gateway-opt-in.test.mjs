import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "./support/test.mjs";
import {
  bareModelIdRequiresGatewayError,
  isGatewayModelRoutingEnabled,
} from "../packages/corax/dist/src/shared/model-helper.js";
import { resolveRuntimeModelReference } from "../packages/corax/dist/src/runtime/agent/resolve-model.js";
import { resolveGatewayModelCredential } from "../packages/corax/dist/src/internal/model-auth/gateway-credential.js";
import { createCompiledRuntimeModelCatalogLoader } from "../packages/corax/dist/src/compiler/model-catalog.js";
import { compileAgent } from "../packages/corax/dist/src/compiler/compile-agent.js";

const GATEWAY_ENV = ["CORAX_MODEL_CONNECTION", "AI_GATEWAY_API_KEY"];

function withoutGatewayOptIn(t) {
  const saved = Object.fromEntries(GATEWAY_ENV.map((key) => [key, process.env[key]]));
  const defaultProvider = Reflect.get(globalThis, "AI_SDK_DEFAULT_PROVIDER");
  for (const key of GATEWAY_ENV) delete process.env[key];
  Reflect.deleteProperty(globalThis, "AI_SDK_DEFAULT_PROVIDER");
  t.after(() => {
    for (const key of GATEWAY_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    if (defaultProvider !== undefined) Reflect.set(globalThis, "AI_SDK_DEFAULT_PROVIDER", defaultProvider);
  });
}

test("AI Gateway routing is disabled unless the operator opts in", (t) => {
  withoutGatewayOptIn(t);
  assert.equal(isGatewayModelRoutingEnabled(), false);
  assert.equal(isGatewayModelRoutingEnabled({ AI_GATEWAY_API_KEY: "key" }), true);
  for (const connection of ["vercel", "vercel-cli", "ai-gateway-key", "ai-gateway-project"])
    assert.equal(isGatewayModelRoutingEnabled({ CORAX_MODEL_CONNECTION: connection }), true);
  for (const connection of ["openai", "anthropic", "chatgpt", ""])
    assert.equal(isGatewayModelRoutingEnabled({ CORAX_MODEL_CONNECTION: connection }), false);
  Reflect.set(globalThis, "AI_SDK_DEFAULT_PROVIDER", { languageModel() {} });
  assert.equal(isGatewayModelRoutingEnabled({}), true);
});

test("a bare model id is rejected at runtime instead of reaching the Vercel gateway", async (t) => {
  withoutGatewayOptIn(t);
  // bun test sets NODE_ENV=test, which substitutes mock models before routing is consulted.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  t.after(() => { process.env.NODE_ENV = nodeEnv; });
  await assert.rejects(
    resolveRuntimeModelReference({ id: "openai/gpt-4.1-mini", contextWindowTokens: 128_000 }),
    (error) => {
      assert.match(error.message, /bare model id/);
      assert.match(error.message, /CORAX_MODEL_CONNECTION=ai-gateway-key/);
      return true;
    },
  );
  assert.match(bareModelIdRequiresGatewayError("x", "agent.ts").message, /^agent\.ts: Model "x"/);
});

test("gateway credentials never fall back to Vercel OIDC without an explicit project connection", async (t) => {
  withoutGatewayOptIn(t);
  await assert.rejects(resolveGatewayModelCredential(), /AI Gateway credentials are not configured/);
  process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
  assert.deepEqual(await resolveGatewayModelCredential(), { kind: "api-key", token: "test-gateway-key" });
});

test("the model catalog is not fetched from Vercel without opt-in", async (t) => {
  withoutGatewayOptIn(t);
  const root = await mkdtemp(join(tmpdir(), "corax-model-catalog-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let fetched = 0;
  t.mock.method(globalThis, "fetch", async () => { fetched++; return new Response("{}"); });
  const loader = createCompiledRuntimeModelCatalogLoader(root);
  // Built-in limits resolve offline.
  assert.notEqual(await loader.getModelLimits("openai/gpt-5.4-mini"), null);
  await assert.rejects(loader.getModelLimits("some-vendor/unknown-model"), /modelContextWindowTokens/);
  await assert.rejects(loader.getByProviderModelId("openai", "gpt-4.1-mini"), /modelContextWindowTokens/);
  assert.equal(fetched, 0);
});

test("compiling a project with a bare model id fails with guidance instead of contacting Vercel", async (t) => {
  withoutGatewayOptIn(t);
  const root = await mkdtemp(join(tmpdir(), "corax-bare-model-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "bare", type: "module", dependencies: { corax: "0.1.0" } }));
  await writeFile(
    join(root, "agent.ts"),
    `import { defineAgent } from 'corax';
export default defineAgent({ model: 'openai/gpt-4.1-mini', modelContextWindowTokens: 128000 });
`,
  );
  await mkdir(join(root, "node_modules"));
  await symlink(
    fileURLToPath(new URL("../examples/minimal/node_modules/corax", import.meta.url)),
    join(root, "node_modules", "corax"),
    process.platform === "win32" ? "junction" : "dir",
  );
  let fetched = 0;
  t.mock.method(globalThis, "fetch", async () => { fetched++; return new Response("{}"); });
  await assert.rejects(compileAgent({ startPath: root }), (error) => {
    assert.match(error.message, /bare model id/);
    assert.match(error.message, /createOpenAI/);
    return true;
  });
  assert.equal(fetched, 0);
});
