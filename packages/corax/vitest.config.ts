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
    exclude: ["**/node_modules/**"],
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
