import type { Command } from "#compiled/commander/index.js";
import { flushCoraxCliTelemetry } from "#cli/telemetry/flush.js";
import { readCoraxTelemetryPreference, setCoraxTelemetryEnabled } from "#cli/telemetry/preference.js";

type TelemetryLogger = {
  log(message: string): void;
};

export function registerCoraxTelemetryCommands(program: Command, logger: TelemetryLogger): void {
  const telemetry = program
    .command("telemetry")
    .description("Enable or disable CLI telemetry collection.");
  telemetry
    .command("status")
    .description("Show whether telemetry collection is enabled.")
    .action(async () => {
      await showCoraxTelemetryStatus(logger);
    });
  telemetry
    .command("enable")
    .description("Enable telemetry collection.")
    .action(async () => {
      await enableCoraxTelemetry(logger);
    });
  telemetry
    .command("disable")
    .description("Disable telemetry collection.")
    .action(async () => {
      await disableCoraxTelemetry(logger);
    });
  telemetry.command("flush <payload>", { hidden: true }).action(async (payload: string) => {
    await flushCoraxCliTelemetry(payload);
  });
}

export async function showCoraxTelemetryStatus(logger: TelemetryLogger): Promise<void> {
  const { enabled } = await readCoraxTelemetryPreference();
  logger.log(`Telemetry status: ${enabled ? "Enabled" : "Disabled"}`);
}

export async function enableCoraxTelemetry(logger: TelemetryLogger): Promise<void> {
  await setCoraxTelemetryEnabled(true);
  logger.log("Telemetry collection enabled.");
}

export async function disableCoraxTelemetry(logger: TelemetryLogger): Promise<void> {
  await setCoraxTelemetryEnabled(false);
  logger.log("Telemetry collection disabled. No data will be collected from this machine.");
}
