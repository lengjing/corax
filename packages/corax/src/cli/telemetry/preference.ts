import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";

import {
  createCoraxTelemetryIdentity,
  type CoraxCliTelemetryIdentity,
} from "#cli/telemetry/identity.js";
import { dirname, isAbsolute, join } from "node:path";

import { z } from "#compiled/zod/index.js";

const CORAX_TELEMETRY_NOTICE_VERSION = 1;

type CoraxTelemetryPreference = {
  readonly enabled: boolean;
  readonly notified: boolean;
};

function configuredDirectory(value: string | undefined, fallback: string): string {
  return value && isAbsolute(value) ? value : fallback;
}

function coraxConfigPath(): string {
  const home = homedir();
  if (process.platform === "win32") {
    return join(
      configuredDirectory(process.env.APPDATA, join(home, "AppData", "Roaming")),
      "corax",
      "config.json",
    );
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Preferences", "corax", "config.json");
  }
  return join(
    configuredDirectory(process.env.XDG_CONFIG_HOME, join(home, ".config")),
    "corax",
    "config.json",
  );
}

const CoraxConfigSchema = z.looseObject({
  telemetry: z
    .looseObject({
      enabled: z.boolean().default(true),
      installationId: z.string().optional(),
      noticeVersion: z.number().int().positive().optional(),
      notifiedAt: z.string().optional(),
      projectSalt: z.string().optional(),
    })
    .optional(),
});

function parsePreference(value: unknown): CoraxTelemetryPreference {
  const telemetry = CoraxConfigSchema.safeParse(value).data?.telemetry;
  return {
    enabled: telemetry?.enabled ?? true,
    notified: telemetry?.noticeVersion === CORAX_TELEMETRY_NOTICE_VERSION,
  };
}

export async function readCoraxTelemetryPreference(): Promise<CoraxTelemetryPreference> {
  try {
    return parsePreference(JSON.parse(await readFile(coraxConfigPath(), "utf8")) as unknown);
  } catch {
    return { enabled: true, notified: false };
  }
}

export async function readOrCreateCoraxTelemetryIdentity(): Promise<CoraxCliTelemetryIdentity> {
  let telemetry: z.infer<typeof CoraxConfigSchema>["telemetry"];
  try {
    telemetry = CoraxConfigSchema.safeParse(
      JSON.parse(await readFile(coraxConfigPath(), "utf8")) as unknown,
    ).data?.telemetry;
  } catch {
    // An absent or malformed config starts with a fresh telemetry identity.
  }

  const identity =
    telemetry?.installationId && telemetry.projectSalt
      ? { installationId: telemetry.installationId, projectSalt: telemetry.projectSalt }
      : createCoraxTelemetryIdentity();
  if (
    telemetry?.installationId !== identity.installationId ||
    telemetry?.projectSalt !== identity.projectSalt
  ) {
    await updateCoraxTelemetryPreference(identity);
  }
  return identity;
}

async function updateCoraxTelemetryPreference(
  update: Record<string, boolean | number | string>,
): Promise<void> {
  const path = coraxConfigPath();
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null) existing = parsed as Record<string, unknown>;
  } catch {
    // An absent or malformed config starts with the telemetry preference.
  }

  const telemetry =
    typeof existing.telemetry === "object" && existing.telemetry !== null ? existing.telemetry : {};
  const next = { ...existing, telemetry: { ...telemetry, ...update } };
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function setCoraxTelemetryEnabled(enabled: boolean): Promise<void> {
  await updateCoraxTelemetryPreference({ enabled });
}

export async function markCoraxTelemetryNotified(): Promise<void> {
  await updateCoraxTelemetryPreference({
    noticeVersion: CORAX_TELEMETRY_NOTICE_VERSION,
    notifiedAt: new Date().toISOString(),
  });
}
