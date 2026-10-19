import type { CoraxCliTelemetry } from "./index.js";

/** Self-hosted CLI commands do not collect or forward upstream telemetry. */
export const disabledCliTelemetry: CoraxCliTelemetry = {
  trackCommand() {},
  trackDevContext() {},
  trackSetupStep() {},
  trackSetupTerminal() {},
  trackOutcome() {},
  async notify() {},
  async flush() {},
};
