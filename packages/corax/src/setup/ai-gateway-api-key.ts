import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { appendEnv } from "./append-env.js";

export const AI_GATEWAY_API_KEY_ENV_VAR = "AI_GATEWAY_API_KEY";
export const AI_GATEWAY_API_KEY_ENV_FILE = ".env.local";

/** Env files corax inspects for an existing gateway key, highest precedence first. */
export type AiGatewayEnvFile = typeof AI_GATEWAY_API_KEY_ENV_FILE | ".env";

const ENV_FILE_CANDIDATES = [AI_GATEWAY_API_KEY_ENV_FILE, ".env"] as const satisfies readonly AiGatewayEnvFile[];

function readEnvValue(line: string, key: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) return undefined;
  if (!trimmed.startsWith(`${key}=`)) return undefined;
  const raw = trimmed.slice(key.length + 1);
  if (raw.length === 0) return undefined;
  const unquoted =
    raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  return unquoted.length === 0 ? undefined : unquoted;
}

async function hasKeyInFile(filePath: string, key: string): Promise<boolean> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch {
    return false;
  }
  for (const line of contents.split("\n")) {
    if (readEnvValue(line, key) !== undefined) return true;
  }
  return false;
}

/**
 * Returns the first env file (`.env.local`, then `.env`) defining a non-empty
 * value for `key`, or `undefined` when neither does.
 */
export async function findEnvFileWithKey(
  projectRoot: string,
  key: string,
): Promise<AiGatewayEnvFile | undefined> {
  for (const fileName of ENV_FILE_CANDIDATES) {
    if (await hasKeyInFile(join(projectRoot, fileName), key)) {
      return fileName;
    }
  }
  return undefined;
}

/** The location written by corax when a user supplies an AI Gateway API key. */
interface AiGatewayApiKeyLocation {
  envKey: typeof AI_GATEWAY_API_KEY_ENV_VAR;
  envFile: typeof AI_GATEWAY_API_KEY_ENV_FILE;
  envPath: string;
}

/** Trims and saves an explicit AI Gateway API key, replacing any prior value. */
export async function writeAiGatewayApiKey(input: {
  projectRoot: string;
  apiKey: string;
  appendEnv?: typeof appendEnv;
}): Promise<AiGatewayApiKeyLocation> {
  const envPath = join(input.projectRoot, AI_GATEWAY_API_KEY_ENV_FILE);
  await (input.appendEnv ?? appendEnv)(
    envPath,
    { [AI_GATEWAY_API_KEY_ENV_VAR]: input.apiKey.trim() },
    { force: true },
  );
  return {
    envKey: AI_GATEWAY_API_KEY_ENV_VAR,
    envFile: AI_GATEWAY_API_KEY_ENV_FILE,
    envPath,
  };
}
