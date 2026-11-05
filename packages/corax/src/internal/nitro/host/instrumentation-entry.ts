import type { Nitro } from "nitro/types";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { stringifyEsmImportSpecifier } from "#internal/application/import-specifier.js";

const INSTRUMENTATION_ENTRY = "#corax/instrumentation-entry";

interface EntryPluginContext {
  resolve(source: string): Promise<{ id: string } | null>;
  load(options: { id: string }): Promise<{ exports: readonly string[] | null }>;
}

/** Awaits instrumentation before importing the preset's server dependency graph. */
export function configureInstrumentationEntry(nitro: Nitro, instrumentationPath: string): void {
  // Nitro's development preset otherwise collapses both startup phases into one module.
  nitro.options.inlineDynamicImports = false;

  // Presets finish selecting their runtime entry in build:before.
  nitro.hooks.hook("rollup:before", (_nitro, config) => {
    config.input = INSTRUMENTATION_ENTRY;
    config.plugins = [
      {
        name: "corax:instrumentation-entry",
        resolveId: (id: string) => {
          if (id === INSTRUMENTATION_ENTRY) return id;
          // The preload and Nitro plugin must share one module identity, including when
          // the generated directory is outside rootDir and Nitro otherwise externalizes only one.
          if (nitro.options.dev && (id.startsWith("file:") || /^[A-Za-z]:[\\/]|^\//.test(id))) {
            const path = id.startsWith("file:") ? fileURLToPath(id) : id;
            if (resolve(path) === resolve(instrumentationPath))
              return { id: pathToFileURL(instrumentationPath).href, external: true };
          }
          return null;
        },
        async load(this: EntryPluginContext, id: string) {
          if (id !== INSTRUMENTATION_ENTRY) return null;
          const entry = await this.resolve(nitro.options.entry);
          if (entry === null) throw new Error(`Cannot resolve Nitro entry ${nitro.options.entry}`);
          // Re-export every preset binding, e.g. node-middleware exposes only named exports.
          const { exports } = await this.load(entry);
          return [
            `await import(${stringifyEsmImportSpecifier(instrumentationPath)});`,
            `const server = await import(${stringifyEsmImportSpecifier(nitro.options.entry)});`,
            ...(exports ?? []).map((name) =>
              name === "default"
                ? "export default server.default;"
                : `export const ${name} = server.${name};`,
            ),
          ].join("\n");
        },
      },
      ...(config.plugins ?? []),
    ];
  });
}
