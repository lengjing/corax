import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const source = fileURLToPath(new URL("./src/", import.meta.url));
const compiled = fileURLToPath(new URL("./.generated/compiled/", import.meta.url));

/**
 * Resolves the package's `#*` subpath imports to their TypeScript sources so
 * tests exercise the working tree rather than whatever `dist/` was last built.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^#compiled\/(.+)\.js$/, replacement: `${compiled}$1.js` },
      { find: /^#(.+)\.js$/, replacement: `${source}$1.ts` },
    ],
  },
  test: {
    environment: "node",
    // String-model fixtures exercise Gateway normalization without using a
    // developer's credentials. The unit guard still rejects real network I/O.
    env: {
      AI_GATEWAY_API_KEY: "",
      CORAX_MODEL_CONNECTION: "ai-gateway-key",
    },
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts", "src/**/*.scenario.test.ts"],
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/internal/testing/unit-guard.ts"],
    maxWorkers: 4,
    testTimeout: 30_000,
  },
});
