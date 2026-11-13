import { afterEach, describe, expect, it, vi } from "vitest";

import { TEST_USAGE, stampTestEvent } from "#internal/testing/events.js";
import { createSessionWaitingEvent, type MessageStreamEvent } from "#protocol/message.js";
import { sessions } from "#public/server/index.js";
import { withHistoryReadScope } from "#execution/history-read-scope.js";
import {
  assertSessionHistoryReadable,
  readSessionEventHistory,
  readSessionStreamTailIndex,
} from "#execution/session-event-stream.js";

const getRunMock = vi.fn();
const runMetadataMock = vi.fn(async () => ({}));

vi.mock("#compiled/@workflow/core/runtime.js", () => ({
  getRun: (...args: unknown[]) => getRunMock(...args),
  getWorld: async () => ({ runs: { get: runMetadataMock } }),
}));

const encoder = new TextEncoder();

/**
 * Mocks one session's durable stream holding `stored` events. With
 * `open: true`, reads never reach EOF, like a live session.
 */
function mockSessionStream(
  stored: readonly MessageStreamEvent[],
  options: { open?: boolean } = {},
) {
  const startIndexes: Array<number | undefined> = [];
  const cancelled: Array<number | undefined> = [];
  const tailReads = vi.fn(async () => stored.length - 1);
  getRunMock.mockImplementation(() => ({
    getReadable(readOptions?: { startIndex?: number }) {
      const startIndex = readOptions?.startIndex;
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          if (startIndex === undefined) return;
          startIndexes.push(startIndex);
          for (const event of stored.slice(startIndex)) {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          }
          if (!options.open) controller.close();
        },
        cancel() {
          cancelled.push(startIndex);
        },
      });
      return Object.assign(readable, { getTailIndex: tailReads });
    },
  }));
  return { cancelled, startIndexes, tailReads };
}

const storedEvents = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    stampTestEvent(createSessionWaitingEvent(TEST_USAGE), index),
  );

async function collect(iterable: AsyncIterable<MessageStreamEvent>) {
  const events: MessageStreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

afterEach(() => {
  getRunMock.mockReset();
  runMetadataMock.mockReset();
  runMetadataMock.mockResolvedValue({});
});

describe("sessions.attach().stream()", () => {
  it("captures one finite boundary before stream pulls leave the request scope", async () => {
    const stored = storedEvents(3);
    const stream = mockSessionStream(stored, { open: true });
    const result = await withHistoryReadScope("wrun_1", async () => {
      const history = readSessionEventHistory("wrun_1", -2);
      const tail = await readSessionStreamTailIndex("wrun_1");
      return { history, tail };
    });
    stored.push(...storedEvents(1));
    const reader = result.history.getReader();
    const events = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      events.push(next.value);
    }
    expect(result.tail).toBe(2);
    expect(events.map((event) => event.meta.id)).toEqual([stored[1]!.meta.id, stored[2]!.meta.id]);
    expect(stream.tailReads).toHaveBeenCalledTimes(1);
    expect(await readSessionStreamTailIndex("wrun_1")).toBe(3);
    expect(stream.tailReads).toHaveBeenCalledTimes(2);
  });

  it("rejects expired history without mistaking retained chunks for a readable session", async () => {
    runMetadataMock.mockResolvedValue({ expiredAt: new Date(0), status: "completed" });
    await expect(assertSessionHistoryReadable("wrun_1")).rejects.toMatchObject({
      name: "RunExpiredError",
    });
    expect(getRunMock).not.toHaveBeenCalled();
  });

  it("ends a bounded read at the tail observed when it opens", async () => {
    const stored = storedEvents(3);
    const stream = mockSessionStream(stored, { open: true });

    const events = await collect(
      sessions.attach("wrun_1").stream({ startIndex: 1, follow: false }),
    );

    expect(getRunMock).toHaveBeenCalledWith("wrun_1");
    expect(events.map((event) => event.meta.id)).toEqual([stored[1]!.meta.id, stored[2]!.meta.id]);
    expect(stream.startIndexes).toEqual([1]);
    expect(stream.cancelled).toContain(1);
  });

  it("resolves a tail-relative start against the tail", async () => {
    const stored = storedEvents(5);
    const stream = mockSessionStream(stored);

    const events = await collect(sessions.attach("wrun_1").stream({ startIndex: -2 }));

    expect(events.map((event) => event.meta.id)).toEqual([stored[3]!.meta.id, stored[4]!.meta.id]);
    expect(stream.startIndexes).toEqual([3]);
  });

  it("returns immediately when a bounded read starts past the tail", async () => {
    const stream = mockSessionStream(storedEvents(2));

    await expect(
      collect(sessions.attach("wrun_1").stream({ startIndex: 2, follow: false })),
    ).resolves.toEqual([]);
    expect(stream.startIndexes).toEqual([]);
  });

  it("stops a following read when its signal aborts", async () => {
    const stored = storedEvents(2);
    const stream = mockSessionStream(stored, { open: true });
    const abort = new AbortController();
    const events: MessageStreamEvent[] = [];

    for await (const event of sessions.attach("wrun_1").stream({ signal: abort.signal })) {
      events.push(event);
      if (events.length === 2) abort.abort();
    }

    expect(events.map((event) => event.meta.id)).toEqual(stored.map((event) => event.meta.id));
    expect(stream.cancelled).toContain(0);
  });
});
