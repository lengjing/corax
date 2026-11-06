import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

// Self-contained integration tests: disk, localhost and process boundaries.
// Workflow/Docker scenarios require their upstream test-world infrastructure.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    setupFiles: [],
    exclude: ["**/node_modules/**"],
    include: [
      "src/compiler/model-catalog.integration.test.ts",
      "src/shared/model-gateway-opt-in.integration.test.ts",
      "src/internal/nitro/host/dev-environment-watcher.integration.test.ts",
      "src/cli/dev/diagnostic*.integration.test.ts",
    ],
  },
});
