import { describe, expect, it, vi } from "vitest";

import { HookNotFoundError } from "#compiled/@workflow/errors/index.js";
import type { World } from "#compiled/@workflow/world/index.js";
import { CORAX_VERSION_ATTRIBUTE } from "#execution/corax-workflow-attributes.js";
import {
  SESSION_TIMEOUT_WORKFLOW_NAME,
  WORKFLOW_ENTRY_NAME,
  WORKFLOW_TOOL_RUN_WORKFLOW_NAME,
} from "#execution/stable-workflow-names.js";
import { resolveInstalledPackageInfo } from "#internal/application/package.js";
import { captureLogRecords } from "#internal/testing/log-records.js";
import { parkedAnchorWorkflow } from "#internal/testing/session-inbox-workflow.js";
import { waitForHook } from "#internal/testing/workflow-test-helpers.js";
import { getWorld, start } from "#internal/workflow/runtime.js";
import { guardStrandedSessionReplay } from "#execution/session-inbox/stranded-replay-guard.js";

type QueueHandler = Parameters<World["createQueueHandler"]>[1];

const QUEUE_PREFIX = "__corax_test_wkf_workflow_";
const { name: packageName, version: currentCoraxVersion } = resolveInstalledPackageInfo();
const SESSION_QUEUE = `${QUEUE_PREFIX}workflow//${packageName}//${WORKFLOW_ENTRY_NAME}`;
const TOOL_QUEUE = `${QUEUE_PREFIX}workflow//${packageName}//${WORKFLOW_TOOL_RUN_WORKFLOW_NAME}`;

/** Parks a run on the shared local World, stamped with the given `$corax.version` and attributes. */
async function parkRun(
  token: string,
  coraxVersion: string | undefined,
  attributes: Readonly<Record<string, string>> = {},
) {
  const stamped: Record<string, string> = { ...attributes };
  if (coraxVersion !== undefined) stamped[CORAX_VERSION_ATTRIBUTE] = coraxVersion;
  const run = await start(parkedAnchorWorkflow, [{ token }], {
    allowReservedAttributes: true,
    attributes: stamped,
  });
  await waitForHook(run, { token });
  return run;
}

/**
 * Guards a view of the shared World whose queue hands back the wrapped
 * delivery handler, so the test can deliver messages without a queue.
 */
async function guardedDelivery(capabilities?: World["capabilities"]) {
  const world = Object.create(await getWorld()) as World;
  if (capabilities !== undefined) world.capabilities = capabilities;
  let wrapped: QueueHandler | undefined;
  world.createQueueHandler = (_prefix, handler) => {
    wrapped = handler;
    return async () => new Response();
  };
  const handler = vi.fn<QueueHandler>(async () => undefined);
  guardStrandedSessionReplay(world).createQueueHandler(QUEUE_PREFIX, handler);
  const deliver = async (runId: string, queueName = SESSION_QUEUE) =>
    await wrapped!(
      { runId },
      { attempt: 1, messageId: "msg_1" as never, queueName: queueName as never },
    );
  return { deliver, handler, world };
}

