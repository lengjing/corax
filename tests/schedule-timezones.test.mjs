import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "./support/test.mjs";

const execute = promisify(execFile);
const moduleUrl = (path) => new URL(`../packages/corax/src/${path}.ts`, import.meta.url).href;

test("one-time schedules and delay delivery are independent of the host timezone", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "corax-schedule-timezones-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = `
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { nextSingleScheduleTime } from ${JSON.stringify(moduleUrl("shared/schedule-time"))};
import { sqliteScheduleProvider, pumpSqliteSchedules } from ${JSON.stringify(moduleUrl("public/schedules/providers/sqlite"))};
import { inMemoryScheduleProvider } from ${JSON.stringify(moduleUrl("public/schedules/providers/in-memory"))};
import { resolveScheduleTiming } from ${JSON.stringify(moduleUrl("runtime/schedules/validation"))};
const path = process.argv[1];
for (const [at, timezone, expected] of [
  ["2030-01-01T12:00:00.123", undefined, "2030-01-01T12:00:00.123Z"],
  ["2030-01-01T12:00:00.1", "Asia/Shanghai", "2030-01-01T04:00:00.100Z"],
  ["2027-03-14T02:30:00.123", "America/New_York", "2027-03-14T07:30:00.123Z"],
  ["2027-11-07T01:30:00.123", "America/New_York", "2027-11-07T05:30:00.123Z"],
  ["2030-01-01T12:00:00.123+08:00", "UTC", "2030-01-01T04:00:00.123Z"],
  ["2030-01-01T12:00:00.123456Z", undefined, "2030-01-01T12:00:00.123Z"],
]) {
  const expression = { type: "single", at, timezone };
  const instant = Date.parse(expected);
  assert.equal(nextSingleScheduleTime(expression, instant - 73), instant);
  assert.equal(nextSingleScheduleTime(expression, instant), null);
  assert.equal(nextSingleScheduleTime(expression, instant + 1), null);
}
assert.throws(() => nextSingleScheduleTime({ type: "single", at: "* * * * *" }, 0), /valid date/);
assert.throws(() => nextSingleScheduleTime({ type: "single", at: "2030-01-01T12:00:00.1234" }, 0), /millisecond precision/);
Date.now = () => Date.parse("2027-01-01T00:00:00Z");
const signal = new AbortController().signal;
const context = { operationId: "create-delay", abortSignal: signal, namespace: "alice", collection: "reminders", target: { key: "agent" } };
const now = Date.now();
const expression = resolveScheduleTiming({ type: "delay", minutes: 5 }, now);
const expected = Math.ceil((now + 5 * 60_000) / 60_000) * 60_000;
const provider = sqliteScheduleProvider({ path });
const created = await provider.create(context, { name: "delay", expression, payload: { text: "wake up" } });
await provider.create({ ...context, operationId: "create-zoned" }, {
  name: "zoned", expression: { type: "single", at: "2090-01-01T12:00", timezone: "Asia/Shanghai" }, payload: {},
});
const db = new Database(path, { readonly: true });
let rows;
try { rows = db.query("SELECT name, nextAt FROM schedules ORDER BY name").all(); }
finally { db.close(true); }
const memory = inMemoryScheduleProvider({ now: () => new Date(now) });
await assert.rejects(memory.create(context, { name: "invalid", expression: { type: "single", at: "* * * * *" }, payload: {} }), /valid date/);
const memoryRecord = await memory.create(context, { name: "delay", expression, payload: {} });
const pastInZone = await memory.create({ ...context, operationId: "past-zoned" }, {
  name: "past", expression: { type: "single", at: "2000-01-01T12:00", timezone: "Asia/Shanghai" }, payload: {},
});
const delivered = [];
await pumpSqliteSchedules({ path, application: "agent", collection: "reminders", at: new Date(expected + 1), signal,
  deliver: async (item) => { delivered.push(item); },
});
const completed = await provider.get(context, "delay");
const foldExpression = { type: "single", at: "2027-11-07T01:30", timezone: "America/New_York" };
await provider.create({ ...context, operationId: "create-fold" }, {
  name: "fold", expression: foldExpression, payload: {},
});
const foldDelivered = [];
for (const instant of ["2027-11-07T06:00:00Z", "2027-11-07T06:00:01Z"]) {
  await pumpSqliteSchedules({ path, application: "agent", collection: "reminders", at: new Date(instant), signal,
    deliver: async (item) => { foldDelivered.push(item); },
  });
}
const foldCompleted = await provider.get(context, "fold");
const foldMemory = inMemoryScheduleProvider({ now: () => new Date("2027-11-07T06:00:00Z") });
const foldMemoryRecord = await foldMemory.create(context, { name: "fold", expression: foldExpression, payload: {} });
console.log(JSON.stringify({ state: created.state, expected, rows, memoryState: memoryRecord.state,
  pastState: pastInZone.state, delivered: delivered.length, completedState: completed.state,
  foldDelivered: foldDelivered.length, foldState: foldCompleted.state, foldMemoryState: foldMemoryRecord.state }));
`;
  for (const timezone of ["UTC", "Asia/Shanghai", "America/New_York"]) {
    const { stdout } = await execute(
      process.execPath,
      [
        "--no-env-file",
        "--conditions=corax-source",
        "-e",
        script,
        join(root, `${timezone.replaceAll("/", "-")}.sqlite`),
      ],
      { env: { ...process.env, TZ: timezone }, timeout: 30_000 },
    );
    const result = JSON.parse(stdout);
    assert.equal(result.state, "active", timezone);
    assert.equal(result.rows[0].nextAt, result.expected, timezone);
    assert.equal(result.rows[1].nextAt, Date.parse("2090-01-01T04:00:00Z"), timezone);
    assert.equal(result.memoryState, "active", timezone);
    assert.equal(result.pastState, "completed", timezone);
    assert.equal(result.delivered, 1, timezone);
    assert.equal(result.completedState, "completed", timezone);
    assert.equal(result.foldDelivered, 1, timezone);
    assert.equal(result.foldState, "completed", timezone);
    assert.equal(result.foldMemoryState, "completed", timezone);
  }
});
