import { describe, expect, it } from "vitest";

import { joinCoraxRoutePath, normalizePublicCoraxRoutePath } from "#shared/corax-route-path.js";

describe("joinCoraxRoutePath", () => {
  it("maps an internal route onto a compact named-agent mount", () => {
    expect(joinCoraxRoutePath("/corax/support", "/corax/v1/session")).toBe("/corax/support/v1/session");
  });

  it("appends an internal route to ordinary mounts unchanged", () => {
    expect(joinCoraxRoutePath("/api/support", "/corax/v1/session")).toBe("/api/support/corax/v1/session");
  });

  it("does not duplicate the protocol base", () => {
    expect(joinCoraxRoutePath("/corax/support/v1", "/corax/v1/session")).toBe("/corax/support/v1/session");
  });
});

describe("normalizePublicCoraxRoutePath", () => {
  it("maps a compact named-agent route to its internal route", () => {
    expect(normalizePublicCoraxRoutePath("/corax/support/v1/callback/token")).toBe(
      "/corax/v1/callback/token",
    );
  });

  it("preserves ordinary and internal routes", () => {
    expect(normalizePublicCoraxRoutePath("/api/support/v1/callback/token")).toBe(
      "/api/support/v1/callback/token",
    );
    expect(normalizePublicCoraxRoutePath("/corax/v1/callback/token")).toBe("/corax/v1/callback/token");
  });
});
