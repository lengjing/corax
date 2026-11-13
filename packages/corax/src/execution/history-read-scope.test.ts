import { describe, expect, it } from "vitest";

import { readScopedTail, withHistoryReadScope } from "#execution/history-read-scope.js";

describe("finite history read scope", () => {
  it("shares a boundary only within one request and session", async () => {
    let reads = 0;
    const read = async () => ++reads;
    await withHistoryReadScope("one", async () => {
      expect(await Promise.all([readScopedTail("one", read), readScopedTail("one", read)])).toEqual(
        [1, 1],
      );
      expect(await readScopedTail("other", read)).toBe(2);
      expect(await readScopedTail("other", read)).toBe(3);
    });
    const concurrent = await Promise.all([
      withHistoryReadScope("one", () => readScopedTail("one", read)),
      withHistoryReadScope("one", () => readScopedTail("one", read)),
    ]);
    expect(concurrent[0]).not.toBe(concurrent[1]);
    expect(await readScopedTail("one", read)).toBe(6);
  });

  it("does not reuse a rejected tail in a later request", async () => {
    const error = new Error("unreadable");
    let reads = 0;
    const read = async () => {
      reads++;
      throw error;
    };
    await withHistoryReadScope("one", async () => {
      const first = readScopedTail("one", read);
      expect(readScopedTail("one", read)).toBe(first);
      await expect(first).rejects.toBe(error);
    });
    expect(reads).toBe(1);
    expect(await withHistoryReadScope("one", () => readScopedTail("one", async () => 9))).toBe(9);
  });
});
