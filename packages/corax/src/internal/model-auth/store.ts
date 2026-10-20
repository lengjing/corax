import { isModelConnection, type ModelConnectionSelection } from "#shared/model-connection.js";
export { isModelConnection, type ModelConnectionSelection } from "#shared/model-connection.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { secrets } from "#compiled/just-secrets/index.js";
import { isObject } from "#shared/guards.js";

export async function readModelSecret(name: string): Promise<string | undefined> {
  try {
    const value = await secrets.get({ service: "corax", name });
    if (value !== null && Buffer.byteLength(value) > 2560) throw new Error();
    return value ?? undefined;
  } catch {
    throw new Error("Cannot read the OS secret store. Unlock it and retry /login.");
  }
}

export async function writeModelSecret(name: string, value: string): Promise<void> {
  try {
    if (Buffer.byteLength(value) > 2560) throw new Error();
    await secrets.set({ service: "corax", name, value });
  } catch {
    throw new Error("Cannot save to the OS secret store. Unlock it and retry /login.");
  }
}

export async function readDefaultConnection(): Promise<ModelConnectionSelection | undefined> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(homedir(), ".corax", "connection.json"), "utf8"),
    );
    if (isObject(value) && isModelConnection(value.selected))
      return value.selected;
  } catch {
    /* A missing preference does not require authentication. */
  }
  return undefined;
}

export async function writeDefaultConnection(selected: ModelConnectionSelection): Promise<void> {
  const dir = join(homedir(), ".corax");
  await mkdir(dir, { recursive: true });
  const target = join(dir, "connection.json");
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ selected })}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

export function modelKeySecretName(provider: "openai" | "anthropic" | "ai-gateway-key"): string {
  return provider === "ai-gateway-key" ? provider : `${provider}-key`;
}
