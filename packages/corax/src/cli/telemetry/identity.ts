import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const GIT_TIMEOUT_MS = 1_000;

export type CoraxCliTelemetryIdentity = {
  readonly installationId: string;
  readonly projectSalt: string;
};

export function createCoraxTelemetryIdentity(): CoraxCliTelemetryIdentity {
  return { installationId: randomUUID(), projectSalt: randomUUID() };
}

export function isEphemeralCoraxTelemetryEnvironment(): boolean {
  return Boolean(process.env.CI) || existsSync("/.dockerenv");
}

export function hashCoraxTelemetryProject(identity: CoraxCliTelemetryIdentity, value: string): string {
  return createHash("sha256").update(identity.projectSalt).update(value).digest("hex");
}

export async function resolveCoraxTelemetryProjectId(input: {
  readonly cwd?: string;
  readonly repositoryUrl?: string;
  readonly getGitRemote?: (cwd: string) => Promise<string | undefined>;
  readonly identity: CoraxCliTelemetryIdentity;
}): Promise<string> {
  const cwd = input.cwd ?? process.cwd();
  const gitRemote = await (input.getGitRemote ?? getGitRemote)(cwd);
  return hashCoraxTelemetryProject(
    input.identity,
    gitRemote ?? input.repositoryUrl ?? process.env.REPOSITORY_URL ?? cwd,
  );
}

async function getGitRemote(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await runFile("git", ["config", "--local", "--get", "remote.origin.url"], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });
    const value = stdout.trim();
    return value === "" ? undefined : value;
  } catch {
    return undefined;
  }
}
