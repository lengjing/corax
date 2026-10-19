import { describe, expect, it } from "vitest";

import {
  assertValidVercelServiceName,
  isValidVercelServiceName,
} from "#internal/vercel/vercel-service-name.js";

describe("Vercel service names", () => {
  it("accepts the Vercel Services naming grammar", () => {
    expect(isValidVercelServiceName("corax-support_agent")).toBe(true);
    expect(isValidVercelServiceName("a".repeat(64))).toBe(true);
  });

  it("rejects digits, invalid boundaries, and names longer than 64 characters", () => {
    expect(isValidVercelServiceName("corax-agent1")).toBe(false);
    expect(isValidVercelServiceName("-corax")).toBe(false);
    expect(isValidVercelServiceName("a".repeat(65))).toBe(false);
    expect(() => assertValidVercelServiceName("corax-agent1", "Service name")).toThrow(
      /Service name/,
    );
  });
});
