import fs, { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorld } from "#compiled/@workflow/world-local/index.js";

const RUN = "wrun_sqlitereads";
const STREAM = "strm_sqlitereads";
const CHUNKS = 65;
const cursorAt = (index: number) => Buffer.from(JSON.stringify({ i: index })).toString("base64");

describe("official SQLite local World", () => {
  let root: string;
  let dataDir: string;
  let world: ReturnType<typeof createWorld>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "corax-sqlite-world-"));
    dataDir = join(root, "data");
    world = createWorld({ dataDir, recoverActiveRuns: false, queueAuthKey: "read" });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await world?.close?.();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  async function writeChunks() {
    await world.streams.writeMulti!(
      RUN,
      STREAM,
      Array.from({ length: CHUNKS }, (_, index) => `payload-${index}`),
    );
  }

  it("does not create a database or data directory for empty read-only inspection", async () => {
    expect(await world.streams.getInfo(RUN, STREAM)).toEqual({ tailIndex: -1, done: false });
    await expect(stat(dataDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stores chunks in world.db without per-chunk directories", async () => {
    await writeChunks();
    expect((await stat(join(dataDir, "world.db"))).isFile()).toBe(true);
    expect(await readdir(dataDir)).not.toContain("streams");
    expect(await world.streams.getInfo(RUN, STREAM)).toEqual({
      tailIndex: CHUNKS - 1,
      done: false,
    });
    expect(await world.streams.list(RUN)).toEqual([STREAM]);
  });

  it("reads tail metadata and late pages without opening historical chunk files", async () => {
    await writeChunks();
    await world.close?.();
    world = createWorld({ dataDir, recoverActiveRuns: false, queueAuthKey: "read" });
    const opens = vi.spyOn(fs, "open");
    const listings = vi.spyOn(fs, "readdir");
    expect(await world.streams.getInfo(RUN, STREAM)).toEqual({
      tailIndex: CHUNKS - 1,
      done: false,
    });
    const page = await world.streams.getChunks(RUN, STREAM, {
      cursor: cursorAt(CHUNKS - 3),
      limit: 2,
    });
    expect(page.data.map((chunk) => chunk.index)).toEqual([CHUNKS - 3, CHUNKS - 2]);
    expect(page).toMatchObject({ hasMore: true, done: false });
    expect(opens).not.toHaveBeenCalled();
    expect(listings).not.toHaveBeenCalled();
  });

  it("preserves the first committed EOF and ignores writes after close", async () => {
    await writeChunks();
    await world.streams.close(RUN, STREAM);
    await world.streams.write(RUN, STREAM, "after-eof");
    await world.streams.close(RUN, STREAM);
    expect(await world.streams.getInfo(RUN, STREAM)).toEqual({ tailIndex: CHUNKS - 1, done: true });
    const page = await world.streams.getChunks(RUN, STREAM, { cursor: cursorAt(CHUNKS - 2) });
    expect(page.data.map((chunk) => new TextDecoder().decode(chunk.data))).toEqual([
      "payload-63",
      "payload-64",
    ]);
    expect(page.done).toBe(true);
    const reader = (await world.streams.get(RUN, STREAM, CHUNKS)).getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });

  it("resolves negative cursors and releases a cancelled reader", async () => {
    await writeChunks();
    const reader = (await world.streams.get(RUN, STREAM, -2)).getReader();
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("payload-63");
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("payload-64");
    } finally {
      await reader.cancel();
    }
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });

  it("a tagged clear preserves other streams and reopening preserves data", async () => {
    await writeChunks();
    const tagged = createWorld({
      dataDir,
      tag: "fixture",
      recoverActiveRuns: false,
      queueAuthKey: "read",
    });
    try {
      await tagged.streams.write("wrun_tagged", "strm_tagged", "tagged");
      await tagged.clear();
      expect(await tagged.streams.getInfo("wrun_tagged", "strm_tagged")).toEqual({
        tailIndex: -1,
        done: false,
      });
      expect(await world.streams.getInfo(RUN, STREAM)).toEqual({
        tailIndex: CHUNKS - 1,
        done: false,
      });
    } finally {
      await tagged.close?.();
    }
    await world.close?.();
    world = createWorld({ dataDir, recoverActiveRuns: false, queueAuthKey: "read" });
    expect(await world.streams.getInfo(RUN, STREAM)).toEqual({
      tailIndex: CHUNKS - 1,
      done: false,
    });
  });
});
