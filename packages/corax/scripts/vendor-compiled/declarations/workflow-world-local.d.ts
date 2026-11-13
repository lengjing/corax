import type { QueuePrefix, World } from "#compiled/@workflow/world/index.js";

export type LocalWorld = World & {
  clear(): Promise<void>;
  registerHandler(prefix: QueuePrefix, handler: (request: Request) => Promise<Response>): void;
  registerRoute(prefix: QueuePrefix, path: string): void;
  releaseOrphanedSteps(runId: string): Promise<void>;
};

export function createWorld(options?: {
  readonly baseUrl?: string;
  readonly dataDir?: string;
  readonly recoverActiveRuns?: boolean;
  readonly streamFlushIntervalMs?: number;
  readonly tag?: string;
  readonly queueAuthKey?: "read" | "regenerate";
}): LocalWorld;