describe("guardStrandedSessionReplay", () => {
  it.each([{ coraxVersion: "0.0.1" }, { coraxVersion: undefined }])(
    "acknowledges a stranded session from corax $coraxVersion without replaying it",
    async ({ coraxVersion }) => {
      const logs = captureLogRecords();
      const run = await parkRun(`replay-guard:stranded:${coraxVersion}`, coraxVersion);
      try {
        const { deliver, handler } = await guardedDelivery();

        await expect(deliver(run.runId)).resolves.toBeUndefined();

        expect(handler).not.toHaveBeenCalled();
        await expect(run.status).resolves.toBe("running");
        expect(logs.records).toContainEqual(
          expect.objectContaining({
            level: "warn",
            message: expect.stringContaining(`stranded session run "${run.runId}"`),
          }),
        );
      } finally {
        await run.cancel();
      }
    },
  );

  it.each([
    { kind: "subagent", coraxVersion: "0.0.1", queue: SESSION_QUEUE },
    { kind: "subagent", coraxVersion: undefined, queue: SESSION_QUEUE },
    { kind: "workflow tool", coraxVersion: "0.0.1", queue: TOOL_QUEUE },
    { kind: "workflow tool", coraxVersion: undefined, queue: TOOL_QUEUE },
  ])("retires a $kind from corax $coraxVersion without replay", async ({ kind, coraxVersion, queue }) => {
    captureLogRecords();
    const token = `replay-guard:retire:${kind}:${coraxVersion}`;
    const run = await parkRun(
      token,
      coraxVersion,
      kind === "subagent" ? { "$corax.type": "subagent" } : {},
    );
    try {
      const { deliver, handler, world } = await guardedDelivery();

      await expect(deliver(run.runId, queue)).resolves.toBeUndefined();

      expect(handler).not.toHaveBeenCalled();
      await expect(run.status).resolves.toBe("cancelled");
      await expect(world.hooks.getByToken(token)).rejects.toSatisfy(HookNotFoundError.is);
      const events = await world.events.list({ runId: run.runId, resolveData: "all" });
      expect(events.data).toContainEqual(
        expect.objectContaining({
          eventType: "run_cancelled",
          eventData: { cancelReason: "Run retired: its corax deployment is no longer available" },
        }),
      );
      await expect(deliver(run.runId, queue)).resolves.toBeUndefined();
    } finally {
      if ((await run.status) === "running") await run.cancel();
    }
  });

  it("retries a delivery whose run cannot be read instead of replaying it", async () => {
    const run = await parkRun("replay-guard:unreadable", "0.0.1");
    try {
      const { deliver, handler, world } = await guardedDelivery();
      const runs = world.runs;
      world.runs = {
        ...runs,
        get: vi
          .fn()
          .mockRejectedValueOnce(new Error("storage unavailable"))
          .mockImplementation(runs.get.bind(runs)),
      };

      await expect(deliver(run.runId)).rejects.toThrow("storage unavailable");
      expect(handler).not.toHaveBeenCalled();

      captureLogRecords();
      await expect(deliver(run.runId)).resolves.toBeUndefined();
      expect(handler).not.toHaveBeenCalled();
      await expect(run.status).resolves.toBe("running");
    } finally {
      await run.cancel();
    }
  });

  it("retries retirement after a cancellation write fails without replaying the run", async () => {
    captureLogRecords();
    const token = "replay-guard:retry-retirement";
    const run = await parkRun(token, "0.0.1");
    try {
      const { deliver, handler, world } = await guardedDelivery();
      const failure = new Error("storage unavailable");
      world.events = {
        ...world.events,
        create: vi
          .fn()
          .mockRejectedValueOnce(failure)
          .mockImplementation(world.events.create.bind(world.events)),
      };

      await expect(deliver(run.runId, TOOL_QUEUE)).rejects.toThrow("storage unavailable");
      expect(handler).not.toHaveBeenCalled();
      await expect(run.status).resolves.toBe("running");
      await expect(world.hooks.getByToken(token)).resolves.toMatchObject({ runId: run.runId });

      await expect(deliver(run.runId, TOOL_QUEUE)).resolves.toBeUndefined();
      await expect(run.status).resolves.toBe("cancelled");
      expect(handler).not.toHaveBeenCalled();
    } finally {
      if ((await run.status) === "running") await run.cancel();
    }
  });

  it.each([
    { case: "a runnable session run", coraxVersion: currentCoraxVersion, queue: SESSION_QUEUE },
    { case: "a runnable workflow tool run", coraxVersion: currentCoraxVersion, queue: TOOL_QUEUE },
    {
      case: "an older session timeout run",
      coraxVersion: "0.0.1",
      queue: `${QUEUE_PREFIX}workflow//${packageName}//${SESSION_TIMEOUT_WORKFLOW_NAME}`,
    },
    {
      case: "another workflow's run",
      coraxVersion: "0.0.1",
      queue: `${QUEUE_PREFIX}workflow//${packageName}//turnWorkflow`,
    },
    {
      capabilities: { deploymentAffinity: true },
      case: "an older session run where the World replays it on its own deployment",
      coraxVersion: "0.0.1",
      queue: SESSION_QUEUE,
    },
    {
      attributes: { "$corax.type": "subagent" },
      case: "a runnable subagent session run",
      coraxVersion: currentCoraxVersion,
      queue: SESSION_QUEUE,
    },
    {
      capabilities: { deploymentAffinity: true },
      case: "an older workflow tool run on its own deployment",
      coraxVersion: "0.0.1",
      queue: TOOL_QUEUE,
    },
  ])("delivers $case", async ({ attributes, capabilities, case: name, coraxVersion, queue }) => {
    const run = await parkRun(`replay-guard:${name}`, coraxVersion, attributes);
    try {
      const { deliver, handler } = await guardedDelivery(capabilities);

      await deliver(run.runId, queue);

      expect(handler).toHaveBeenCalledOnce();
    } finally {
      await run.cancel();
    }
  });
});
