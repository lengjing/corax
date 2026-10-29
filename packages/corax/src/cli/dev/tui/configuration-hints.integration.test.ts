import { describe, expect, it } from "vitest";
import { initialConversationState } from "#client/conversation-reducer.js";
import type { StepFailedStreamEvent } from "#client/index.js";
import { formatFailureMessage, localFailureHint } from "./errors.js";
import { tuiSessionReducer } from "./conversation-view.js";
import { buildStatusLine } from "./status-line.js";
import { createTheme } from "./theme.js";
import { TerminalRenderer } from "./terminal-renderer.js";
import { MockScreen, MockUserInput } from "./test/mock-terminal.js";
import { parsePromptCommand } from "./prompt-commands.js";

describe("local configuration hints", () => {
  it.each([
    "gateway-auth-invalid-api-key",
    "gateway-auth-invalid-oidc-token",
    "gateway-auth-missing-credentials",
  ])("renders actionable configuration guidance for %s", async (semanticErrorId) => {
    const event = {
      type: "step.failed",
      data: {
        code: "MODEL_CALL_FAILED",
        message: "Authentication failed",
        sequence: 0,
        stepIndex: 0,
        turnId: "t0",
        details: { semanticErrorId },
      },
    } as StepFailedStreamEvent;
    const screen = new MockScreen({ columns: 120, rows: 30 });
    const renderer = new TerminalRenderer({
      input: new MockUserInput(),
      output: screen,
      captureForeignOutput: false,
      unicode: true,
    });
    const prompt = renderer.readInput();
    try {
      renderer.renderConversation({
        conversation: initialConversationState(),
        working: false,
        data: tuiSessionReducer.initial(),
        failures: [{ message: formatFailureMessage(event), hint: localFailureHint(event)! }],
      });
      const rendered = screen.snapshot();
      expect(rendered).toContain("AI_GATEWAY_API_KEY");
      expect(rendered).toContain("restart corax dev");
      expect(rendered).not.toMatch(/\/(?:login|model)\b/);
      for (const command of rendered.match(/\/[a-z-]+\b/g) ?? []) {
        expect(parsePromptCommand(command)).not.toBeNull();
      }
    } finally {
      renderer.shutdown();
      await expect(prompt).rejects.toThrow("Interrupted");
    }
  });

  it.each(["signed-out", "reauth-required"] as const)(
    "renders provider configuration guidance for %s",
    (state) => {
      const rendered = buildStatusLine({
        endpoint: { kind: "chatgpt", state },
        theme: createTheme({ color: false }),
        width: 120,
      });
      expect(rendered).toContain("configure provider credentials");
      expect(rendered).toContain("restart corax dev");
      expect(rendered).not.toMatch(/\/(?:login|model)\b/);
    },
  );
});
