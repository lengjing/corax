import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createCompiledRuntimeModelCatalogLoader } from "#compiler/model-catalog.js";
import { compileAgentConfig } from "#compiler/normalize-agent-config.js";
import { ContextContainer } from "#context/container.js";
import { resolveRuntimeModelReference, resolveRuntimeModelSelection } from "#runtime/agent/resolve-model.js";
import { isBareModelIdAllowed, isGatewayNetworkAllowed } from "#shared/model-helper.js";

const fetchSpy = vi.fn();
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "corax-provider-opt-in-"));
  for (const key of ["CORAX_MODEL_CONNECTION", "AI_GATEWAY_API_KEY", "CORAX_MOCK_AUTHORED_MODELS", "CORAX_DEV_CONTROL_URL", "CORAX_DEV_WORKFLOW_TRANSPORT_SECRET"]) {
    vi.stubEnv(key, "");
  }
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CORAX_DEV", "1");
  vi.stubGlobal("AI_SDK_DEFAULT_PROVIDER", undefined);
  fetchSpy.mockReset().mockRejectedValue(new Error("Unexpected offline fetch"));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("separates default-provider resolution from Gateway network permission", () => {
  expect(isBareModelIdAllowed({})).toBe(false);
  expect(isGatewayNetworkAllowed({})).toBe(false);
  vi.stubGlobal("AI_SDK_DEFAULT_PROVIDER", {});
  expect(isBareModelIdAllowed({})).toBe(true);
  expect(isGatewayNetworkAllowed({})).toBe(false);
  for (const env of [{ AI_GATEWAY_API_KEY: "fixture-key" }, { CORAX_MODEL_CONNECTION: "ai-gateway-key" }]) {
    expect(isBareModelIdAllowed(env)).toBe(true);
    expect(isGatewayNetworkAllowed(env)).toBe(true);
  }
});

