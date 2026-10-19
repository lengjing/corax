import { describe, expect, it } from "vitest";

import { normalizePublicRoutePrefix } from "#shared/public-route-prefix.js";

describe("normalizePublicRoutePrefix", () => {
  it("returns undefined for values resolving to the root route", () => {
    expect(normalizePublicRoutePrefix(undefined)).toBeUndefined();
    expect(normalizePublicRoutePrefix("")).toBeUndefined();
    expect(normalizePublicRoutePrefix("   ")).toBeUndefined();
    expect(normalizePublicRoutePrefix("/")).toBeUndefined();
    expect(normalizePublicRoutePrefix("//")).toBeUndefined();
  });

  it("adds the leading slash", () => {
    expect(normalizePublicRoutePrefix("corax/support")).toBe("/corax/support");
  });

  it("strips trailing slashes", () => {
    expect(normalizePublicRoutePrefix("/corax/support/")).toBe("/corax/support");
    expect(normalizePublicRoutePrefix("/corax/support//")).toBe("/corax/support");
  });

  it("keeps an already-normalized prefix unchanged", () => {
    expect(normalizePublicRoutePrefix("/corax/support")).toBe("/corax/support");
  });
});
