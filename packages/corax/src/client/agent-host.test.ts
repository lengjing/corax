import { describe, expect, it } from "vitest";

import { resolveCoraxAgentHost } from "#client/agent-host.js";

describe("resolveCoraxAgentHost", () => {
  it("defaults to same-origin root corax routes", () => {
    expect(resolveCoraxAgentHost({})).toBe("");
  });

  it("preserves explicit hosts", () => {
    expect(resolveCoraxAgentHost({ host: "/api" })).toBe("/api");
  });

  it("maps a named agent to the same-origin named route prefix", () => {
    expect(resolveCoraxAgentHost({ agent: "support" })).toBe("/corax/support");
  });

  it("rejects host and agent together", () => {
    expect(() => resolveCoraxAgentHost({ agent: "support", host: "/api" })).toThrow(
      "cannot combine agent and host",
    );
  });

  it("rejects names that are not safe route segments", () => {
    expect(() => resolveCoraxAgentHost({ agent: "Support" })).toThrow("corax agent name");
  });
});
