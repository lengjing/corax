import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  providerSettingsPath,
  providerSettingsMatch,
  readProviderSelection,
  readProviderSettingsSync,
  resolveAvailableProviders,
  writeProviderSelection,
} from "./provider-settings.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("provider settings", () => {
  it("resolves available providers independently from the stored selection", async () => {
    const root = await mkdtemp(join(tmpdir(), "corax-provider-settings-"));
    roots.push(root);
    await writeFile(join(root, ".env.local"), "AI_GATEWAY_API_KEY=key\n");

    await expect(resolveAvailableProviders(root, { env: {} })).resolves.toEqual([
      "chatgpt",
      "ai-gateway-key",
    ]);
    await expect(readProviderSelection(root)).resolves.toBeUndefined();

    await writeProviderSelection(root, "chatgpt");

    await expect(resolveAvailableProviders(root, { env: {} })).resolves.toEqual([
      "chatgpt",
      "ai-gateway-key",
    ]);
    await expect(readProviderSelection(root)).resolves.toBe("chatgpt");
  });

  it("stores one normalized provider selection under .corax", async () => {
    const root = await mkdtemp(join(tmpdir(), "corax-provider-settings-"));
    roots.push(root);

    await writeProviderSelection(root, "ai-gateway-key");

    await expect(readProviderSelection(root)).resolves.toBe("ai-gateway-key");
    expect(readProviderSettingsSync(root)?.selected).toBe("ai-gateway-key");
    expect(providerSettingsPath(root)).toBe(join(root, ".corax", "provider.json"));
  });

  it("treats missing settings as no explicit selection", async () => {
    const root = await mkdtemp(join(tmpdir(), "corax-provider-settings-"));
    roots.push(root);

    await expect(readProviderSelection(root)).resolves.toBeUndefined();
    expect(readProviderSettingsSync(root)?.selected).toBeUndefined();
  });
});

it("compares connection and key source before deciding whether activation is needed", async () => {
  const root = await mkdtemp(join(tmpdir(), "corax-provider-settings-"));
  roots.push(root);
  expect(await providerSettingsMatch(root, { selected: "ai-gateway-key" })).toBe(false);
  await writeProviderSelection(root, "ai-gateway-key");
  expect(await providerSettingsMatch(root, { selected: "ai-gateway-key" })).toBe(true);
  expect(await providerSettingsMatch(root, { selected: "chatgpt" })).toBe(false);
  await writeProviderSelection(root, "openai", "environment");
  expect(await providerSettingsMatch(root, { selected: "openai", keySource: "environment" })).toBe(
    true,
  );
  expect(await providerSettingsMatch(root, { selected: "openai", keySource: "secret" })).toBe(
    false,
  );
});
