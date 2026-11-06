import { describe, expect, it } from "vitest";

import {
  resolveExpectedWorkflowVersion,
  resolveWorkflowModulePath,
} from "#internal/application/package.js";

describe("resolveWorkflowModulePath", () => {
  it("resolves historical workflow specifiers to narrowed runtime modules", () => {
    expect(resolveWorkflowModulePath("workflow").replaceAll("\\", "/")).toMatch(/\/src\/internal\/workflow\/index\.ts$/);
    expect(resolveWorkflowModulePath("workflow/api").replaceAll("\\", "/")).toMatch(
      /\/src\/internal\/workflow\/runtime\.ts$/,
    );
    expect(resolveWorkflowModulePath("workflow/internal/builtins").replaceAll("\\", "/")).toMatch(
      /\/src\/internal\/workflow\/builtins\.ts$/,
    );
    expect(resolveWorkflowModulePath("workflow/internal/private").replaceAll("\\", "/")).toMatch(
      /\/\.generated\/compiled\/@workflow\/core\/private\.js$/,
    );
    expect(resolveWorkflowModulePath("workflow/runtime").replaceAll("\\", "/")).toMatch(
      /\/src\/internal\/workflow\/runtime\.ts$/,
    );
  });
});

describe("resolveExpectedWorkflowVersion", () => {
  it("reads the @workflow/core line from corax's own package.json", () => {
    expect(resolveExpectedWorkflowVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
