import { clipVisible, visibleLength } from "#cli/ui/terminal-text.js";
import type { Theme } from "./theme.js";
import type { LogDisplayMode } from "./log-display-mode.js";
import type { ModelEndpointStatus } from "#shared/model-endpoint-status.js";
import { formatModelSummary } from "#shared/model-summary.js";

export interface DevBuildStatus {
  readonly phase: "building" | "complete";
  readonly summary: string;
}

function formatDevBuildStatus(status: DevBuildStatus, theme: Theme): string {
  const complete = status.phase === "complete";
  const glyph = complete ? theme.glyph.success : theme.glyph.validating;
  const summary = complete
    ? status.summary.replace(/ changed$/u, " updated")
    : `${status.summary.replace(/ (?:added|changed|removed)$/u, "")} updating…`;
  return `${glyph} ${summary}`;
}

interface StatusLineInput {
  /** Transient authored-source build state, independent of the server log filter. */
  devBuild?: DevBuildStatus;
  /** Resolved model slug, e.g. "anthropic/claude-sonnet-5"; absent when `/corax/v1/info` failed. */
  model?: string;
  /** Keep the dynamic-model label separate from the resolved model id. */
  dynamicModel?: boolean;
  /** Authored reasoning effort, shown after the model label, e.g. `· high`. */
  reasoning?: string;
  /** True when the Gateway priority tier is on; adds a speed marker. */
  fastMode?: boolean;
  /**
   * Transient dev-TUI log-display mode shown after a Ctrl+L cycle, e.g.
   * `sandbox`. Rendered as a prominent leading `logs: <mode>` segment that
   * survives width degradation and can stand alone; absent once the hint times
   * out.
   */
  logLevel?: LogDisplayMode;
  /** Model endpoint readiness: external, or AI Gateway connected/not-connected. */
  endpoint?: ModelEndpointStatus;
  theme: Theme;
  width: number;
}

function renderModel(
  input: Pick<StatusLineInput, "model" | "dynamicModel" | "reasoning" | "fastMode" | "theme">,
): string | undefined {
  const c = input.theme.colors;
  if (input.model === undefined && input.dynamicModel !== true) return undefined;
  const summary: Parameters<typeof formatModelSummary>[0] = {
    model: input.model ?? "dynamic model",
  };
  if (input.reasoning !== undefined) summary.reasoning = input.reasoning;
  if (input.fastMode === true || summary.model.endsWith("-fast")) {
    summary.fastGlyph = input.theme.glyph.fast;
  }
  const prefix = input.dynamicModel === true && input.model !== undefined ? "dynamic model · " : "";
  const label = `${prefix}${formatModelSummary(summary)}`;
  return c.dim(label);
}

/** Provider slugs whose display name differs from the AI SDK's identifier. */
const EXTERNAL_PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  // `chatgpt()` wraps the Codex backend; what the user connected is their
  // ChatGPT subscription, so the bar names that, not the transport.
  codex: "chatgpt-sub",
};

function renderEndpoint(input: Pick<StatusLineInput, "endpoint" | "theme">): string | undefined {
  if (input.endpoint === undefined) return undefined;

  const c = input.theme.colors;
  const g = input.theme.glyph;
  const clause = (name: string, suffix: string) => `${name}${c.dim(suffix)}`;
  if (input.endpoint.kind === "external") {
    const provider =
      EXTERNAL_PROVIDER_DISPLAY_NAMES[input.endpoint.provider] ?? input.endpoint.provider;
    // The `⌝` mark stays at the terminal's default foreground — full
    // intensity on any theme — while the clause around it is dim.
    return `${c.dim(provider)}${g.external}`;
  }
  if (input.endpoint.kind === "chatgpt") {
    switch (input.endpoint.state) {
      case "ready":
        return `${c.dim("chatgpt-sub")}${g.external}`;
      case "checking":
        return c.dim("chatgpt-sub checking…");
      case "signed-out":
      case "reauth-required":
        return c.yellow(`${g.warning} chatgpt-sub login · /login`);
      case "unavailable":
        return c.yellow(`${g.warning} chatgpt-sub unavailable`);
    }
  }
  if (!input.endpoint.connected) {
    return c.yellow(`${g.warning} ai-gateway`);
  }
  return clause("ai-gateway", "(api-key)");
}

/** Builds model and connection segments, degrading gracefully at narrow widths. */
export function buildStatusLine(input: StatusLineInput): string | undefined {
  const { theme, width } = input;
  const c = theme.colors;

  const devBuild =
    input.devBuild === undefined ? undefined : formatDevBuildStatus(input.devBuild, theme);
  const logLevel = input.logLevel === undefined ? undefined : c.cyan(`logs: ${input.logLevel}`);
  const model = renderModel(input);
  const endpoint = renderEndpoint(input);

  const separator = c.dim(" · ");
  const compose = (segments: ReadonlyArray<string | undefined>): string =>
    segments.filter((segment) => segment !== undefined).join(separator);

  const leftVariants = [
    compose([logLevel, model, endpoint]),
    compose([logLevel, model]),
    compose([logLevel]),
  ];

  if (devBuild !== undefined) {
    for (const left of leftVariants) {
      const leftWidth = visibleLength(left);
      const rightWidth = visibleLength(devBuild);
      const gap = leftWidth > 0 ? 2 : 0;
      if (leftWidth + gap + rightWidth > width) continue;
      return `${left}${" ".repeat(width - leftWidth - rightWidth)}${devBuild}`;
    }
    return clipVisible(devBuild, width);
  }

  if (leftVariants[0]!.length === 0) return undefined;
  for (const variant of leftVariants) {
    if (variant.length > 0 && visibleLength(variant) <= width) return variant;
  }
  // Later variants can be empty, for example when there is no log-level hint.
  const narrowest = leftVariants.findLast((variant) => variant.length > 0)!;
  return clipVisible(narrowest, width);
}
