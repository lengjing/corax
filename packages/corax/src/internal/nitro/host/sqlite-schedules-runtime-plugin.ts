import {
  resolveNitroCompiledArtifactsSource,
  type NitroArtifactsConfig,
} from "#internal/nitro/routes/runtime-artifacts.js";
import { pumpSqliteSchedules, readSqliteSchedulePath } from "#public/schedules/providers/sqlite.js";
import { loadCompiledManifest } from "#runtime/loaders/manifest.js";
import { dispatchScheduledOccurrence } from "#runtime/schedules/dispatch-occurrence.js";
import { loadScheduleCollectionDefinition } from "#runtime/schedules/load-collection.js";
import { parseSchedulePayload } from "#runtime/schedules/payload.js";
import { getCompiledRuntimeAgentBundle } from "#runtime/sessions/compiled-agent-cache.js";

export default function installSqliteSchedules(
  nitro: {
    readonly hooks: { hook(name: "close", handler: () => Promise<void>): unknown };
  },
  config: NitroArtifactsConfig,
): void {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  let failed = false;

  const poll = async () => {
    let moreWork = false;
    try {
      const source = resolveNitroCompiledArtifactsSource(config);
      const manifest = await loadCompiledManifest({ compiledArtifactsSource: source });
      const collections = manifest.scheduleCollections.filter(
        (item) => item.providerKind === "sqlite",
      );
      if (collections.length === 0) return;
      const bundle = await getCompiledRuntimeAgentBundle({ compiledArtifactsSource: source });
      for (const collection of collections) {
        if (abort.signal.aborted) return;
        const definition = await loadScheduleCollectionDefinition(bundle, collection.name, {
          manifest,
          providerKind: "sqlite",
        });
        const path = readSqliteSchedulePath(definition.provider);
        if (!path) throw new Error("SQLite schedule provider path is missing.");
        const remaining = await pumpSqliteSchedules({
          path,
          application: manifest.config.name,
          collection: collection.name,
          at: new Date(),
          signal: abort.signal,
          async deliver(delivery) {
            await dispatchScheduledOccurrence({
              bundle,
              collection: collection.name,
              definition,
              occurrence: { ...delivery.occurrence, collection: collection.name },
              payload: parseSchedulePayload(delivery.payload, {
                application: manifest.config.name,
                collection: collection.name,
              }),
            });
          },
          async onFailure({ occurrence }) {
            await definition.events?.["occurrence.failed"]?.({
              type: "occurrence.failed",
              collection: collection.name,
              executionId: occurrence.executionId,
              scheduleId: occurrence.scheduleId,
              name: occurrence.name,
              scheduledAt: occurrence.scheduledAt,
              occurrence: { ...occurrence, collection: collection.name },
              reason: "Local scheduled occurrence exhausted its retry budget.",
            });
          },
        });
        moreWork ||= remaining;
      }
      failed = false;
    } catch {
      if (!abort.signal.aborted && !failed)
        console.error("[corax] Local schedule polling failed; retrying.");
      failed = true;
    } finally {
      if (!abort.signal.aborted) {
        timer = setTimeout(() => {
          active = poll();
        }, moreWork ? 0 : 1000);
        timer.unref();
      }
    }
  };
  nitro.hooks.hook("close", async () => {
    abort.abort();
    clearTimeout(timer);
    await active;
  });
  active = poll();
}
