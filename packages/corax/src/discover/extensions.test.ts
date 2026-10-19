import { describe, expect, it } from "vitest";

import {
  locateExtensionMount,
  locateExtensionMountPackage,
  mountNamespace,
} from "#discover/extensions.js";
import { createModuleSourceRef } from "#discover/manifest.js";
import { createMemoryProjectSource } from "#discover/project-source.js";

describe("mountNamespace", () => {
  it("derives the namespace from the mount filename", () => {
    expect(mountNamespace("extensions/crm.ts")).toBe("crm");
    expect(mountNamespace("extensions/toolkit.mts")).toBe("toolkit");
  });
});

describe("locateExtensionMountPackage", () => {
  it("resolves a package-local built-in extension without a compatibility manifest", async () => {
    const appRoot = "/repo/apps/agent";
    const agentRoot = `${appRoot}/agent`;
    const packageRoot = `${appRoot}/node_modules/corax`;
    const source = createMemoryProjectSource({
      files: {
        [`${agentRoot}/extensions/selfmod.ts`]:
          'export { default } from "corax/self-modification";\n',
        [`${packageRoot}/package.json`]: JSON.stringify({
          name: "corax",
          corax: {
            builtInExtensions: {
              "./self-modification": { dist: "dist/src/self-modification/extension" },
            },
          },
        }),
      },
    });

    const result = await locateExtensionMount({
      source,
      agentRoot,
      appRoot,
      mount: createModuleSourceRef({ logicalPath: "extensions/selfmod.ts" }),
      namespace: "selfmod",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.location).toMatchObject({
      packageName: "corax",
      packageRoot,
      sourceRoot: `${packageRoot}/dist/src/self-modification/extension`,
      specifier: "corax/self-modification",
    });
  });

  it("resolves a built-in extension mounted from inside the corax package by self-reference", async () => {
    const packageRoot = "/repo/packages/corax";
    const agentRoot = `${packageRoot}/src/example/extension`;
    const source = createMemoryProjectSource({
      files: {
        [`${agentRoot}/subagents/coder/extensions/code.ts`]:
          'import code from "corax/extensions/code";\nexport default code({});\n',
        [`${packageRoot}/package.json`]: JSON.stringify({
          name: "corax",
          corax: {
            builtInExtensions: {
              "./extensions/code": { dist: "dist/src/extensions/code/extension" },
            },
          },
        }),
      },
    });

    const result = await locateExtensionMount({
      source,
      agentRoot: `${agentRoot}/subagents/coder`,
      appRoot: packageRoot,
      mount: createModuleSourceRef({ logicalPath: "extensions/code.ts" }),
      namespace: "code",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.location).toMatchObject({
      packageRoot,
      sourceRoot: `${packageRoot}/dist/src/extensions/code/extension`,
    });
  });

  it("resolves source and dist roots before the distribution exists", async () => {
    const appRoot = "/repo/apps/agent";
    const agentRoot = `${appRoot}/agent`;
    const packageRoot = `${appRoot}/node_modules/@acme/crm`;
    const source = createMemoryProjectSource({
      files: {
        [`${agentRoot}/extensions/crm.ts`]: 'export { default } from "@acme/crm";\n',
        [`${packageRoot}/package.json`]: JSON.stringify({
          name: "@acme/crm",
          corax: { extension: { source: "extension", dist: "dist/extension" } },
        }),
      },
    });

    const result = await locateExtensionMountPackage({
      source,
      agentRoot,
      appRoot,
      mount: createModuleSourceRef({ logicalPath: "extensions/crm.ts" }),
      namespace: "crm",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.location).toMatchObject({
      authoredSourceRoot: `${packageRoot}/extension`,
      distRoot: `${packageRoot}/dist/extension`,
      packageName: "@acme/crm",
      packageRoot,
      specifier: "@acme/crm",
    });
  });
});
