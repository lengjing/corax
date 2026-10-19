import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disableCoraxTelemetry,
  enableCoraxTelemetry,
  showCoraxTelemetryStatus,
} from "#cli/telemetry/command.js";
import { readCoraxTelemetryPreference, setCoraxTelemetryEnabled } from "#cli/telemetry/preference.js";

vi.mock("#cli/telemetry/preference.js", () => ({
  readCoraxTelemetryPreference: vi.fn(async () => ({ enabled: true, notified: false })),
  setCoraxTelemetryEnabled: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("corax telemetry", () => {
  it("reports the durable preference", async () => {
    vi.mocked(readCoraxTelemetryPreference).mockResolvedValue({ enabled: false, notified: true });
    const logger = { log: vi.fn() };

    await showCoraxTelemetryStatus(logger);

    expect(logger.log).toHaveBeenCalledWith("Telemetry status: Disabled");
  });

  it("updates the durable preference", async () => {
    const logger = { log: vi.fn() };

    await enableCoraxTelemetry(logger);
    await disableCoraxTelemetry(logger);

    expect(setCoraxTelemetryEnabled).toHaveBeenNthCalledWith(1, true);
    expect(setCoraxTelemetryEnabled).toHaveBeenNthCalledWith(2, false);
  });
});
