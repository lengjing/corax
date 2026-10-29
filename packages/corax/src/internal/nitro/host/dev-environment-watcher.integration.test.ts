import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getDevelopmentEnvironmentFilePaths,
  loadDevelopmentEnvironmentFiles,
  readDevelopmentEnvironmentHostValues,
  stageDevelopmentEnvironmentFiles,
} from "#cli/dev/environment.js";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("development environment restart boundary", () => {
  it("leaves startup environment values untouched rather than parsing them again", async () => {
    const root = await createApp();
    vi.stubEnv("CORAX_ENV_TEST", "expanded/value");
    await writeFile(join(root, ".env"), "CORAX_ENV_TEST=${BASE}/value\n");
    await loadDevelopmentEnvironmentFiles(root);
    expect(process.env.CORAX_ENV_TEST).toBe("expanded/value");
    expect(readDevelopmentEnvironmentHostValues(root)).toEqual({
      CORAX_ENV_TEST: "expanded/value",
    });
  });

  it.each(["same", "different"])(
    "does not take ownership of shell values (%s)",
    async (initial) => {
      const root = await createApp();
      vi.stubEnv("CORAX_ENV_TEST", "same");
      await writeFile(join(root, ".env"), `CORAX_ENV_TEST=${initial}\n`);
      await loadDevelopmentEnvironmentFiles(root);
      await writeFile(join(root, ".env"), "CORAX_ENV_TEST=changed\n");
      expect(() => stageDevelopmentEnvironmentFiles(root)).toThrow("Restart corax dev");
    await expect(loadDevelopmentEnvironmentFiles(root)).resolves.toBeUndefined();
      expect(process.env.CORAX_ENV_TEST).toBe("same");
    },
  );

  it("requires restart for file creation or removal and allows reverting the edit", async () => {
    const root = await createApp();
    await loadDevelopmentEnvironmentFiles(root);
    await writeFile(join(root, ".env.local"), "CORAX_ENV_TEST=new\n");
    expect(() => stageDevelopmentEnvironmentFiles(root)).toThrow("Restart corax dev");
    await rm(join(root, ".env.local"));
    expect(() => stageDevelopmentEnvironmentFiles(root).commit()).not.toThrow();

    const other = await createApp();
    await writeFile(join(other, ".env"), "CORAX_ENV_TEST=original\n");
    await loadDevelopmentEnvironmentFiles(other);
    await rm(join(other, ".env"));
    expect(() => stageDevelopmentEnvironmentFiles(other)).toThrow("Restart corax dev");
  });

  it("watches workspace-root environment files without changing startup precedence", async () => {
    const root = await createApp();
    const member = join(root, "agents", "support");
    await mkdir(join(member, "agent"), { recursive: true });
    vi.stubEnv("CORAX_ENV_TEST", "startup");
    await writeFile(join(root, ".env"), "CORAX_ENV_TEST=root\n");
    await loadDevelopmentEnvironmentFiles(member);
    expect(getDevelopmentEnvironmentFilePaths(member)).toEqual(
      [".env.development.local", ".env.local", ".env.development", ".env"].map((file) =>
        join(root, file),
      ),
    );
    expect(process.env.CORAX_ENV_TEST).toBe("startup");
    await writeFile(join(root, ".env"), "CORAX_ENV_TEST=changed\n");
    expect(() => stageDevelopmentEnvironmentFiles(member)).toThrow("Restart corax dev");
  });

  it("keeps explicit provider environment settings authoritative", async () => {
    const root = await createApp();
    vi.stubEnv("CORAX_MODEL_CONNECTION", "ai-gateway-key");
    vi.stubEnv("CORAX_MODEL_KEY_SOURCE", "environment");
    await loadDevelopmentEnvironmentFiles(root);
    expect(process.env.CORAX_MODEL_CONNECTION).toBe("ai-gateway-key");
    await saveSettings(root, { selected: "chatgpt", keySource: "secret" });
    stageDevelopmentEnvironmentFiles(root).commit();
    expect(process.env.CORAX_MODEL_CONNECTION).toBe("ai-gateway-key");
    expect(process.env.CORAX_MODEL_KEY_SOURCE).toBe("environment");
  });

  it("can roll back or commit saved provider settings independently of dotenv", async () => {
    const root = await createApp();
    vi.stubEnv("CORAX_MODEL_CONNECTION", undefined);
    vi.stubEnv("CORAX_MODEL_KEY_SOURCE", undefined);
    await saveSettings(root, { selected: "chatgpt" });
    await loadDevelopmentEnvironmentFiles(root);
    expect(process.env.CORAX_MODEL_CONNECTION).toBe("chatgpt");
    await saveSettings(root, { selected: "ai-gateway-key", keySource: "secret" });
    const candidate = stageDevelopmentEnvironmentFiles(root);
    expect(process.env.CORAX_MODEL_CONNECTION).toBe("ai-gateway-key");
    candidate.rollback();
    expect(process.env.CORAX_MODEL_CONNECTION).toBe("chatgpt");
    expect(process.env.CORAX_MODEL_KEY_SOURCE).toBeUndefined();
    const accepted = stageDevelopmentEnvironmentFiles(root);
    accepted.commit();
    accepted.rollback();
    expect(process.env.CORAX_MODEL_CONNECTION).toBe("ai-gateway-key");
    expect(process.env.CORAX_MODEL_KEY_SOURCE).toBe("secret");
  });
});

async function createApp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "corax-env-restart-"));
  directories.push(root);
  await mkdir(join(root, "agent"));
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { corax: "*" } }));
  return root;
}

async function saveSettings(root: string, settings: object): Promise<void> {
  await mkdir(join(root, ".corax"), { recursive: true });
  await writeFile(join(root, ".corax", "provider.json"), JSON.stringify(settings));
}
