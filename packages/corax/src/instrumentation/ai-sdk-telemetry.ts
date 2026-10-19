import { OpenTelemetry } from "#compiled/@ai-sdk/otel/index.js";
import { registerTelemetry, type Telemetry } from "ai";
import { createLogger } from "#internal/logging.js";

const log = createLogger("harness.ai-sdk-telemetry");
let registered = false;
let coraxOtelIntegration: Telemetry | undefined;
let errorSafeCoraxOtelIntegration: Telemetry | undefined;
let warnedMissingCoraxOtelIntegration = false;

/**
 * Registers the AI SDK OpenTelemetry integration once so that model
 * calls emit OTel spans, including runtime-context attributes. Safe to
 * call multiple times — only the first call has an effect.
 *
 * In AI SDK v7 the built-in OTel tracing was moved to `@ai-sdk/otel`
 * and must be registered explicitly.
 */
export function ensureOtelIntegration(): void {
  if (registered) {
    return;
  }
  registered = true;
  coraxOtelIntegration = new OpenTelemetry({ runtimeContext: true });
  errorSafeCoraxOtelIntegration = telemetryWithoutErrorContent(coraxOtelIntegration);
  registerTelemetry(coraxOtelIntegration);
}

/**
 * Every integration currently registered with the AI SDK — corax's own, plus any
 * an authored instrumentation module added with `registerTelemetry`.
 *
 * A per-call `integrations` list replaces the registered ones rather than
 * adding to them, so anything that passes integrations per call has to carry
 * these forward or they stop receiving events.
 */
export function getRegisteredTelemetryIntegrations(options?: {
  readonly excludeCoraxOtelIntegration?: boolean;
  readonly sanitizeCoraxOtelErrors?: boolean;
}): readonly Telemetry[] {
  const registered = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS ?? [];
  const integrations =
    options?.excludeCoraxOtelIntegration === true
      ? registered.filter((integration) => integration !== coraxOtelIntegration)
      : registered;
  if (options?.sanitizeCoraxOtelErrors !== true) return integrations;
  let matched = false;
  const sanitized = integrations.map((integration) => {
    if (integration !== coraxOtelIntegration || errorSafeCoraxOtelIntegration === undefined) {
      return integration;
    }
    matched = true;
    return errorSafeCoraxOtelIntegration;
  });
  if (!matched && options.excludeCoraxOtelIntegration !== true && !warnedMissingCoraxOtelIntegration) {
    warnedMissingCoraxOtelIntegration = true;
    log.warn("could not sanitize corax's AI SDK OpenTelemetry integration", {
      reason:
        coraxOtelIntegration === undefined
          ? "corax OpenTelemetry integration was not registered"
          : "registered integration identity did not match",
    });
  }
  return sanitized;
}

/** @internal */
export function telemetryWithoutErrorContent(integration: Telemetry): Telemetry {
  const genericError = (): Error => new Error("AI SDK operation failed");
  return new Proxy(integration, {
    get(target, property) {
      if (property === "onError" && target.onError !== undefined) {
        return (event: unknown) =>
          target.onError!(
            typeof event === "object" && event !== null
              ? { ...event, error: genericError() }
              : genericError(),
          );
      }
      if (property === "onToolExecutionEnd" && target.onToolExecutionEnd !== undefined) {
        return (event: Parameters<NonNullable<Telemetry["onToolExecutionEnd"]>>[0]) =>
          target.onToolExecutionEnd!(
            event.toolOutput.type === "tool-error"
              ? { ...event, toolOutput: { ...event.toolOutput, error: genericError() } }
              : event,
          );
      }
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
