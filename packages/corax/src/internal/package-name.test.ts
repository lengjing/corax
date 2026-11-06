import { describe, expect, it } from "vitest";
import { canonicalCoraxImport, CORAX_PACKAGE_NAME, CORAX_WORKFLOW_NAMESPACE, isCoraxPackageImport } from "./package-name.js";

describe("scoped package identity", () => {
  it("separates npm identity from persisted workflow identity", () => {
    expect(CORAX_PACKAGE_NAME).toBe("@coraxjs/core");
    expect(CORAX_WORKFLOW_NAMESPACE).toBe("corax");
  });

  it.each(["@coraxjs/core", "@coraxjs/core/tools", "corax", "corax/tools"])("recognizes framework import %s", (specifier) => {
    expect(isCoraxPackageImport(specifier)).toBe(true);
    expect(canonicalCoraxImport(specifier)).toMatch(/^@coraxjs\/core(?:\/|$)/);
  });

  it.each(["@coraxjs/core-extra", "@coraxjs/client", "corax-catalog", "coraxjs"])("does not capture another package %s", (specifier) => {
    expect(isCoraxPackageImport(specifier)).toBe(false);
    expect(canonicalCoraxImport(specifier)).toBe(specifier);
  });
});
