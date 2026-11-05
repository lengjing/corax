import { test, expect } from "bun:test";
import { createGenerationPackageBoundaryPlugin, createRuntimeLoaderPackageBoundaryPlugin, createDistributionPackageBoundaryPlugin } from "../packages/corax/src/internal/authored-package-boundary.ts";

test("all authored bundling boundaries preserve Bun builtins without npm resolution", async () => {
  const options = { packageRoot: process.cwd(), externalDependencies: [], runtimeDependencies: [] };
  for (const factory of [createGenerationPackageBoundaryPlugin, createRuntimeLoaderPackageBoundaryPlugin, createDistributionPackageBoundaryPlugin]) {
    const plugin = factory(options);
    const result = await plugin.resolveId.call({ resolve() { throw new Error("Bun builtins are not npm packages"); } }, "bun:sqlite", undefined, { kind: "import" });
    expect(result).toEqual({ external: true, id: "bun:sqlite" });
  }
});
