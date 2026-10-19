import { describe, expect, it } from "vitest";

import {
  createExtensionScopePlugin,
  createFixedMountScopePlugin,
  type ExtensionScopeBundlerPlugin,
} from "#internal/bundler/extension-scope-plugin.js";

const SCOPES = [{ sourceRoot: "/pkg/crm/extension", mountId: "extensions/crm" }];

function pathPlugin(): ExtensionScopeBundlerPlugin {
  const created = createExtensionScopePlugin(SCOPES);
  if (created === null) {
    throw new Error("expected a plugin for a non-empty scope set");
  }
  return created;
}

describe("createExtensionScopePlugin (path containment)", () => {
  it("returns null when there are no extensions so non-extension builds are untouched", () => {
    expect(createExtensionScopePlugin([])).toBeNull();
  });

  it("redirects corax/context to a namespaced shim for extension-owned importers", () => {
    const id = pathPlugin().resolveId("corax/context", "/pkg/crm/extension/tools/budget.ts");
    expect(id).toBe("\0corax-ext-scope:context:extensions%2Fcrm");
  });

  it("uses the tagged mount when two instances share a source root", () => {
    const plugin = createExtensionScopePlugin([
      ...SCOPES,
      { ...SCOPES[0]!, mountId: "subagents/research/extensions/crm" },
    ])!;
    expect(
      plugin.resolveId(
        "corax/context",
        "/pkg/crm/extension/tools/budget.ts?corax-mount=subagents%2Fresearch%2Fextensions%2Fcrm",
      ),
    ).toBe("\0corax-ext-scope:context:subagents%2Fresearch%2Fextensions%2Fcrm");
    expect(() => plugin.resolveId("corax/context", "/pkg/crm/extension/tools/budget.ts")).toThrow(
      "Ambiguous extension scope",
    );
  });

  it("scopes a shared chunk emitted beside the source root to its tagged mount", () => {
    const plugin = createExtensionScopePlugin([
      ...SCOPES,
      { ...SCOPES[0]!, mountId: "subagents/research/extensions/crm" },
    ])!;
    expect(
      plugin.resolveId(
        "corax/context",
        "/pkg/crm/_chunks/budget-abc123.mjs?corax-mount=subagents%2Fresearch%2Fextensions%2Fcrm",
      ),
    ).toBe("\0corax-ext-scope:context:subagents%2Fresearch%2Fextensions%2Fcrm");
  });

  it("leaves corax/extension unscoped for extension-owned importers", () => {
    const id = pathPlugin().resolveId("corax/extension", "/pkg/crm/extension/config.ts");
    expect(id).toBeUndefined();
  });

  it("ignores importers outside every extension source root", () => {
    expect(pathPlugin().resolveId("corax/context", "/app/agent/tools/local.ts")).toBeUndefined();
  });

  it("does not redirect a sibling directory that shares the source-root prefix", () => {
    expect(pathPlugin().resolveId("corax/context", "/pkg/crm/extras/tool.ts")).toBeUndefined();
  });

  it("only intercepts the scoped framework modules", () => {
    expect(
      pathPlugin().resolveId("corax/tools", "/pkg/crm/extension/tools/budget.ts"),
    ).toBeUndefined();
    expect(pathPlugin().resolveId("zod", "/pkg/crm/extension/tools/budget.ts")).toBeUndefined();
  });
});

describe("createFixedMountScopePlugin (dev per-module)", () => {
  it("scopes every non-virtual importer to the fixed namespace", () => {
    const plugin = createFixedMountScopePlugin("extensions/crm");
    // The importer path is irrelevant in fixed mode.
    expect(plugin.resolveId("corax/context", "/anywhere/on/disk/tool.ts")).toBe(
      "\0corax-ext-scope:context:extensions%2Fcrm",
    );
    expect(plugin.resolveId("corax/extension", "/anywhere/config.ts")).toBeUndefined();
  });

  it("never re-enters through virtual shim importers", () => {
    const plugin = createFixedMountScopePlugin("extensions/crm");
    expect(
      plugin.resolveId("corax/context", "\0corax-ext-scope:context:extensions%2Fcrm"),
    ).toBeUndefined();
  });

  it("only intercepts the scoped framework modules", () => {
    const plugin = createFixedMountScopePlugin("extensions/crm");
    expect(plugin.resolveId("corax/tools", "/anywhere/tool.ts")).toBeUndefined();
  });
});

describe("shim baking (shared)", () => {
  it("bakes the namespace into the defineState shim", () => {
    const shim = createFixedMountScopePlugin("extensions/crm").load(
      "\0corax-ext-scope:context:extensions%2Fcrm",
    );
    expect(shim?.code).toContain(`import { defineMountedState } from "corax/internal/mount-state"`);
    expect(shim?.code).toContain(`defineMountedState("extensions/crm", name, initial)`);
  });

  it("passes through non-shim ids in load", () => {
    expect(pathPlugin().load("/pkg/crm/extension/tools/budget.ts")).toBeUndefined();
  });
});