it.each(["broker", "gateway", "both"])("uses the actual custom provider despite %s configuration", async (mode) => {
  if (mode !== "gateway") {
    vi.stubEnv("CORAX_DEV_CONTROL_URL", "http://127.0.0.1:12345");
    vi.stubEnv("CORAX_DEV_WORKFLOW_TRANSPORT_SECRET", "fixture-secret");
  }
  if (mode !== "broker") {
    vi.stubEnv("CORAX_MODEL_CONNECTION", "ai-gateway-key");
    vi.stubEnv("AI_GATEWAY_API_KEY", "fixture-key");
  }
  const doGenerate = vi.fn(async () => ({
    content: [{ type: "text" as const, text: "private provider" }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
    warnings: [],
  }));
  const languageModel = vi.fn(() => new MockLanguageModelV4({ doGenerate }));
  vi.stubGlobal("AI_SDK_DEFAULT_PROVIDER", { languageModel });
  const model = await resolveRuntimeModelReference({ id: "private/model" });
  expect(model).toBe("private/model");
  const result = await generateText({ model, prompt: "offline", maxRetries: 0 });
  expect(result.text).toBe("private provider");
  expect(languageModel).toHaveBeenCalledWith("private/model");
  expect(doGenerate).toHaveBeenCalledOnce();
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("rejects private-provider metadata lookup without fetching the Vercel catalog", async () => {
  vi.stubGlobal("AI_SDK_DEFAULT_PROVIDER", { languageModel: vi.fn() });
  const loader = createCompiledRuntimeModelCatalogLoader(root);
  expect(await loader.getModelLimits("openai/gpt-5.4-mini")).not.toBeNull();
  await expect(loader.getModelLimits("private/model")).rejects.toThrow("modelContextWindowTokens");
  await expect(loader.getByProviderModelId("private", "model")).rejects.toThrow("modelContextWindowTokens");
  await expect(resolveRuntimeModelSelection({
    selection: "private/model", durability: "live", state: new ContextContainer(),
  })).rejects.toThrow("modelContextWindowTokens");
  const selection = await resolveRuntimeModelSelection({
    selection: { model: "private/model", modelContextWindowTokens: 8192 },
    durability: "live", state: new ContextContainer(),
  });
  expect(selection.reference.id).toBe("private/model");
  expect(fetchSpy).not.toHaveBeenCalled();
});

it.each(["string", "object"])("compiles custom %s models only with offline metadata or explicit limits", async (kind) => {
  vi.stubGlobal("AI_SDK_DEFAULT_PROVIDER", { languageModel: vi.fn() });
  const model = kind === "string" ? "private/model" : {
    specificationVersion: "v3", provider: "private", modelId: "model",
    doGenerate: vi.fn(), doStream: vi.fn(),
  };
  const manifest = { appRoot: root, agentRoot: root, agentId: "fixture" } as Parameters<typeof compileAgentConfig>[0];
  const context = { modelCatalog: createCompiledRuntimeModelCatalogLoader(root) } as Parameters<typeof compileAgentConfig>[1];
  const options = {
    binding: { backing: { kind: "programmatic" } },
    source: { logicalPath: "agent.ts", sourceId: "fixture", sourceKind: "module" },
    definition: { model },
  } as Parameters<typeof compileAgentConfig>[2];
  await expect(compileAgentConfig(manifest, context, options)).rejects.toThrow("modelContextWindowTokens");
  await expect(compileAgentConfig(manifest, context, {
    ...options, definition: { model, modelContextWindowTokens: 8192 },
  })).resolves.toBeDefined();
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("rejects bare IDs without a provider or Gateway opt-in even when a dev broker exists", async () => {
  vi.stubEnv("CORAX_DEV_CONTROL_URL", "http://127.0.0.1:12345");
  vi.stubEnv("CORAX_DEV_WORKFLOW_TRANSPORT_SECRET", "fixture-secret");
  await expect(resolveRuntimeModelReference({ id: "private/model" })).rejects.toThrow("bare model id");
  expect(fetchSpy).not.toHaveBeenCalled();
});

it.each(["key", "connection"])("retains explicit Gateway catalog opt-in via %s", async (mode) => {
  vi.stubEnv(mode === "key" ? "AI_GATEWAY_API_KEY" : "CORAX_MODEL_CONNECTION", mode === "key" ? "fixture-key" : "ai-gateway-key");
  fetchSpy.mockResolvedValue(Response.json({ models: [], providerAliases: {} }));
  expect(await createCompiledRuntimeModelCatalogLoader(root).getModelLimits("private/model")).toBeNull();
  expect(fetchSpy).toHaveBeenCalled();
  expect(String(fetchSpy.mock.calls[0]![0])).toBe("https://ai-gateway.vercel.sh/v1/models/catalog");
});

it("uses existing dev Gateway authentication when no custom default is installed", async () => {
  vi.stubEnv("CORAX_MODEL_CONNECTION", "ai-gateway-key");
  vi.stubEnv("AI_GATEWAY_API_KEY", "fixture-gateway-key");
  fetchSpy.mockResolvedValue(new Response('data: {"type":"text-start","id":"1"}\n\ndata: {"type":"text-end","id":"1"}\n\n', {
    headers: { "content-type": "text/event-stream" },
  }));
  const model = await resolveRuntimeModelReference({ id: "openai/fixture" });
  expect(typeof model).toBe("object");
  if (typeof model === "string") throw new Error("Expected Gateway model");
  expect(model.provider).toBe("gateway");
  const result = await model.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "offline" }] }] });
  for await (const event of result.stream) {
    if (event.type === "error") throw event.error;
  }
  expect(fetchSpy).toHaveBeenCalledOnce();
  expect(new Headers(fetchSpy.mock.calls[0]![1].headers).get("authorization")).toBe("Bearer fixture-gateway-key");
});

it("does not publish removed setup entry points", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  expect(pkg.exports).not.toHaveProperty("./setup");
  expect(pkg.exports).not.toHaveProperty("./setup/scaffold");
});
